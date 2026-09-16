'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shellJs = fs.readFileSync(path.join(root, 'public/v8/shell-extras.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'public/v8/shell-extras.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/v8/index.html'), 'utf8');

test('v8 shell exposes keyboard-accessible document tabs', () => {
  assert.match(shellJs, /setAttribute\('role', 'tablist'\)/);
  assert.match(shellJs, /setAttribute\('role', 'tab'\)/);
  assert.match(shellJs, /setAttribute\('aria-selected'/);
  assert.match(shellJs, /tab\.tabIndex = workspace === activeTab \? 0 : -1/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.ok(shellJs.includes(`'${key}'`), `expected ${key} keyboard handling`);
  }
});

test('v8 shell has visible focus and reduced-motion support', () => {
  assert.match(shellCss, /:focus-visible/);
  assert.match(shellCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(shellCss, /\.button:hover\s*\{\s*transform:\s*none/);
});

test('v8 shell retains semantic page and live-status landmarks', () => {
  assert.match(indexHtml, /<html lang="en"/);
  assert.match(indexHtml, /aria-label="Primary navigation"/);
  assert.match(indexHtml, /aria-live="polite"/);
  assert.match(indexHtml, /role="alert"/);
});
