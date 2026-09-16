'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.resolve(__dirname, '..', 'test');
const sqliteFiles = new Set(['v8-history.test.js', 'v8-history-workspace.test.js']);
const regular = fs.readdirSync(testDir)
  .filter((name) => name.endsWith('.test.js') && !sqliteFiles.has(name))
  .sort()
  .map((name) => path.join('test', name));

function run(args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, ['--test', ...args], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(regular, 'Windows full suite without node:sqlite files');
for (const name of [...sqliteFiles].sort()) run([path.join('test', name)], `Windows isolated ${name}`);
