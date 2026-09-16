'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('v8 bounded scale benchmark covers 100 jobs, 100 devices, 10k registers and 100k traffic events', { timeout: 45000 }, () => {
  const script = path.resolve(__dirname, '../scripts/benchmark-v8.js');
  const result = spawnSync(process.execPath, [
    script,
    '--poll-jobs', '100',
    '--devices', '100',
    '--registers-per-device', '100',
    '--traffic-events', '100000',
    '--max-ms', '30000',
    '--max-heap-mb', '768',
  ], {
    encoding: 'utf8',
    timeout: 40000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.error, undefined, result.error?.message || 'benchmark spawn failed');
  assert.equal(result.signal, null, `benchmark terminated by ${result.signal}`);
  assert.equal(result.status, 0, `benchmark failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  assert.match(result.stdout, /V8 SCALE BENCHMARK: PASS/);
});
