#!/usr/bin/env node
// Compatibility entry point for the original Duo-only import command.
require("./import-frames.js").run(["--device", "iphone-duo", ...process.argv.slice(2)]);
