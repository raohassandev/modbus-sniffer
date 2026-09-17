'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const shell = read('public/v8/shell-extras.js');
const monitor = read('public/v8/standard-monitor.js');
const monitorCss = read('public/v8/standard-monitor.css');
const help = read('public/v8/help.js');
const plan = read('docs/STANDARD_MODBUS_WORKFLOW.md');

test('shell exposes the standard commissioning order and help', () => {
  assert.match(shell, /loadScript\('\/v8\/standard-monitor\.js'\)/);
  assert.match(shell, /loadScript\('\/v8\/help\.js'\)/);
  assert.match(shell, /\['connections', 'master', 'discovery', 'traffic', 'simulator', 'registerLab', 'testCenter', 'charts', 'historian', 'automation', 'hmi', 'help', 'settings'\]/);
  assert.match(shell, /Master \/ Poll/);
  assert.match(shell, /Scan \/ Discovery/);
});

test('standard monitor provides familiar read definition and live polling controls', () => {
  for (const id of ['standardUnit', 'standardFc', 'standardAddress', 'standardQuantity', 'standardScanRate', 'standardTimeout', 'standardFormat', 'standardReadOnce', 'standardStart', 'standardStop', 'standardValuesBody']) {
    assert.match(monitor, new RegExp(`id=\\"${id}\\"`), `${id} must remain in Standard Monitor`);
  }
  assert.match(monitor, /\/api\/v8\/master\/read/);
  assert.match(monitor, /\[1, 2, 3, 4\]\.includes\(functionCode\)/);
  assert.match(monitor, /referenceAddress\(functionCode, address\)/);
  assert.match(monitor, /state\.requests \+= 1/);
  assert.match(monitor, /state\.errors \+= 1/);
  assert.match(monitorCss, /\.standard-values-wrap\{max-height:330px/);
});

test('help covers each major workspace plus addressing and function codes', () => {
  for (const topic of ['connections', 'master', 'discovery', 'traffic', 'simulator', 'registerLab', 'testCenter', 'charts', 'historian', 'automation', 'hmi', 'settings', 'addressing', 'functionCodes', 'workflow']) {
    assert.match(help, new RegExp(`id: '${topic}'`), `help topic ${topic} must exist`);
  }
  assert.match(help, /event\.key !== 'F1'/);
  assert.match(help, /40001/);
  assert.match(help, /FC22/);
  assert.match(help, /FC23/);
});

test('parity plan keeps unfinished standard workflow work visible', () => {
  assert.match(plan, /persistent per-cell aliases\/names/);
  assert.match(plan, /FC08 Diagnostics/);
  assert.match(plan, /FC11 Get Comm Event Counter/);
  assert.match(plan, /FC17 Report Server ID/);
  assert.match(plan, /first-class Monitor Session model/);
  assert.match(plan, /Chart this range/);
});
