// Exercise the editor's actual migration/edit logic without starting its HTTP server.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../Editor/server.js"), "utf8");
const context = vm.createContext({ require, process: { argv: ["node", "server.js"], env: {} }, __dirname: path.join(__dirname, "../Editor"), console, Buffer, URL });
vm.runInContext(source.slice(0, source.lastIndexOf("\ntry {\n")), context);
const evaluate = (code) => vm.runInContext(code, context);
evaluate(`
  globalThis.fixture = {
    devices: { iphone: { canvas: { width: 1290, height: 2796 } }, ipad: { canvas: { width: 2752, height: 2064 } } },
    slides: [{ id: 'test', loupe: { enabled: true, center: { x: 645, y: 1100 }, width: 1000, height: 240, zoom: 2 } }]
  };
`);
assert.equal(evaluate("repairStoredLoupeCenters(fixture)"), true);
assert.equal(evaluate("fixture.slides[0].loupe"), undefined);
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'iphone').zoom"), 2);
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'ipad').zoom"), 2);
assert.equal(evaluate("repairStoredLoupeCenters(fixture)"), false, "migration must be idempotent");
evaluate("applyLoupeToSlide(fixture.slides[0], {enabled:true, zoom:3}, 'iphone', fixture)");
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'iphone').zoom"), 3);
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'ipad').zoom"), 2, "editing iPhone must preserve iPad");
evaluate("applyLoupeToSlide(fixture.slides[0], null, 'iphone', fixture)");
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'iphone')"), null);
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'ipad').zoom"), 2, "disabling iPhone must preserve iPad");
evaluate("applyLoupeToSlide(fixture.slides[0], null, 'ipad', fixture)");
assert.equal(evaluate("fixture.slides[0].loupes"), undefined);
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'iphone')"), null, "last disabled loupe must not reappear");
evaluate("fixture.slides[0] = {id:'test', loupe:{enabled:true,zoom:2}, loupes:{ipad:{enabled:true,zoom:4}}}; repairStoredLoupeCenters(fixture)");
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'ipad').zoom"), 4, "legacy migration must preserve explicit per-device settings");
assert.equal(evaluate("slideLoupeForDevice(fixture.slides[0], 'iphone').zoom"), 2);
console.log("Editor loupe regression checks passed");
