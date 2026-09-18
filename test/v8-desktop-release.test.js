'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const desktopPackage = JSON.parse(fs.readFileSync(path.join(root, 'desktop/package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'desktop/storage.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8');
const diagnostics = fs.readFileSync(path.join(root, 'docs/DESKTOP_DIAGNOSTICS.md'), 'utf8');

test('normal and compatibility launch commands use the unified Modbus runtime', () => {
  assert.equal(rootPackage.main, 'src/index-v7.js');
  assert.equal(rootPackage.scripts.start, 'node src/index-v7.js');
  assert.equal(rootPackage.scripts.sniffer, 'node src/index-v7.js');
  assert.equal(rootPackage.scripts.workbench, 'node src/index-v7.js');
  assert.equal(rootPackage.scripts.v8, 'node src/index-v7.js');
  assert.equal(rootPackage.scripts['v8:cli'], undefined);
});

test('desktop defaults to stable sniffer while retaining explicit v8 opt-in and diagnostics', () => {
  assert.match(main, /MODBUS_DESKTOP_MODE/);
  assert.match(main, /\? 'index-v8\.js' : 'index-v7\.js'/);
  assert.match(main, /\? '\/api\/v8\/status' : '\/api\/status'/);
  assert.match(main, /\? '\/v8\/' : '\/'/);
  assert.match(main, /workbench-desktop\.log/);
  assert.match(main, /uncaughtExceptionMonitor/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /BACKEND-ERROR/);
  assert.equal(desktopPackage.build.productName, 'Modbus Sniffer');
});

test('desktop data migration preserves an existing destination and reports migration', () => {
  assert.match(storage, /Never merge an old workspace into an already populated destination/);
  assert.match(storage, /\.desktop-storage-v2\.json/);
  assert.match(storage, /DESKTOP_DATA_MIGRATION_FAILED/);
  assert.match(storage, /COPYFILE_EXCL/);
});

test('Windows packaging workflow smoke-tests stable Sniffer and emits provenance/checksums', () => {
  assert.match(workflow, /npm run version:check/);
  assert.match(workflow, /http:\/\/127\.0\.0\.1:18787\/api\/status/);
  assert.match(workflow, /product=Modbus Sniffer/);
  assert.match(workflow, /runtime=unified-modbus-engineering-tool/);
  assert.doesNotMatch(workflow, /experimental_runtime=/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /modbus-sniffer-windows/);
});

test('desktop support documentation identifies userData storage and external Windows acceptance', () => {
  assert.match(diagnostics, /<userData>\/data/);
  assert.match(diagnostics, /<userData>\/logs\/workbench-desktop\.log/);
  assert.match(diagnostics, /actual target Windows machine/);
  assert.match(diagnostics, /Do not collect TLS private keys/);
});
