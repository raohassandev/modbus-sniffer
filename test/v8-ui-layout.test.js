'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'public', 'v8', name), 'utf8');

const shell = read('shell-extras.css');
const master = read('master.css');
const simulator = read('simulator.css');
const traffic = read('traffic-register.css');

test('v8 shell prevents intrinsic form controls from overflowing workspace grids', () => {
  assert.match(shell, /@media \(min-width: 1181px\)[\s\S]*\.app-shell \{ grid-template-columns: 200px minmax\(0, 1fr\) 268px; \}/);
  assert.match(shell, /\.field input,[\s\S]*\.field select,[\s\S]*\.field textarea,[\s\S]*\.text-input[\s\S]*width: 100%;[\s\S]*min-width: 0;/);
  assert.match(shell, /\.metric-card strong[\s\S]*overflow-wrap: anywhere;/);
});

test('master and discovery cards use padded, bounded responsive forms', () => {
  assert.match(master, /\.master-card,\.master-poll-panel,\.master-write-panel\{min-width:0;padding:14px\}/);
  assert.match(master, /\.master-form-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(master, /repeat\(5,minmax\(110px,1fr\)\)/);
  assert.match(master, /@media\(max-width:1320px\)\{\.master-grid\{grid-template-columns:1fr\}/);
});

test('simulator cards auto-fit controls instead of bleeding across columns', () => {
  assert.match(simulator, /\.simulator-card \{ min-width: 0; padding: 14px; \}/);
  assert.match(simulator, /grid-template-columns: repeat\(auto-fit, minmax\(132px, 1fr\)\)/);
  assert.match(simulator, /\.simulator-stack \{ display: grid; gap: 14px; min-width: 0; \}/);
});

test('traffic and register lab use valid theme variables and bounded panels', () => {
  assert.doesNotMatch(traffic, /--text-muted|--surface-1|--border-subtle/);
  assert.match(traffic, /\.traffic-viewport\{[^}]*height:clamp\(300px,42vh,460px\)/);
  assert.match(traffic, /\.traffic-inspector\{[^}]*padding:14px/);
  assert.match(traffic, /\.register-layout\{[^}]*align-items:start/);
  assert.match(traffic, /\.register-layout>aside\.panel\{[^}]*padding:14px/);
  assert.match(traffic, /\.register-lab-workspace \.metric-strip\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
});
