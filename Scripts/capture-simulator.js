#!/usr/bin/env node
// Record the actual simulator model and bind it to the captured PNG bytes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

function simctl(...args) {
  return execFileSync('xcrun', ['simctl', ...args], {encoding: 'utf8'});
}
function deviceType(udid) {
  const devices = Object.values(JSON.parse(simctl('list', 'devices', '-j')).devices).flat();
  const matches = devices.filter(device => device.udid === udid);
  if (matches.length !== 1) throw new Error('Use one explicit simulator UDID from simctl list devices (not booted or a display name)');
  const device = matches[0];
  if (device.state !== 'Booted' || !device.isAvailable || !device.deviceTypeIdentifier)
    throw new Error('Capture requires a booted, available simulator with a known device type');
  return device.deviceTypeIdentifier;
}
function capture(udid, output) {
  const target = path.resolve(output);
  if (!target.endsWith('.png')) throw new Error('--output must end in .png');
  if (fs.existsSync(target) || fs.existsSync(target + '.capture.json')) throw new Error('Output already exists; choose a new capture path');
  const model = deviceType(udid);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-capture-'));
  const image = path.join(temp, 'capture.png');
  let wroteImage = false;
  try {
    simctl('io', udid, 'screenshot', '--type=png', image);
    if (deviceType(udid) !== model) throw new Error('Simulator identity changed during capture');
    const bytes = fs.readFileSync(image);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Capture was not a PNG');
    const record = {schemaVersion: 1, deviceTypeIdentifier: model,
      screenshotSHA256: crypto.createHash('sha256').update(bytes).digest('hex')};
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(image, target, fs.constants.COPYFILE_EXCL);
    wroteImage = true;
    fs.writeFileSync(target + '.capture.json', JSON.stringify(record, null, 2) + '\n', {flag: 'wx'});
    return record;
  } catch (error) {
    if (wroteImage) fs.unlinkSync(target);
    throw error;
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--udid' || args[2] !== '--output') throw new Error('Usage: node Scripts/capture-simulator.js --udid <UDID> --output <new.png>');
    console.log(JSON.stringify(capture(args[1], args[3]), null, 2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = {capture};
