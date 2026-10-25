const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "duo-locales-"));
const locales = ["en_US", "es_MX", "de_DE"];
const helper = path.join(root, "Scripts/add-duo-device.js");
try {
  const configs = path.join(temp, "configs");
  fs.mkdirSync(configs);
  const originals = new Map();
  for (const [index, locale] of locales.entries()) {
    const config = {
      defaultLocale: locale, version: "v2.1.0", outputRoot: "existing-output",
      caption: {fontSize: 100 + index, topPadding: 40, bottomPadding: 40, lineHeight: 1.12, maxLines: 2},
      devices: {iphone: {screenshotRoot: `iphone/${locale}`}, ipad: {screenshotRoot: `ipad/${locale}`}},
      slides: [{id: "gallery", screenshot: "gallery.png", captions: {[locale]: `Localized ${locale}`}, loupes: {iphone: {zoom: 2 + index}}}]
    };
    originals.set(locale, config);
    fs.writeFileSync(path.join(configs, `${locale}.json`), JSON.stringify(config));
  }
  const captureTemplate = path.join(temp, "captures/{locale}/raw");
  const run = (...args) => spawnSync(process.execPath, [helper, ...args], {encoding: "utf8"});
  let result = run("--config-dir", configs, "--screenshot-root", captureTemplate);
  assert.equal(result.status, 0, result.stderr);
  for (const locale of locales) {
    const actual = JSON.parse(fs.readFileSync(path.join(configs, `${locale}.json`)));
    const original = originals.get(locale);
    assert.deepEqual(actual.devices.iphone, original.devices.iphone);
    assert.deepEqual(actual.devices.ipad, original.devices.ipad);
    assert.deepEqual(actual.slides, original.slides.map(slide => ({...slide, layoutOffsets: {"iphone-duo": {captionY: 48}}})));
    assert.deepEqual(actual.caption, original.caption);
    assert.equal(actual.defaultLocale, locale);
    assert.equal(actual.version, original.version);
    assert.equal(actual.outputRoot, original.outputRoot);
    assert.equal(actual.devices["iphone-duo"].screenshotRoot, path.join(temp, "captures", locale, "raw"));
    assert.deepEqual(actual.devices["iphone-duo"].canvas, {width: 2853, height: 2007});
    assert.match(actual.devices["iphone-duo"].frame.image, /Inner Open Landscape\.png$/);
    const captionHeight = actual.caption.fontSize * actual.caption.lineHeight * actual.caption.maxLines;
    assert.ok(actual.devices["iphone-duo"].frame.top >= actual.caption.topPadding + captionHeight + 48 + 24);
  }
  const firstPass = fs.readFileSync(path.join(configs, "en_US.json"), "utf8");
  result = run("--config-dir", configs, "--screenshot-root", captureTemplate);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(configs, "en_US.json"), "utf8"), firstPass, "Repeating the helper must not accumulate caption offsets");
  result = run("--config-dir", configs, "--screenshot-root", path.join(temp, "english-only"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain \{locale\}/);
  // A bad config must be discovered before any locale file is written.
  const englishPath = path.join(configs, "en_US.json");
  const englishBefore = fs.readFileSync(englishPath, "utf8");
  fs.writeFileSync(path.join(configs, "zz-invalid.json"), JSON.stringify({...originals.get("en_US"), defaultLocale: "../wrong"}));
  result = run("--config-dir", configs, "--screenshot-root", captureTemplate, "--display", "outer");
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(englishPath, "utf8"), englishBefore);
  // Single-config callers remain compatible with a literal screenshot path.
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(englishPath)).devices["iphone-duo"].screenshotRoot, path.join(temp, "single"));

  const customized = JSON.parse(fs.readFileSync(englishPath));
  customized.slides[0].layoutOffsets = {iphone: {captionY: 7}, ipad: {captionY: 12}, "iphone-duo": {captionY: 32, frameY: 5}};
  fs.writeFileSync(englishPath, JSON.stringify(customized));
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(englishPath)).slides, customized.slides, "Existing per-device placement must survive");
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"), "--caption-offset", "0");
  assert.equal(result.status, 0, result.stderr);
  const reset = JSON.parse(fs.readFileSync(englishPath));
  assert.deepEqual(reset.slides[0].layoutOffsets, {iphone: {captionY: 7}, ipad: {captionY: 12}, "iphone-duo": {captionY: 0, frameY: 5}});
  const beforeInvalid = fs.readFileSync(englishPath, "utf8");
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"), "--caption-offset", "NaN");
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(englishPath, "utf8"), beforeInvalid);

  // A bottom caption or explicitly selected alternative display retains its placement.
  const alternate = {...originals.get("en_US"), slides: [{...originals.get("en_US").slides[0], captionPositions: {"iphone-duo": "bottom"}}]};
  fs.writeFileSync(englishPath, JSON.stringify(alternate));
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(englishPath)).slides, alternate.slides);
  fs.writeFileSync(englishPath, JSON.stringify(originals.get("en_US")));
  result = run("--config", englishPath, "--screenshot-root", path.join(temp, "single"), "--display", "outer", "--orientation", "portrait");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(englishPath)).devices["iphone-duo"].canvas, {width: 1398, height: 2034});
  assert.deepEqual(JSON.parse(fs.readFileSync(englishPath)).slides, originals.get("en_US").slides);

  const source = fs.readFileSync(path.join(root, "Editor/public/editor.js"), "utf8");
  const context = vm.createContext({});
  for (const name of ["unique", "sortLocales", "localeTabsForSet"]) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf("\nfunction ", start + 1);
    assert.ok(start >= 0 && end > start, `Missing ${name}`);
    vm.runInContext(source.slice(start, end), context);
  }
  const sets = locales.flatMap(locale => ["iphone", "ipad"].map(device => ({device, locale, version: "v2.1.0", source: "generated"})));
  const active = {device: "iphone-duo", locale: "en_US", version: "v2.1.0", source: "generated"};
  sets.push(active, {...active, locale: "fr_FR", version: "v1.0.0"}, {...active, locale: "ja_JP", source: "archive"});
  context.sets = sets;
  context.active = active;
  let tabs = JSON.parse(JSON.stringify(vm.runInContext("localeTabsForSet(sets, active)", context)));
  assert.deepEqual(tabs.map(tab => tab.value), ["en_US", "de_DE", "es_MX"]);
  assert.deepEqual(tabs.map(tab => tab.disabled), [false, true, true]);
  assert.equal(tabs[1].label, "de_DE (N/A)");
  sets.push({...active, locale: "de_DE"}, {...active, locale: "es_MX"});
  tabs = JSON.parse(JSON.stringify(vm.runInContext("localeTabsForSet(sets, active)", context)));
  assert.ok(tabs.every(tab => !tab.disabled));
  assert.deepEqual(tabs.map(tab => tab.label), ["en_US", "de_DE", "es_MX"]);
  console.log("Duo locale checks passed: separate localized inputs, preserved captions/devices/loupes, batch validation, compatible single-config mode, pending and generated locale tabs");
} finally {
  fs.rmSync(temp, {recursive: true, force: true});
}
