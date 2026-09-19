'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');
const sqliteFiles = new Set(['v8-history.test.js', 'v8-history-workspace.test.js']);
const regular = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js') && !sqliteFiles.has(name))
  .sort()
  .map((name) => path.join('test', name));

const missing = [...sqliteFiles].filter((name) => !fs.existsSync(path.join(testDir, name)));
if (missing.length) throw new Error(`Missing expected SQLite test file(s): ${missing.join(', ')}`);

function run(args, label, timeoutMs) {
  console.log(`\n=== ${label} ===`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ['--test', ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });
  const elapsedMs = Date.now() - startedAt;
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`\n${label} exceeded ${timeoutMs} ms and was terminated after ${elapsedMs} ms.`);
    process.exit(124);
  }
  if (result.error) throw result.error;
  if (result.signal) {
    console.error(`\n${label} terminated by signal ${result.signal} after ${elapsedMs} ms.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`=== ${label} PASS (${elapsedMs} ms) ===`);
}

// These bounds intentionally fail CI rather than allowing a leaked handle or
// node:sqlite shutdown issue to occupy a Windows runner for hours. The regular
// suite historically completes well inside this window; SQLite files run one
// at a time so any offender is named directly in the log.
run(regular, 'Windows full suite without node:sqlite files', 8 * 60 * 1000);
for (const name of [...sqliteFiles].sort()) {
  run([path.join('test', name)], `Windows isolated ${name}`, 3 * 60 * 1000);
}
