'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('source preflight avoids direct npm.cmd spawn on Windows',()=>{
  const source=read('scripts/source-preflight.js');
  assert.match(source,/process\.env\.npm_execpath/);
  assert.match(source,/spawnSync\(process\.execPath/);
  assert.match(source,/ComSpec/);
  assert.doesNotMatch(source,/spawnSync\([^\n]*npm\.cmd/);
});

test('unified Playwright gate isolates each runtime and allows slower Windows startup',()=>{
  const source=read('playwright.unified.config.js');
  assert.match(source,/process\.pid/);
  assert.match(source,/MODBUS_E2E_PORT/);
  assert.match(source,/reuseExistingServer:\s*false/);
  assert.match(source,/timeout:\s*60000/);
  assert.match(source,/e2e-unified-\$\{process\.pid\}/);
});

test('Windows desktop packaging kills stale product process and retries locked dist cleanup',()=>{
  const clean=read('desktop/clean-dist.js');
  const desktop=JSON.parse(read('desktop/package.json'));
  assert.match(clean,/Modbus Engineering Tool\.exe/);
  assert.match(clean,/taskkill/);
  assert.match(clean,/fs\.rmSync/);
  assert.match(clean,/maxRetries/);
  assert.match(clean,/DESKTOP_DIST_LOCKED/);
  assert.match(desktop.scripts['dist:win'],/node clean-dist\.js/);
  assert.match(desktop.scripts['dist:win'],/electron-builder --win nsis/);
});
