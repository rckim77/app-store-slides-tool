const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const binary = path.join(root, ".build/debug/app-store-slides-tool");
assert.ok(fs.existsSync(binary), "Run swift build before these checks");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "slides-duo-test-"));

// Make deliberately synthetic RGB inputs, so these checks need no app/simulator/library.
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + x * 3 + 1;
      rows[offset] = x < width / 2 ? 240 : 20;
      rows[offset + 1] = y < height / 2 ? 100 : 220;
      rows[offset + 2] = 90;
    }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
function run(config, args = [], expectedStatus = 0) {
  fs.writeFileSync(path.join(temp, "config.json"), JSON.stringify(config));
  const result = spawnSync(binary, ["--config", path.join(temp, "config.json"), "--device", "iphone-duo", ...args], { encoding: "utf8" });
  assert.equal(result.status, expectedStatus, result.stderr);
  return result;
}
const formats = [
  [1398,2034,"Outer Closed Portrait",88,80],
  [2034,1398,"Outer Closed Landscape",80,88],
  [2007,2853,"Inner Open Portrait",120,120],
  [2853,2007,"Inner Open Landscape",120,120]
];
try {
  for (const [, , label] of formats) {
    assert.ok(fs.existsSync(path.join(root, `Assets/Frames/iPhone Duo - Night Sky - ${label}.png`)), "Import Apple's licensed Duo bezels with Scripts/import-duo-frames.js before running render checks (see README)");
  }
  const config = {
    name: "Synthetic regression fixture", version: "v1.0.0", defaultLocale: "en_US", outputRoot: path.join(temp, "out"),
    background: {color:"#8DCAF7"}, caption:{fontSize:80,color:"#000000",topPadding:40,bottomPadding:40,horizontalPadding:40,lineHeight:1.12,maxLines:2},
    devices:{}, slides:[{id:"fixture",screenshot:"fixture.png",captions:{en_US:"Duo regression"},loupes:{"iphone-duo":{enabled:true,center:{x:500,y:550},width:400,height:180,zoom:2}}}]
  };
  for (const [width,height,label,x,y] of formats) {
    fs.writeFileSync(path.join(temp,"fixture.png"),png(width,height));
    config.devices["iphone-duo"]={appStorePreset:"iphone-duo",canvas:{width,height},screenshotRoot:temp,frame:{image:path.join(root,`Assets/Frames/iPhone Duo - Night Sky - ${label}.png`),screen:{x,y,width,height},scale:0.4,top:250}};
    run(config,["--validate-only"]);
    run(config);
    const output=fs.readFileSync(path.join(temp,"out/v1.0.0/iphone-duo/en_US/fixture.png"));
    assert.equal(output.readUInt32BE(16),width);
    assert.equal(output.readUInt32BE(20),height);
    assert.equal(output[25],2,"App Store export must be RGB without alpha, including loupes");
  }
  config.devices["iphone-duo"].canvas={width:1878,height:2670};
  assert.match(run(config,["--validate-only"],1).stderr,/is not valid/);
  config.devices["iphone-duo"].canvas={width:2853,height:2007};
  config.devices["iphone-duo"].appStorePreset="ipad-13";
  assert.match(run(config,["--validate-only"],1).stderr,/requires the iphone-duo/);
  config.devices["iphone-duo"].appStorePreset="iphone-duo";
  const screen=config.devices["iphone-duo"].frame.screen;
  config.devices["iphone-duo"].frame.screen={x:0,y:0,width:2752,height:2064};
  assert.match(run(config,["--validate-only"],1).stderr,/frame screen/);
  config.devices["iphone-duo"].frame.screen=screen;
  fs.writeFileSync(path.join(temp,"fixture.png"),png(1206,2622));
  assert.match(run(config,["--validate-only"],1).stderr,/aspect ratio/);

  const source=fs.readFileSync(path.join(root,"Editor/server.js"),"utf8");
  const context=vm.createContext({require,process:{argv:["node","server.js"],env:{}},__dirname:path.join(root,"Editor"),console,Buffer,URL});
  vm.runInContext(source.slice(0,source.lastIndexOf("\ntry {\n")),context);
  assert.equal(vm.runInContext('archiveDeviceFor("/app/v2.1.0/iphone-duo/en_US/raw/gallery.png")',context),"iphone-duo");
  assert.equal(vm.runInContext('archiveDeviceFor("/app/v2.1.0/iphone/en_US/raw/gallery.png")',context),"iphone");
  vm.runInContext(`globalThis.config={devices:{iphone:{canvas:{width:1290,height:2796}},"iphone-duo":{canvas:{width:2853,height:2007}}}}; globalThis.slide={loupes:{iphone:{enabled:true,zoom:2}}}; applyLoupeToSlide(slide,{enabled:true,width:2800,center:{x:1426.5,y:1500}},"iphone-duo",config);`,context);
  assert.equal(vm.runInContext('slide.loupes["iphone-duo"].width',context),2800,"Duo loupe must not clamp to iPhone width");
  assert.equal(vm.runInContext('slide.loupes["iphone-duo"].center.x',context),1426.5);
  assert.equal(vm.runInContext('slide.loupes.iphone.zoom',context),2);
  console.log("Duo checks passed: four accepted exports, RGB/no alpha with loupes, invalid canvas/preset/source rejection, archive identity, independent loupe sizing");
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
