#!/usr/bin/env node
// Import a user's already downloaded/licensed Apple resources; never accept a license or download on their behalf.
const fs = require("node:fs");
const path = require("node:path");
const frames = ["Inner Open Landscape", "Inner Open Portrait", "Outer Closed Landscape", "Outer Closed Portrait"]
  .map(pose => `iPhone Duo - Night Sky - ${pose}.png`);
const license = "Apple-Design-Resources-License.rtf";
const appleLicense = "Apple Design Resources License.rtf";
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--source") throw new Error("Usage: node Scripts/import-duo-frames.js --source <mounted or extracted Apple Duo bezel folder>");
  const source = path.resolve(args[1]);
  const found = new Map();
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && [...frames, license, appleLicense].includes(entry.name)) {
        const name = entry.name === appleLicense ? license : entry.name;
        if (found.has(name)) throw new Error(`Multiple copies of ${name}; select a more specific source folder`);
        found.set(name, file);
      }
    }
  }
  scan(source);
  for (const file of [...frames, license]) {
    if (!found.has(file)) throw new Error(`Missing ${file} in source; download the complete iPhone Duo bezel resource from Apple Design Resources`);
  }
  const destination = path.resolve(__dirname, "../Assets/Frames");
  fs.mkdirSync(destination, {recursive: true});
  for (const file of [...frames, license]) {
    const target = path.join(destination, file);
    if (found.get(file) !== target) fs.copyFileSync(found.get(file), target);
  }
  console.log("Imported four Duo frames and their license as local, Git-ignored resources");
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
