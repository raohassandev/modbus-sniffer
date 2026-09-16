'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src', 'v8');

function collectJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

const files = collectJs(sourceRoot);
for (const extra of [
  path.join(root, 'src', 'index-v8.js'),
  path.join(root, 'public', 'v8', 'app.js'),
  path.join(root, 'public', 'v8', 'shell-extras.js'),
]) {
  if (fs.existsSync(extra)) files.push(extra);
}
files.sort();

if (!files.length) {
  console.error('No v8 JavaScript files found.');
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    console.error(`Syntax check failed: ${path.relative(root, file)}`);
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failures) {
  console.error(`v8 syntax gate FAIL: ${failures}/${files.length} file(s) failed.`);
  process.exit(1);
}

console.log(`v8 syntax gate PASS: ${files.length} file(s) checked.`);
