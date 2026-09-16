'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const gatePath = path.join(root, 'scripts', 'release-gate-mac.sh');
const script = fs.readFileSync(gatePath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const macWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8');
const windowsWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'desktop-windows.yml'), 'utf8');

function includesAll(text, values) {
  for (const value of values) assert.match(text, value, `release gate must retain ${value}`);
}

test('v8 local Mac release gate shell syntax is valid', { skip: process.platform === 'win32' }, () => {
  const result = spawnSync('bash', ['-n', gatePath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || 'bash -n failed');
});

test('v8 local Mac release gate is the npm-exposed deterministic exact-head gate', () => {
  assert.equal(pkg.scripts['release:gate:mac'], 'bash scripts/release-gate-mac.sh');
  includesAll(script, [
    /uname -s/,
    /Darwin/,
    /git rev-parse HEAD/,
    /git status --porcelain/,
    /\.release-evidence/,
    /summary\.txt/,
    /release-gate\.log/,
    /lockfile-sha256\.txt/,
  ]);
  assert.doesNotMatch(script, /--untracked-files=no/);
});

test('release evidence and deterministic browser runtime artifacts are ignored without weakening clean-tree checks', () => {
  for (const entry of ['.release-evidence/', '.tmp/', 'test-results/', 'playwright-report/']) {
    assert.match(gitignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
});

test('v8 local Mac release gate requires Node 20, 22 and 24 full validation', () => {
  assert.match(script, /for NODE_MAJOR in 20 22 24/);
  includesAll(script, [
    /npm ci/,
    /npm run version:check/,
    /npm run check:v8/,
    /npm test/,
    /npm run smoke/,
    /npm run acceptance/,
  ]);
});

test('v8 local Mac release gate retains release quality, soak and browser evidence', () => {
  includesAll(script, [
    /npm run lint/,
    /npm run benchmark:v8/,
    /benchmark-v7\.js/,
    /npm run audit:runtime/,
    /npm run soak:v8 -- --seconds/,
    /playwright install chromium/,
    /npm run e2e/,
    /LOCAL MAC RELEASE GATE: PASS/,
  ]);
});

test('v8 local Mac release gate never silently skips an unavailable Node major', () => {
  assert.match(script, /Node \$target is required but is unavailable/);
  assert.match(script, /requested Node \$target but active version is/);
  assert.doesNotMatch(script, /continue.*Node.*unavailable/i);
});

test('GitHub workflows are manual-only and cannot consume hosted runners on normal branch activity', () => {
  for (const [name, workflow] of [['Mac validation', macWorkflow], ['Windows packaging', windowsWorkflow]]) {
    assert.match(workflow, /workflow_dispatch:/, `${name} must remain manually dispatched`);
    assert.doesNotMatch(workflow, /^\s{2}push:/m, `${name} must not run automatically on push`);
    assert.doesNotMatch(workflow, /^\s{2}pull_request:/m, `${name} must not run automatically on pull requests`);
  }
  assert.match(macWorkflow, /self-hosted/);
  assert.match(macWorkflow, /automatrix-mac/);
});
