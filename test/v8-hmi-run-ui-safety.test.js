'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hmiErrorStatus } = require('../src/v8/hmi/hmiRoutes');

const sourcePath = path.resolve(__dirname, '..', 'public', 'v8', 'hmi-workspace.js');

function source() {
  return fs.readFileSync(sourcePath, 'utf8');
}

test('v8 HMI browser workspace remains syntactically valid after run-safety hardening', () => {
  assert.doesNotThrow(() => new vm.Script(source(), { filename: 'hmi-workspace.js' }));
});

test('v8 HMI Run mode blocks unsaved definitions and prompts bulk for multi-word datatypes', () => {
  const text = source();
  assert.match(text, /mode === 'run' && state\.dirty/);
  assert.match(text, /Save HMI changes before entering Run mode/);
  assert.match(text, /multiWordTypes\.has\(String\(widget\.binding\?\.dataType\|\|''\)\)/);
  assert.match(text, /confirmation:\{confirmed:true,\.\.\.\(bulk\?\{bulk:true\}:\{\}\)\}/);
});

test('v8 HMI bulk confirmation errors are client errors, not internal errors', () => {
  assert.equal(hmiErrorStatus({ code: 'BULK_CONFIRMATION_REQUIRED' }), 400);
});
