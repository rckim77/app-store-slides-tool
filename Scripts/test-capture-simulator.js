const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const {capture, validatePNGOrientation} = require('./capture-simulator');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'simulator-helper-'));
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


const previousPath = process.env.PATH;
try {
  const input=path.join(temp,'input.png');fs.writeFileSync(input,png(12,26));
  const devices={devices:{'runtime-id':[{udid:'fixture-udid',state:'Booted',isAvailable:true,deviceTypeIdentifier:'actual-type'}]}};
  const runtimes={runtimes:[{identifier:'runtime-id',version:'27.2',isAvailable:true}]};
  fs.writeFileSync(path.join(temp,'devices.json'),JSON.stringify(devices));
  fs.writeFileSync(path.join(temp,'runtimes.json'),JSON.stringify(runtimes));
  fs.writeFileSync(path.join(temp,'xcrun'),'#!'+process.execPath+'\n'+`
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);
if (args[0]!=='simctl') process.exit(2);
if (args[1]==='list') console.log(fs.readFileSync(path.join(__dirname,args[2]+'.json'),'utf8'));
else if (args[1]==='io' && args[2]==='fixture-udid') fs.copyFileSync(path.join(__dirname,'input.png'),args[5]);
else process.exit(3);
`,{mode:0o755});
  process.env.PATH=temp+path.delimiter+previousPath;
  const target=path.join(temp,'out','fresh.png');
  const p=capture('fixture-udid',target);
  assert.equal(p.runtimeVersion,'27.2');assert.equal(p.deviceTypeIdentifier,'actual-type');
  assert.equal(p.screenshotSHA256,crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'));
  assert.equal(p.orientation,'portrait');assert.equal(p.width,12);assert.equal(p.height,26);
  assert.deepEqual(JSON.parse(fs.readFileSync(target+'.capture.json')),p);
  assert.throws(()=>capture('fixture-udid',target),/already exists/);
  assert.throws(()=>capture('booted',path.join(temp,'unknown.png')),/explicit simulator UDID/);
  devices.devices['runtime-id'][0].state='Shutdown';fs.writeFileSync(path.join(temp,'devices.json'),JSON.stringify(devices));
  assert.throws(()=>capture('fixture-udid',path.join(temp,'shutdown.png')),/booted/);
  // TIFF EXIF orientation 6 must not be mistaken for upright portrait pixel data.
  const tiff=Buffer.alloc(26);tiff.write('II');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);tiff.writeUInt16LE(1,8);
  tiff.writeUInt16LE(0x112,10);tiff.writeUInt16LE(3,12);tiff.writeUInt32LE(1,14);tiff.writeUInt16LE(6,18);
  const bytes=png(12,26), rotated=Buffer.concat([bytes.subarray(0,33),chunk('eXIf',tiff),bytes.subarray(33)]);
  assert.throws(()=>validatePNGOrientation(rotated),/rotated EXIF/);
  tiff.writeUInt16LE(1,18);validatePNGOrientation(Buffer.concat([bytes.subarray(0,33),chunk('eXIf',tiff),bytes.subarray(33)]));
  console.log('Capture helper: observed identity, SHA-256, sidecar, no overwrite, explicit UDID, boot state and EXIF orientation passed (mock simctl)');
} finally {process.env.PATH=previousPath;fs.rmSync(temp,{recursive:true,force:true});}
