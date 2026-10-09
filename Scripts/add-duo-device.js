#!/usr/bin/env node
// Add/replace Duo configuration while preserving each locale's devices and slides.
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const options = { display: "inner", orientation: "landscape" };
const allowed = new Set(["--config", "--config-dir", "--screenshot-root", "--display", "--orientation"]);
try {
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!allowed.has(name) || !args[index + 1]) throw new Error("Usage: node Scripts/add-duo-device.js (--config <json> | --config-dir <directory>) --screenshot-root <captures> [--display inner|outer] [--orientation portrait|landscape]");
    options[name.slice(2)] = args[index + 1];
  }
  if (Boolean(options.config) === Boolean(options["config-dir"]) || !options["screenshot-root"]) throw new Error("Choose exactly one of --config or --config-dir, and provide --screenshot-root");
  if (options["config-dir"] && !options["screenshot-root"].includes("{locale}")) throw new Error("With --config-dir, --screenshot-root must contain {locale} so each locale uses its own captures");
  if (!["inner", "outer"].includes(options.display) || !["portrait", "landscape"].includes(options.orientation)) throw new Error("Choose display inner|outer and orientation portrait|landscape");
  const configPaths = options.config ? [path.resolve(options.config)] : fs.readdirSync(options["config-dir"])
    .filter(name => name.endsWith(".json"))
    .sort()
    .map(name => path.resolve(options["config-dir"], name));
  if (!configPaths.length) throw new Error("No JSON configs found in --config-dir");
  const inner = options.display === "inner";
  const landscape = options.orientation === "landscape";
  const width = landscape ? (inner ? 2853 : 2034) : (inner ? 2007 : 1398);
  const height = landscape ? (inner ? 2007 : 1398) : (inner ? 2853 : 2034);
  const label = `${inner ? "Inner Open" : "Outer Closed"} ${landscape ? "Landscape" : "Portrait"}`;
  // Prepare every config before writing, so an invalid locale cannot leave a partial matrix.
  const updates = configPaths.map(configPath => {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (options["screenshot-root"].includes("{locale}") && !/^[A-Za-z0-9_-]+$/.test(config.defaultLocale || "")) throw new Error(`${configPath}: a valid defaultLocale is required for {locale}`);
    const screenshotRoot = options["screenshot-root"].replaceAll("{locale}", config.defaultLocale);
    const caption = config.caption;
    const top = Math.ceil(caption.topPadding + caption.fontSize * caption.lineHeight * caption.maxLines + (caption.bottomPadding || 0));
    const frameWidth = width + (inner ? 240 : (landscape ? 160 : 176));
    const frameHeight = height + (inner ? 240 : (landscape ? 176 : 160));
    const scale = Math.min(width * 0.92 / frameWidth, (height - top - height * 0.03) / frameHeight);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Caption padding leaves no room for a Duo frame");
    config.devices["iphone-duo"] = {
      appStorePreset: "iphone-duo", canvas: {width, height}, screenshotRoot: path.resolve(screenshotRoot),
      frame: {
        image: path.resolve(__dirname, `../Assets/Frames/iPhone Duo - Night Sky - ${label}.png`),
        screen: {x: inner ? 120 : (landscape ? 80 : 88), y: inner ? 120 : (landscape ? 88 : 80), width, height},
        screenCornerRadius: inner ? 166 : 130,
        scale: Math.floor(scale * 1000) / 1000, top
      }
    };
    return { configPath, config };
  });
  for (const { configPath, config } of updates) {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Configured iPhone Duo ${config.defaultLocale} ${options.display} ${options.orientation}: ${width}x${height}`);
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
