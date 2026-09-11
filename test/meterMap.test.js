'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeMapped } = require('../src/meterMap');

test('decodes common 32-bit word/byte orders', () => {
  assert.equal(decodeMapped([0x1122, 0x3344], 'uint32', 'ABCD'), 0x11223344);
  assert.equal(decodeMapped([0x1122, 0x3344], 'uint32', 'CDAB'), 0x33441122);
  assert.equal(decodeMapped([0x1122, 0x3344], 'uint32', 'DCBA'), 0x44332211);
});

test('decodes 64-bit big-endian register sequence', () => {
  const value = decodeMapped([0x0001, 0x0002, 0x0003, 0x0004], 'uint64', 'ABCDEFGH');
  assert.equal(value, 0x0001000200030004n);
});
