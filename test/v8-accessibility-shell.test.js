'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const shellJs = fs.readFileSync(path.join(root, 'public/v8/shell-extras.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'public/v8/shell-extras.css'), 'utf8');
const stylesCss = fs.readFileSync(path.join(root, 'public/v8/styles.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public/v8/index.html'), 'utf8');

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('v8 shell exposes keyboard-accessible document tabs', () => {
  assert.match(shellJs, /setAttribute\('role', 'tablist'\)/);
  assert.match(shellJs, /setAttribute\('role', 'tab'\)/);
  assert.match(shellJs, /setAttribute\('aria-selected'/);
  assert.match(shellJs, /tab\.tabIndex = workspace === activeTab \? 0 : -1/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.ok(shellJs.includes(`'${key}'`), `expected ${key} tab keyboard handling`);
  }
});

test('v8 Connection Center table supports keyboard row selection and navigation', () => {
  assert.match(shellJs, /row\.tabIndex = 0/);
  assert.match(shellJs, /aria-selected/);
  assert.match(shellJs, /MutationObserver/);
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter']) {
    assert.ok(shellJs.includes(`'${key}'`), `expected ${key} connection-row keyboard handling`);
  }
});

test('v8 shell has visible focus and reduced-motion support', () => {
  assert.match(shellCss, /:focus-visible/);
  assert.match(shellCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(shellCss, /\.button:hover\s*\{\s*transform:\s*none/);
});

test('v8 light and dark core text tokens meet WCAG AA normal-text contrast', () => {
  for (const token of ['#17202b', '#617080', '#edf2f7', '#9aabba', '#1f6feb', '#4c96ff']) {
    assert.ok(stylesCss.toLowerCase().includes(token), `expected color token ${token}`);
  }
  const pairs = [
    ['light text/background', '#17202b', '#f5f7fa'],
    ['light muted/surface', '#617080', '#ffffff'],
    ['light accent/surface', '#1f6feb', '#ffffff'],
    ['dark text/background', '#edf2f7', '#0e131a'],
    ['dark muted/surface', '#9aabba', '#151c25'],
    ['dark accent/surface', '#4c96ff', '#151c25'],
  ];
  for (const [label, foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${label} must meet 4.5:1 contrast`);
  }
});

test('v8 shell retains semantic page/live-status landmarks and release identity', () => {
  assert.match(indexHtml, /<html lang="en"/);
  assert.match(indexHtml, /aria-label="Primary navigation"/);
  assert.match(indexHtml, /aria-live="polite"/);
  assert.match(indexHtml, /role="alert"/);
  assert.match(shellJs, /compatibility Modbus engineering shell/);
  assert.doesNotMatch(shellJs, /release-candidate workspace/);
});
