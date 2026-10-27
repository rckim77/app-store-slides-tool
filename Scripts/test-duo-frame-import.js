const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "duo-import-test-"));
try {
  // Run a copy of the helper in a temporary checkout so real licensed assets stay untouched.
  fs.mkdirSync(path.join(temp, "Scripts"));
  const helper = path.join(temp, "Scripts/import-duo-frames.js");
  fs.copyFileSync(path.join(__dirname, "import-duo-frames.js"), helper);
  fs.copyFileSync(path.join(__dirname, "import-frames.js"), path.join(temp, "Scripts/import-frames.js"));
  const source = path.join(temp, "Apple-bezels");
  fs.mkdirSync(path.join(source, "PNG"), {recursive: true});
  const frames = ["Inner Open Landscape", "Inner Open Portrait", "Outer Closed Landscape", "Outer Closed Portrait"]
    .map(pose => `iPhone Duo - Night Sky - ${pose}.png`);
  for (const file of frames) fs.writeFileSync(path.join(source, "PNG", file), `synthetic fixture ${file}`);
  const destination = path.join(temp, "Assets/Frames");
  const run = () => spawnSync(process.execPath, [helper, "--source", source], {encoding: "utf8"});
  let result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing Apple license/);
  assert.ok(!fs.existsSync(destination), "Missing license must not produce a partial import");
  fs.writeFileSync(path.join(source, "Apple Design Resources License.rtf"), "synthetic license fixture");
  result = run();
  assert.equal(result.status, 0, result.stderr);
  for (const file of frames) assert.equal(fs.readFileSync(path.join(destination, file), "utf8"), `synthetic fixture ${file}`);
  assert.equal(fs.readFileSync(path.join(destination, "Apple-Design-Resources-License.rtf"), "utf8"), "synthetic license fixture");
  fs.writeFileSync(path.join(source, frames[0]), "duplicate fixture");
  result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Multiple copies/);
  assert.equal(fs.readFileSync(path.join(destination, frames[0]), "utf8"), `synthetic fixture ${frames[0]}`);
  console.log("Duo frame import checks passed: native Apple folder/license names, exact copies, no partial import or overwrite for missing/ambiguous sources");
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
