#!/usr/bin/env node
// Import already downloaded Apple resources; never download or accept a license.
const fs = require("node:fs");
const path = require("node:path");

function importFrames(args) {
  const usage = "Usage: node Scripts/import-frames.js --device <iphone|iphone-duo|ipad> --source <mounted or extracted Apple bezel folder>";
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--device", "--source"].includes(flag) || !args[index + 1] || options[flag]) throw new Error(usage);
    options[flag] = args[index + 1];
  }
  const device = options["--device"];
  if (!["iphone", "iphone-duo", "ipad"].includes(device) || !options["--source"]) throw new Error(usage);
  const source = path.resolve(options["--source"]);
  const frames = new Map();
  const licenses = new Map();
  function matchesFrame(name) {
    if (!name.toLowerCase().endsWith(".png")) return false;
    if (device === "ipad") return name.startsWith("iPad ");
    if (device === "iphone-duo") return name.startsWith("iPhone Duo ");
    return name.startsWith("iPhone ") && !name.startsWith("iPhone Duo ");
  }
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile()) {
        const collection = matchesFrame(entry.name) ? frames
          : /(?:apple|app.?store).*(?:design.?resources|marketing).*licen[cs]e.*\.(?:rtf|pdf|txt)$/i.test(entry.name) ? licenses : null;
        if (!collection) continue;
        if (collection.has(entry.name)) throw new Error(`Multiple copies of ${entry.name}; select a more specific source folder`);
        collection.set(entry.name, file);
      }
    }
  }
  scan(source);
  if (!frames.size) throw new Error(`No ${device} bezel PNGs found in source; select Apple's matching device folder`);
  if (!licenses.size) throw new Error("Missing Apple license in source; select the complete downloaded resource folder, not just its PNG subfolder");
  if (device === "iphone-duo") {
    for (const pose of ["Inner Open Landscape", "Inner Open Portrait", "Outer Closed Landscape", "Outer Closed Portrait"]) {
      const name = `iPhone Duo - Night Sky - ${pose}.png`;
      if (!frames.has(name)) throw new Error(`Missing ${name} in source; download the complete iPhone Duo bezel resource from Apple Design Resources`);
    }
  }
  // Validate the full source before touching any existing local resources.
  const destination = path.resolve(__dirname, "../Assets/Frames");
  const licenseDestination = path.join(destination, "Licenses", device);
  fs.mkdirSync(licenseDestination, { recursive: true });
  for (const [name, file] of frames) {
    const target = path.join(destination, name);
    if (file !== target) fs.copyFileSync(file, target);
  }
  for (const [name, file] of licenses) {
    const target = path.join(licenseDestination, name);
    if (file !== target) fs.copyFileSync(file, target);
  }
  // Preserve the documented legacy Duo license path.
  if (device === "iphone-duo") {
    const designLicense = licenses.get("Apple Design Resources License.rtf") || licenses.get("Apple-Design-Resources-License.rtf");
    const target = path.join(destination, "Apple-Design-Resources-License.rtf");
    if (designLicense && designLicense !== target) fs.copyFileSync(designLicense, target);
  }
  console.log(`Imported ${frames.size} ${device} frames and ${licenses.size} license files as local, Git-ignored resources`);
}

function run(args) {
  try { importFrames(args); }
  catch (error) { console.error(`error: ${error.message}`); process.exitCode = 1; }
}
module.exports = { importFrames, run };
if (require.main === module) run(process.argv.slice(2));
