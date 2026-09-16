'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('../sdk/js');

test('v8 JavaScript SDK exposes safe Workbench client', () => {
  assert.equal(typeof sdk.WorkbenchApiClient, 'function');
  assert.equal(typeof sdk.WorkbenchClientError, 'function');
});
