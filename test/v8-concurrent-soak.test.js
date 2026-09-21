'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('v8 concurrent Master/Slave/Traffic/Register-Lab/chart soak stays healthy', { timeout: 20000 }, () => {
  const script = path.resolve(__dirname, '../scripts/soak-v8.js');
  const result = spawnSync(process.execPath, [
    script,
    '--seconds', '3',
    '--devices', '10',
    '--interval-ms', '100',
    '--max-heap-mb', '512',
  ], {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.error, undefined, result.error?.message || 'soak spawn failed');
  assert.equal(result.signal, null, `soak terminated by ${result.signal}`);
  assert.equal(result.status, 0, `soak failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, /V8 CONCURRENT SOAK: PASS/);
});
