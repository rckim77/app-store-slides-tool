const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slide-duplicate-test-'));
const source = fs.readFileSync(path.join(__dirname, '../Editor/server.js'), 'utf8');
const context = vm.createContext({require, process: {argv:['node', 'server.js'], env:{}}, __dirname:path.join(__dirname, '../Editor'), console, Buffer, URL});
vm.runInContext(source.slice(0, source.lastIndexOf('\ntry {\n')), context);
const run = code => vm.runInContext(code, context);
try {
  const original = {id:'first', screenshot:'first.png', captions:{en_US:'First', fr:'Premier'}, captionPositions:{ipad:'bottom'}, layoutOffsets:{ipad:{frameY:20}}, loupes:{iphone:{zoom:2}}};
  const configPath = path.join(temp, 'config.json');
  const devices = {};
  const sets = [];
  for (const device of ['iphone', 'ipad']) {
    const dir = path.join(temp, device); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'first.png'), 'screenshot');
    devices[device] = {screenshotRoot:dir};
    for (const locale of ['en_US','fr']) {
      const outputDir = path.join(temp, `${device}-${locale}`); fs.mkdirSync(outputDir);
      fs.writeFileSync(path.join(outputDir, 'first.png'), 'rendered');
      sets.push({id:`${device}-${locale}`,configPath, outputDir, device,locale,version:'v1.0.0',editable:true});
    }
  }
  fs.writeFileSync(configPath, JSON.stringify({devices,slides:[original, {id:'last'}]}));
  context.setsFixture = sets;
  run(`allSlideSets = () => setsFixture; editorState = () => ({sets:setsFixture,activeSetId:'iphone-en_US'});`);
  const duplicate = () => run(`duplicateSlide({setId:'iphone-en_US',slideId:'first'})`);
  assert.equal(duplicate().duplicatedSlideId, 'first-copy');
  let config = JSON.parse(fs.readFileSync(configPath));
  assert.deepEqual(config.slides.map(x=>x.id), ['first','first-copy','last']);
  assert.deepEqual(config.slides[0], original);
  assert.deepEqual(config.slides[1], {...original,id:'first-copy',screenshot:'first-copy.png'});
  for (const device of Object.values(devices)) {
    assert.equal(fs.readFileSync(path.join(device.screenshotRoot,'first-copy.png'),'utf8'),'screenshot');
  }
  for (const set of sets) assert.equal(fs.readFileSync(path.join(set.outputDir,'first-copy.png'),'utf8'),'rendered');
  fs.writeFileSync(path.join(devices.iphone.screenshotRoot,'first-copy.png'),'independent');
  assert.equal(fs.readFileSync(path.join(devices.iphone.screenshotRoot,'first.png'),'utf8'),'screenshot');
  assert.equal(duplicate().duplicatedSlideId, 'first-copy-2');
  fs.writeFileSync(path.join(sets[0].outputDir,'first-copy-3.png'),'existing');
  assert.equal(duplicate().duplicatedSlideId, 'first-copy-4');
  const before = fs.readFileSync(configPath,'utf8');
  assert.throws(()=>run(`duplicateSlide({setId:'historical',slideId:'first'})`),/Only current/);
  assert.throws(()=>run(`duplicateSlide({setId:'iphone-en_US',slideId:'unknown'})`),/configured slide/);
  fs.unlinkSync(path.join(devices.ipad.screenshotRoot,'first.png'));
  assert.throws(duplicate,/Missing source screenshot/);
  assert.equal(fs.readFileSync(configPath,'utf8'),before);
  assert.equal(fs.existsSync(path.join(devices.iphone.screenshotRoot,'first-copy-5.png')),false);
  fs.writeFileSync(path.join(devices.ipad.screenshotRoot,'first.png'),'screenshot');
  run(`writeConfig = () => { throw new Error('disk write failed'); };`);
  assert.throws(duplicate,/disk write failed/);
  assert.equal(fs.existsSync(path.join(devices.iphone.screenshotRoot,'first-copy-5.png')),false);
  assert.equal(fs.existsSync(path.join(sets[0].outputDir,'first-copy-5.png')),false);
  assert.equal(fs.readFileSync(configPath,'utf8'),before);
  console.log('Duplicate slide: settings, independent assets, ordering, unique IDs, read-only rejection and rollback passed');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
