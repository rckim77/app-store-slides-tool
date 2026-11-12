#!/usr/bin/env node
// Capture PNG and evidence from simctl. No model/runtime claims are accepted from CLI input.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
function simctl(...args) { return execFileSync('xcrun', ['simctl', ...args], {encoding:'utf8'}); }
function observe(udid) {
  const devices = JSON.parse(simctl('list', 'devices', '-j')).devices;
  const matches = Object.entries(devices).flatMap(([runtimeIdentifier, rows]) =>
    rows.filter(d => d.udid === udid).map(d => ({...d, runtimeIdentifier})));
  if (matches.length !== 1) throw new Error('Use one explicit simulator UDID from simctl list devices (not booted or a display name)');
  const device = matches[0];
  const runtime = JSON.parse(simctl('list', 'runtimes', '-j')).runtimes.find(r => r.identifier === device.runtimeIdentifier);
  if (device.state !== 'Booted' || !device.isAvailable || !device.deviceTypeIdentifier || !runtime?.isAvailable || !runtime.version)
    throw new Error('Capture requires a booted, available simulator with known device type and runtime');
  return {deviceTypeIdentifier:device.deviceTypeIdentifier, runtimeIdentifier:device.runtimeIdentifier,
    runtimeVersion:runtime.version, simulatorUDID:device.udid};
}
function validatePNGOrientation(bytes) {
  // simctl normally emits upright pixels. Reject rotated EXIF data rather than
  // asserting that encoded width/height describes how a viewer will display it.
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw new Error('Truncated PNG');
    if (bytes.toString('ascii', offset+4, offset+8) === 'eXIf') {
      const tiff = bytes.subarray(offset+8, offset+8+length);
      const little = tiff.toString('ascii',0,2) === 'II';
      const u16 = i => little ? tiff.readUInt16LE(i) : tiff.readUInt16BE(i);
      const u32 = i => little ? tiff.readUInt32LE(i) : tiff.readUInt32BE(i);
      if (tiff.length < 8 || !['II','MM'].includes(tiff.toString('ascii',0,2)) || u16(2) !== 42) throw new Error('Invalid PNG EXIF');
      const ifd = u32(4), count = u16(ifd);
      for (let i=0; i<count; i++) {
        const entry = ifd+2+i*12;
        if (u16(entry) === 0x112 && (u16(entry+2) !== 3 || u32(entry+4) !== 1 || u16(entry+8) !== 1))
          throw new Error('Capture contains rotated EXIF orientation; capture upright pixels before creating provenance');
      }
    }
    offset = end;
  }
}
function capture(udid, output) {
  const target = path.resolve(output);
  if (!target.endsWith('.png')) throw new Error('--output must end in .png');
  // Never silently overwrite a capture or detach an existing sidecar from its image.
  if (fs.existsSync(target) || fs.existsSync(target + '.capture.json')) throw new Error('Output already exists; choose a new capture path');
  const before = observe(udid);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-capture-'));
  const image = path.join(temp, 'capture.png');
  let wroteImage = false;
  try {
    simctl('io', udid, 'screenshot', '--type=png', image);
    const after = observe(udid);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Simulator identity changed during capture');
    const bytes = fs.readFileSync(image);
    if (bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16) !== 'IHDR') throw new Error('Capture was not a PNG');
    validatePNGOrientation(bytes);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height) throw new Error('Capture has empty dimensions');
    const provenance = {schemaVersion:1, ...before, capturedAt:new Date().toISOString(), width, height,
      orientation:width > height ? 'landscape' : 'portrait', screenshotSHA256:crypto.createHash('sha256').update(bytes).digest('hex')};
    fs.mkdirSync(path.dirname(target), {recursive:true});
    fs.copyFileSync(image, target, fs.constants.COPYFILE_EXCL); wroteImage = true;
    fs.writeFileSync(target + '.capture.json', JSON.stringify(provenance, null, 2) + '\n', {flag:'wx'});
    return provenance;
  } catch (error) {
    if (wroteImage) fs.unlinkSync(target);
    throw error;
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--udid' || args[2] !== '--output') throw new Error('Usage: node Scripts/capture-simulator.js --udid <UDID> --output <new.png>');
    console.log(JSON.stringify(capture(args[1], args[3]), null, 2));
  } catch (error) { console.error(`error: ${error.message}`); process.exitCode = 1; }
}
module.exports = {capture, observe, validatePNGOrientation};
