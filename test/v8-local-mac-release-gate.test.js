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
    /export CI=true/,
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

test('release evidence and deterministic browser runtime artifacts are ignored and stale test state is cleared safely', () => {
  for (const entry of ['.release-evidence/', '.tmp/', 'test-results/', 'playwright-report/']) {
    assert.match(gitignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.match(script, /rm -rf "\$ROOT\/\.tmp" "\$ROOT\/test-results" "\$ROOT\/playwright-report"/);
  assert.doesNotMatch(script, /rm -rf[^\n]*(?:"\$ROOT\/data"|"\$ROOT\/logs")/);
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

test('v8 local Mac release gate retains release quality, bounded soak and browser evidence', () => {
  includesAll(script, [
    /RELEASE_GATE_SOAK_SECONDS must be an integer from 1 to 86400/,
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

test('dirty diagnostic mode can never produce release PASS evidence', () => {
  assert.match(script, /echo "allow_dirty=\$ALLOW_DIRTY"/);
  assert.match(script, /echo "release_eligible=\$RELEASE_ELIGIBLE"/);
  assert.match(script, /RELEASE_GATE_ALLOW_DIRTY=1 is diagnostic-only and cannot produce release PASS evidence/);

  const dirtyGuardIndex = script.lastIndexOf('if [ "$ALLOW_DIRTY" = "1" ]; then');
  const passIndex = script.lastIndexOf('STATUS="PASS"');
  assert.ok(dirtyGuardIndex >= 0, 'dirty diagnostic release guard must exist');
  assert.ok(passIndex >= 0, 'release PASS assignment must exist');
  assert.ok(dirtyGuardIndex < passIndex, 'dirty diagnostic release guard must execute before PASS assignment');

  const guardedTail = script.slice(dirtyGuardIndex, passIndex);
  assert.match(guardedTail, /exit 6/);
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
