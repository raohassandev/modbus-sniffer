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
  assert.match(shell, /const order = \['master', 'simulator', 'traffic', 'registerLab', 'discovery', 'testCenter', 'charts', 'historian', 'automation', 'connections', 'help', 'settings'\]/);
  assert.doesNotMatch(shell, /order = \[[^\]]*'hmi'/);
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
  for (const topic of ['connections', 'master', 'discovery', 'traffic', 'simulator', 'registerLab', 'testCenter', 'charts', 'historian', 'automation', 'settings', 'addressing', 'functionCodes', 'workflow']) {
    assert.match(help, new RegExp(`id: '${topic}'`), `help topic ${topic} must exist`);
  }
  assert.match(help, /event\.key !== 'F1'/);
  assert.match(help, /40001/);
  assert.match(help, /<td>22<\/td><td>Mask Write Register<\/td>/);
  assert.match(help, /<td>23<\/td><td>Read\/Write Multiple Registers<\/td>/);
  assert.doesNotMatch(help, /id: 'hmi'/);
  assert.doesNotMatch(help, /parity gap/);
});

test('standard workflow documents the completed Modbus-only engineering contract', () => {
  assert.match(plan, /FC22\/23/);
  assert.match(plan, /serial FC07\/08\/11\/12\/17/);
  assert.match(plan, /FC20\/21 file records/);
  assert.match(plan, /FC24 FIFO/);
  assert.match(plan, /FC43\/14 identity/);
  assert.match(plan, /multi-session monitors/);
  assert.match(plan, /Logger \/ Trend/);
  assert.match(plan, /HMI -> removed from this product/);
});
