const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {capture} = require('./capture-simulator');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'simulator-helper-'));
const previousPath = process.env.PATH;
try {
  const input = path.join(temp, 'input.png');
  fs.writeFileSync(input, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'));
  const devices = {devices: {'runtime-id': [{udid: 'fixture-udid', state: 'Booted', isAvailable: true, deviceTypeIdentifier: 'actual-type'}]}};
  const saveDevices = () => fs.writeFileSync(path.join(temp, 'devices.json'), JSON.stringify(devices));
  saveDevices();
  fs.writeFileSync(path.join(temp, 'xcrun'), '#!' + process.execPath + '\n' + `
const fs = require('node:fs'), path = require('node:path'), args = process.argv.slice(2);
if (args[0] !== 'simctl') process.exit(2);
if (args[1] === 'list' && args[2] === 'devices') console.log(fs.readFileSync(path.join(__dirname, 'devices.json'), 'utf8'));
else if (args[1] === 'io' && args[2] === 'fixture-udid') {
  fs.copyFileSync(path.join(__dirname, 'input.png'), args[5]);
  if (fs.existsSync(path.join(__dirname, 'change-device'))) fs.writeFileSync(path.join(__dirname, 'devices.json'), '{"devices":{}}');
} else process.exit(3);
`, {mode: 0o755});
  process.env.PATH = temp + path.delimiter + previousPath;
  const target = path.join(temp, 'out', 'fresh.png');
  const record = capture('fixture-udid', target);
  assert.deepEqual(record, {schemaVersion: 1, deviceTypeIdentifier: 'actual-type',
    screenshotSHA256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')});
  assert.deepEqual(JSON.parse(fs.readFileSync(target + '.capture.json')), record);
  assert.throws(() => capture('fixture-udid', target), /already exists/);
  assert.throws(() => capture('booted', path.join(temp, 'unknown.png')), /explicit simulator UDID/);
  const orphan = path.join(temp, 'orphan.png');
  fs.writeFileSync(orphan + '.capture.json', 'existing');
  assert.throws(() => capture('fixture-udid', orphan), /already exists/);
  assert.equal(fs.existsSync(orphan), false);
  assert.equal(fs.readFileSync(orphan + '.capture.json', 'utf8'), 'existing');
  devices.devices['runtime-id'][0].state = 'Shutdown'; saveDevices();
  assert.throws(() => capture('fixture-udid', path.join(temp, 'shutdown.png')), /booted/);
  devices.devices['runtime-id'][0].state = 'Booted'; saveDevices();
  const failed = path.join(temp, 'failed.png');
  fs.writeFileSync(path.join(temp, 'change-device'), '');
  assert.throws(() => capture('fixture-udid', failed), /explicit simulator UDID/);
  assert.equal(fs.existsSync(failed), false);
  fs.unlinkSync(path.join(temp, 'change-device')); saveDevices();
  fs.writeFileSync(input, 'not a PNG');
  assert.throws(() => capture('fixture-udid', failed), /not a PNG/);
  assert.equal(fs.existsSync(failed + '.capture.json'), false);
  console.log('Capture helper: actual model, hash, sidecar, no overwrite, explicit UDID, boot state, changed identity and invalid PNG passed (mock simctl)');
} finally {
  process.env.PATH = previousPath;
  fs.rmSync(temp, {recursive: true, force: true});
}
