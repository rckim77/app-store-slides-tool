// Exercise the actual API handlers with an isolated config and mocked rendering.
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
    version: 'test', defaultLocale: 'en_US', background: {color:'#FFFFFF'},
    caption: {}, devices: {iphone:{}, ipad:{}},
    slides: [{id:'first', screenshot:'first.png', captions:{en_US:'First'}}, {id:'second', captions:{en_US:'Second'}}]
  };
  globalThis.renders = [];
  allSlideSets = () => ['iphone', 'ipad'].map(device => ({id:device,device,editable:true,version:'test',locale:'en_US',configPath:'fixture'}));
  syncVersionAcrossLocales = () => {};
  readConfig = () => JSON.parse(JSON.stringify(fixture));
  writeConfig = (config) => { fixture = JSON.parse(JSON.stringify(config)); };
  renderSlides = (_, device, locale, slide) => renders.push({device,locale,slide});
  editorState = () => ({sets:allSlideSets()});
  repairStoredLoupeCenters = () => {};
`);
const position = (device) => evaluate(`slideEntry(fixture, fixture.slides[0], 'en_US', '/tmp/first.png', '${device}').captionPosition`);
assert.equal(position("iphone"), "top");
assert.equal(position("ipad"), "top");
evaluate("previewCaption({setId:'iphone',slideId:'first',captionPosition:'bottom'})");
assert.equal(position("iphone"), "bottom");
assert.equal(position("ipad"), "top");
assert.equal(evaluate("renders.at(-1).device"), "iphone");
assert.equal(evaluate("fixture.slides[1].captionPositions"), undefined, "Other slides must be unchanged");
evaluate("updateSlide('first', {setId:'ipad',captionPosition:'bottom'})");
assert.equal(position("iphone"), "bottom");
assert.equal(position("ipad"), "bottom");
evaluate("saveAllSlides({setId:'iphone',slideId:'first',captionPosition:'top'})");
assert.equal(position("iphone"), "top");
assert.equal(position("ipad"), "bottom");
assert.equal(evaluate("fixture.slides[1].captionPositions"), undefined, "Save all must preserve other slide layouts");
evaluate("updateSlide('first', {setId:'iphone',captionText:'Updated'})");
assert.equal(position("ipad"), "bottom", "Old clients omitting position must preserve existing choices");
const before = evaluate("JSON.stringify(fixture)");
for (const call of ["previewCaption({setId:'iphone',slideId:'first',captionPosition:'left'})", "updateSlide('first',{setId:'iphone',captionPosition:null})", "saveAllSlides({setId:'ipad',slideId:'first',captionPosition:1})"]) {
  assert.throws(() => evaluate(call), /captionPosition must be top or bottom/);
  assert.equal(evaluate("JSON.stringify(fixture)"), before, "Invalid position must not overwrite config");
}
console.log("Editor caption position regression checks passed");
