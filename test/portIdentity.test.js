'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIdentity, findReboundPort } = require('../src/portIdentity');

test('rebinds the same adapter by serial number if COM path changes', () => {
  const identity = buildIdentity({ path: 'COM5', vendorId: '0403', productId: '6001', serialNumber: 'ABC123' });
  const ports = [
    { path: 'COM2', vendorId: '1234', productId: '9999' },
    { path: 'COM9', vendorId: '0403', productId: '6001', serialNumber: 'ABC123' }
  ];
  assert.equal(findReboundPort(ports, identity).path, 'COM9');
});

test('does not guess when multiple VID/PID matches exist without a serial number', () => {
  const identity = buildIdentity({ path: 'COM5', vendorId: '0403', productId: '6001' });
  const ports = [
    { path: 'COM8', vendorId: '0403', productId: '6001' },
    { path: 'COM9', vendorId: '0403', productId: '6001' }
  ];
  assert.equal(findReboundPort(ports, identity), null);
});
