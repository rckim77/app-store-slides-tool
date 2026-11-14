const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const binary = path.join(root, '.build/debug/app-store-slides-tool');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-consistency-'));
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
function png(width, height, screen) {
  const header = Buffer.alloc(13);
  const channels = screen ? 4 : 3;
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = screen ? 6 : 2;
  const rows = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * channels + 1) + x * channels + 1;
      rows[offset] = x < width / 2 ? 240 : 20;
      rows[offset + 1] = y < height / 2 ? 100 : 220;
      rows[offset + 2] = 90;
      if (screen) rows[offset + 3] = x >= screen.x && x < screen.x + screen.width && y >= screen.y && y < screen.y + screen.height ? 0 : 255;
    }
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function run(config, device, pattern, render = false) {
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify(config));
  const result = spawnSync(binary, ['--config',path.join(temp,'config.json'),'--device',device,...(render ? [] : ['--validate-only'])],{encoding:'utf8'});
  assert.equal(result.status, pattern ? 1 : 0, result.stderr);
  if (pattern) assert.match(result.stderr,pattern);
}
try {
  for (const [name, preset, canvas, w, h] of [
    ['iphone','iphone-6.3',{width:1206,height:2622},120,260],
    ['ipad','ipad-13',{width:2064,height:2752},150,200],
    ['iphone-duo','iphone-duo',{width:1398,height:2034},140,204]]) {
    const shot = path.join(temp,'shot.png'), sidecar = shot+'.capture.json';
    const bytes = png(w,h); fs.writeFileSync(shot,bytes);
    fs.writeFileSync(path.join(temp,'frame.png'),png(w+20,h+20,{x:10,y:10,width:w,height:h}));
    const type = 'com.apple.CoreSimulator.SimDeviceType.' + name;
    const device={appStorePreset:preset,canvas,screenshotRoot:temp,frame:{image:'frame.png',screen:{x:10,y:10,width:w,height:h},scale:1,top:100}};
    const config={name:'Fixture',version:'test',defaultLocale:'en_US',outputRoot:temp,background:{color:'#000000'},caption:{fontSize:20,color:'#ffffff',topPadding:20,horizontalPadding:20,lineHeight:1,maxLines:2},devices:{[name]:device},slides:[{id:'one',screenshot:'shot.png',captions:{en_US:'One'}}]};
    run(config,name); // Legacy matching geometry still works, without claiming provenance.
    const tiff=Buffer.alloc(26);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);
    tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
    fs.writeFileSync(shot,Buffer.concat([bytes.subarray(0,33),chunk('eXIf',tiff),bytes.subarray(33)]));
    run(config,name,/EXIF orientation/);
    fs.writeFileSync(shot,png(h,w)); run(config,name,/aspect ratio and orientation/);
    fs.writeFileSync(shot,png(w+20,h)); run(config,name,/aspect ratio/);
    fs.writeFileSync(shot,bytes);
    device.frame.screen.x=100; run(config,name,/inside the frame/); device.frame.screen.x=10;
    device.frame.deviceTypeIdentifier=type;
    run(config,name,/missing capture record/);
    const metadata={schemaVersion:1,screenshotSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),deviceTypeIdentifier:type};
    const write=m=>fs.writeFileSync(sidecar,JSON.stringify(m));
    write(metadata);run(config,name);run(config,name,undefined,true);
    // Identical pixels from another model must fail validation AND rendering.
    write({...metadata,deviceTypeIdentifier:type+'-Other'});
    run(config,name,/must match frame/);run(config,name,/must match frame/,true);
    write({...metadata,screenshotSHA256:'0'.repeat(64)});run(config,name,/does not match screenshot/);
    write({...metadata,schemaVersion:2});run(config,name,/does not match screenshot/);
    write(metadata);fs.writeFileSync(shot,png(w*2,h*2));run(config,name,/does not match screenshot/);
    fs.writeFileSync(shot,bytes);
    delete device.frame.deviceTypeIdentifier;run(config,name,/set frame.deviceTypeIdentifier/);
    device.frame.deviceTypeIdentifier='';run(config,name,/set frame.deviceTypeIdentifier/);
    device.frame.deviceTypeIdentifier=type;
    // Older, richer records remain readable; runtime details are not enforced here.
    write({...metadata,width:w,height:h,runtimeVersion:'27.2'});run(config,name);
    fs.writeFileSync(sidecar,'invalid JSON');run(config,name,/error/);
    fs.unlinkSync(sidecar);
  }
  console.log('Screenshot matching: iPhone/iPad/Duo geometry, EXIF, bounds, required capture, model mismatch, stale hash, and malformed records passed');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
