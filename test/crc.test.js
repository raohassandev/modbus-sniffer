'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendCrc, hasValidCrc } = require('../src/modbus/crc16');

const payload = Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0A]);

test('appendCrc creates a valid Modbus RTU frame', () => {
  const frame = appendCrc(payload);
  assert.equal(frame.toString('hex').toUpperCase(), '01030000000AC5CD');
  assert.equal(hasValidCrc(frame), true);
});
