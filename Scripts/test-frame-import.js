const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-import-test-"));
try {
  fs.mkdirSync(path.join(temp, "Scripts"));
  const helper = path.join(temp, "Scripts/import-frames.js");
  fs.copyFileSync(path.join(__dirname, "import-frames.js"), helper);
  const destination = path.join(temp, "Assets/Frames");
  const fixtures = [
    ["iphone", ["iPhone 17 Pro - Deep Blue - Portrait.png"], "AppStoreMarketingArtworkLicenseAgreement_2.rtf"],
    ["ipad", ["iPad Pro 13 - M4 - Space Gray - Portrait.png", "iPad Pro 13 - M4 - Space Gray - Landscape.png"], "Apple Design Resources License.rtf"],
    ["iphone-duo", ["Inner Open Landscape", "Inner Open Portrait", "Outer Closed Landscape", "Outer Closed Portrait"].map(pose => `iPhone Duo - Night Sky - ${pose}.png`), "Apple-Design-Resources-License.rtf"]
  ];
  for (const [device, frames, license] of fixtures) {
    const source = path.join(temp, device);
    fs.mkdirSync(path.join(source, "PNG"), { recursive: true });
    for (const frame of frames) fs.writeFileSync(path.join(source, "PNG", frame), `synthetic ${frame}`);
    // iPhone imports must exclude Duo assets even when the source contains both.
    if (device === "iphone") fs.writeFileSync(path.join(source, "PNG/iPhone Duo - Unselected.png"), "unselected");
    const run = () => spawnSync(process.execPath, [helper, "--device", device, "--source", source], { encoding: "utf8" });
    let result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing Apple license/);
    for (const frame of frames) assert.ok(!fs.existsSync(path.join(destination, frame)), "No partial import without license");
    fs.writeFileSync(path.join(source, license), `synthetic ${device} license`);
    result = run();
    assert.equal(result.status, 0, result.stderr);
    for (const frame of frames) assert.equal(fs.readFileSync(path.join(destination, frame), "utf8"), `synthetic ${frame}`);
    assert.equal(fs.readFileSync(path.join(destination, "Licenses", device, license), "utf8"), `synthetic ${device} license`);
    assert.ok(!fs.existsSync(path.join(destination, "iPhone Duo - Unselected.png")));
    fs.writeFileSync(path.join(source, frames[0]), "ambiguous replacement");
    result = run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Multiple copies/);
    assert.equal(fs.readFileSync(path.join(destination, frames[0]), "utf8"), `synthetic ${frames[0]}`, "Ambiguous sources must not overwrite local frames");
  }
  for (const [device, , license] of fixtures) {
    assert.equal(fs.readFileSync(path.join(destination, "Licenses", device, license), "utf8"), `synthetic ${device} license`, "Device licenses must not overwrite one another");
  }
  const incomplete = path.join(temp, "incomplete");
  fs.mkdirSync(incomplete);
  fs.writeFileSync(path.join(incomplete, fixtures[2][1][0]), "incomplete replacement");
  fs.writeFileSync(path.join(incomplete, fixtures[2][2]), "synthetic license");
  const incompleteResult = spawnSync(process.execPath, [helper, "--device", "iphone-duo", "--source", incomplete], { encoding: "utf8" });
  assert.equal(incompleteResult.status, 1);
  assert.match(incompleteResult.stderr, /Missing iPhone Duo/);
  assert.equal(fs.readFileSync(path.join(destination, fixtures[2][1][0]), "utf8"), `synthetic ${fixtures[2][1][0]}`);
  const wrongDevice = spawnSync(process.execPath, [helper, "--device", "ipad", "--source", incomplete], { encoding: "utf8" });
  assert.equal(wrongDevice.status, 1);
  assert.match(wrongDevice.stderr, /No ipad bezel/);
  const invalid = spawnSync(process.execPath, [helper, "--device", "android", "--source", incomplete], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage/);

  // Prove a fresh checkout can track its setup instructions but not imported assets.
  fs.copyFileSync(path.join(__dirname, "../.gitignore"), path.join(temp, ".gitignore"));
  fs.copyFileSync(path.join(__dirname, "../Assets/Frames/README.md"), path.join(destination, "README.md"));
  function git(args) {
    const result = spawnSync("git", args, { cwd: temp, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(["init", "--quiet"]);
  git(["add", ".gitignore", "Assets/Frames"]);
  assert.equal(git(["ls-files", "Assets/Frames"]), "Assets/Frames/README.md");
  for (const [, frames, license] of fixtures) {
    for (const frame of frames) git(["check-ignore", path.join("Assets/Frames", frame)]);
  }
  git(["check-ignore", "Assets/Frames/future-frame.psd"]);
  console.log("Frame import checks passed for iPhone, iPad and Duo; fresh clones ignore all source assets and licenses");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
