const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.resolve(__dirname, '..', 'test');
const sqliteTests = new Set([
  'v8-history.test.js',
  'v8-history-workspace.test.js'
]);

const allTests = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.js'))
  .sort();
const regularTests = allTests.filter(name => !sqliteTests.has(name));
const isolatedTests = allTests.filter(name => sqliteTests.has(name));

if (isolatedTests.length !== sqliteTests.size) {
  const missing = [...sqliteTests].filter(name => !isolatedTests.includes(name));
  throw new Error(`Missing expected SQLite test file(s): ${missing.join(', ')}`);
}

function run(files, label) {
  if (!files.length) return;
  console.log(`\n=== ${label} (${files.length} file${files.length === 1 ? '' : 's'}) ===`);
  const result = spawnSync(process.execPath, ['--test', ...files.map(name => path.join(testDir, name))], {
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run(regularTests, 'Concurrent non-SQLite test suite');
for (const name of isolatedTests) run([name], `Isolated SQLite test: ${name}`);
