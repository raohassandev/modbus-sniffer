'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const p = require('../src/v8/protocol');

test('v8 data core decodes and encodes signed/unsigned values with byte-word permutations', () => {
  const u32 = 0x12345678;
  assert.equal(p.decodeUInt32(p.encodeUInt32(u32)), u32);
  assert.equal(p.decodeUInt32(p.encodeUInt32(u32, { order: 'CDAB' }), { order: 'CDAB' }), u32);
  assert.equal(p.decodeUInt32(Buffer.from('56781234', 'hex'), { order: 'CDAB' }), u32);

  const i32 = -123456789;
  assert.equal(p.decodeInt32(p.encodeInt32(i32, { order: 'DCBA' }), { order: 'DCBA' }), i32);
  assert.equal(p.decodeInt16(p.encodeInt16(-32768)), -32768);
  assert.equal(p.decodeUInt16(p.encodeUInt16(65535)), 65535);
});

test('v8 data core keeps exact 64-bit integer values as BigInt', () => {
  const unsigned = 0xFEDCBA9876543210n;
  const signed = -0x123456789ABCDEFn;
  assert.equal(p.decodeUInt64(p.encodeUInt64(unsigned)), unsigned);
  assert.equal(p.decodeInt64(p.encodeInt64(signed, { order: 'HGFEDCBA' }), { order: 'HGFEDCBA' }), signed);
  assert.equal(typeof p.decodeUInt64(Buffer.from('FFFFFFFFFFFFFFFF', 'hex')), 'bigint');
});

test('v8 data core supports float32/float64 and common Modbus byte orders', () => {
  const f32 = 123.75;
  const f64 = -98765.125;
  assert.ok(Math.abs(p.decodeFloat32(p.encodeFloat32(f32, { order: 'BADC' }), { order: 'BADC' }) - f32) < 1e-6);
  assert.equal(p.decodeFloat64(p.encodeFloat64(f64, { order: 'GHEFCDAB' }), { order: 'GHEFCDAB' }), f64);
});

test('v8 data core converts register arrays and ASCII safely', () => {
  const bytes = p.registersToBytes([0x4142, 0x4344]);
  assert.equal(bytes.toString('hex').toUpperCase(), '41424344');
  assert.deepEqual(p.bytesToRegisters(bytes), [0x4142, 0x4344]);
  assert.equal(p.decodeAscii(p.encodeAscii('SOLIS', { registers: 4 })), 'SOLIS');
  assert.throws(() => p.registersToBytes([70000]), (error) => error.code === 'INTEGER_OUT_OF_RANGE');
});

test('v8 data core BCD helpers round-trip values and reject invalid nibbles', () => {
  assert.equal(p.encodeBcd(123456, { bytes: 4 }).toString('hex').toUpperCase(), '00123456');
  assert.equal(p.decodeBcd(Buffer.from('00123456', 'hex')), 123456);
  assert.equal(p.decodeBcd(p.encodeBcd(12345678901234567890n)), 12345678901234567890n);
  assert.throws(() => p.decodeBcd(Buffer.from([0xFA])), (error) => error.code === 'INVALID_BCD');
});

test('v8 data core provides deterministic timestamp/date interpretations', () => {
  const seconds = p.encodeUInt32(1704067200);
  const unix = p.decodeUnixTimestamp(seconds);
  assert.equal(unix.iso, '2024-01-01T00:00:00.000Z');

  const date = p.decodeDateTimeRegisters([2026, 9, 16, 8, 30, 45]);
  assert.equal(date.iso, '2026-09-16T08:30:45.000Z');
  assert.throws(() => p.decodeDateTimeRegisters([2026, 2, 30, 0, 0, 0]), (error) => error.code === 'INVALID_DATETIME');
});

test('v8 data core rejects malformed byte orders and unsafe inputs', () => {
  assert.throws(() => p.decodeUInt32(Buffer.from('00000000', 'hex'), { order: 'AABC' }), (error) => error.code === 'INVALID_BYTE_ORDER');
  assert.throws(() => p.decodeUInt32(Buffer.from('0000', 'hex')), (error) => error.code === 'INVALID_LENGTH');
  assert.throws(() => p.encodeUInt64(-1n), (error) => error.code === 'INTEGER_OUT_OF_RANGE');
  assert.throws(() => p.encodeFloat32(Number.POSITIVE_INFINITY), (error) => error.code === 'INVALID_FLOAT');
});
