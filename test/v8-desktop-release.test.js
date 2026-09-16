'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'desktop/main.js'), 'utf8');
const storage = fs.readFileSync(path.join(root, 'desktop/storage.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/desktop-windows.yml'), 'utf8');
const diagnostics = fs.readFileSync(path.join(root, 'docs/DESKTOP_DIAGNOSTICS.md'), 'utf8');

test('desktop shell starts the v8 backend and persists support diagnostics', () => {
  assert.match(main, /src', 'index-v8\.js/);
  assert.match(main, /\/api\/v8\/status/);
  assert.match(main, /workbench-desktop\.log/);
  assert.match(main, /uncaughtExceptionMonitor/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /BACKEND-ERROR/);
});

test('desktop data migration preserves an existing destination and reports migration', () => {
  assert.match(storage, /Never merge an old workspace into an already populated destination/);
  assert.match(storage, /\.desktop-storage-v2\.json/);
  assert.match(storage, /DESKTOP_DATA_MIGRATION_FAILED/);
  assert.match(storage, /COPYFILE_EXCL/);
});

test('Windows packaging workflow targets Workbench v8 and emits provenance/checksums', () => {
  assert.match(workflow, /npm run version:check/);
  assert.match(workflow, /\/api\/v8\/status/);
  assert.match(workflow, /Modbus Engineering Workbench/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /modbus-engineering-workbench-windows/);
});

test('desktop support documentation identifies userData storage and external Windows acceptance', () => {
  assert.match(diagnostics, /<userData>\/data/);
  assert.match(diagnostics, /<userData>\/logs\/workbench-desktop\.log/);
  assert.match(diagnostics, /actual target Windows machine/);
  assert.match(diagnostics, /Do not collect TLS private keys/);
});
