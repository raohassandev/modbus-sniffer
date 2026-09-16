'use strict';

const { fail } = require('./errors');

function asBuffer(value, field = 'bytes') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Buffer.from(value);
  fail('INVALID_BUFFER', `${field} must be a Buffer or byte array`, { field });
}

function assertLength(bytes, expected, field = 'bytes') {
  if (bytes.length !== expected) fail('INVALID_LENGTH', `${field} must contain exactly ${expected} bytes`, { field, expected, actual: bytes.length });
}

function normalizeOrder(order, length) {
  if (order == null) return Array.from({ length }, (_, index) => index);
  if (Array.isArray(order)) {
    if (order.length !== length || new Set(order).size !== length || order.some((index) => !Number.isInteger(index) || index < 0 || index >= length)) {
      fail('INVALID_BYTE_ORDER', `Byte-order index list must be a permutation of 0..${length - 1}`, { order, length });
    }
    return [...order];
  }
  const text = String(order).trim().toUpperCase();
  if (text.length !== length) fail('INVALID_BYTE_ORDER', `Byte-order text must contain ${length} letters`, { order: text, length });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, length);
  if ([...text].sort().join('') !== [...alphabet].sort().join('')) {
    fail('INVALID_BYTE_ORDER', `Byte order must be a permutation of ${alphabet}`, { order: text, length });
  }
  return [...text].map((letter) => alphabet.indexOf(letter));
}

function permuteBytes(value, order) {
  const bytes = asBuffer(value);
  const indexes = normalizeOrder(order, bytes.length);
  return Buffer.from(indexes.map((index) => bytes[index]));
}

function canonicalBytes(value, order, expectedLength) {
  const bytes = asBuffer(value);
  assertLength(bytes, expectedLength);
  const indexes = normalizeOrder(order, expectedLength);
  const inverse = new Array(expectedLength);
  indexes.forEach((canonicalIndex, wireIndex) => { inverse[canonicalIndex] = wireIndex; });
  return Buffer.from(inverse.map((wireIndex) => bytes[wireIndex]));
}

function encodeOrdered(canonical, order) {
  return permuteBytes(canonical, order);
}

function decodeUInt16(bytes, { order = 'AB' } = {}) {
  return canonicalBytes(bytes, order, 2).readUInt16BE(0);
}

function decodeInt16(bytes, { order = 'AB' } = {}) {
  return canonicalBytes(bytes, order, 2).readInt16BE(0);
}

function decodeUInt32(bytes, { order = 'ABCD' } = {}) {
  return canonicalBytes(bytes, order, 4).readUInt32BE(0);
}

function decodeInt32(bytes, { order = 'ABCD' } = {}) {
  return canonicalBytes(bytes, order, 4).readInt32BE(0);
}

function decodeUInt64(bytes, { order = 'ABCDEFGH' } = {}) {
  return canonicalBytes(bytes, order, 8).readBigUInt64BE(0);
}

function decodeInt64(bytes, { order = 'ABCDEFGH' } = {}) {
  return canonicalBytes(bytes, order, 8).readBigInt64BE(0);
}

function decodeFloat32(bytes, { order = 'ABCD' } = {}) {
  return canonicalBytes(bytes, order, 4).readFloatBE(0);
}

function decodeFloat64(bytes, { order = 'ABCDEFGH' } = {}) {
  return canonicalBytes(bytes, order, 8).readDoubleBE(0);
}

function integerRange(value, min, max, field = 'value') {
  if (!Number.isInteger(value) || value < min || value > max) fail('INTEGER_OUT_OF_RANGE', `${field} is outside ${min}..${max}`, { field, value, min, max });
  return value;
}

function bigIntRange(value, min, max, field = 'value') {
  let normalized;
  try { normalized = BigInt(value); } catch { fail('INVALID_BIGINT', `${field} must be an integer/BigInt`, { field, value: String(value) }); }
  if (normalized < min || normalized > max) fail('INTEGER_OUT_OF_RANGE', `${field} is outside the supported 64-bit range`, { field, value: normalized.toString(), min: min.toString(), max: max.toString() });
  return normalized;
}

function encodeUInt16(value, { order = 'AB' } = {}) {
  const canonical = Buffer.alloc(2);
  canonical.writeUInt16BE(integerRange(value, 0, 0xFFFF), 0);
  return encodeOrdered(canonical, order);
}

function encodeInt16(value, { order = 'AB' } = {}) {
  const canonical = Buffer.alloc(2);
  canonical.writeInt16BE(integerRange(value, -0x8000, 0x7FFF), 0);
  return encodeOrdered(canonical, order);
}

function encodeUInt32(value, { order = 'ABCD' } = {}) {
  const canonical = Buffer.alloc(4);
  canonical.writeUInt32BE(integerRange(value, 0, 0xFFFFFFFF), 0);
  return encodeOrdered(canonical, order);
}

function encodeInt32(value, { order = 'ABCD' } = {}) {
  const canonical = Buffer.alloc(4);
  canonical.writeInt32BE(integerRange(value, -0x80000000, 0x7FFFFFFF), 0);
  return encodeOrdered(canonical, order);
}

function encodeUInt64(value, { order = 'ABCDEFGH' } = {}) {
  const canonical = Buffer.alloc(8);
  canonical.writeBigUInt64BE(bigIntRange(value, 0n, 0xFFFFFFFFFFFFFFFFn), 0);
  return encodeOrdered(canonical, order);
}

function encodeInt64(value, { order = 'ABCDEFGH' } = {}) {
  const canonical = Buffer.alloc(8);
  canonical.writeBigInt64BE(bigIntRange(value, -0x8000000000000000n, 0x7FFFFFFFFFFFFFFFn), 0);
  return encodeOrdered(canonical, order);
}

function encodeFloat32(value, { order = 'ABCD' } = {}) {
  if (!Number.isFinite(value)) fail('INVALID_FLOAT', 'float32 value must be finite', { value });
  const canonical = Buffer.alloc(4);
  canonical.writeFloatBE(value, 0);
  return encodeOrdered(canonical, order);
}

function encodeFloat64(value, { order = 'ABCDEFGH' } = {}) {
  if (!Number.isFinite(value)) fail('INVALID_FLOAT', 'float64 value must be finite', { value });
  const canonical = Buffer.alloc(8);
  canonical.writeDoubleBE(value, 0);
  return encodeOrdered(canonical, order);
}

function registersToBytes(registers) {
  if (!Array.isArray(registers)) fail('INVALID_REGISTERS', 'registers must be an array');
  const bytes = Buffer.alloc(registers.length * 2);
  registers.forEach((value, index) => {
    integerRange(value, 0, 0xFFFF, `registers[${index}]`);
    bytes.writeUInt16BE(value, index * 2);
  });
  return bytes;
}

function bytesToRegisters(value) {
  const bytes = asBuffer(value);
  if ((bytes.length & 1) !== 0) fail('INVALID_REGISTER_BYTES', 'Register byte data must contain an even number of bytes', { length: bytes.length });
  const registers = [];
  for (let offset = 0; offset < bytes.length; offset += 2) registers.push(bytes.readUInt16BE(offset));
  return registers;
}

function encodeAscii(text, { registers = null, nullTerminate = false, pad = 0x00 } = {}) {
  if (typeof text !== 'string') fail('INVALID_STRING', 'ASCII value must be a string');
  integerRange(pad, 0, 0xFF, 'pad');
  let bytes = Buffer.from(text, 'ascii');
  if (nullTerminate) bytes = Buffer.concat([bytes, Buffer.from([0])]);
  if (registers != null) {
    integerRange(registers, 1, 0x7FFF, 'registers');
    const size = registers * 2;
    if (bytes.length > size) fail('STRING_TOO_LONG', 'ASCII value does not fit the requested register count', { bytes: bytes.length, registers });
    const padded = Buffer.alloc(size, pad);
    bytes.copy(padded);
    bytes = padded;
  }
  if ((bytes.length & 1) !== 0) bytes = Buffer.concat([bytes, Buffer.from([pad])]);
  return bytes;
}

function decodeAscii(value, { trimNull = true, trimSpace = false } = {}) {
  const bytes = asBuffer(value);
  let text = bytes.toString('ascii');
  if (trimNull) text = text.replace(/\0+$/g, '');
  if (trimSpace) text = text.replace(/\s+$/g, '');
  return text;
}

function decodeBcd(value, { digits = null } = {}) {
  const bytes = typeof value === 'number' ? Buffer.from([integerRange(value, 0, 0xFF)]) : asBuffer(value);
  let text = '';
  for (const byte of bytes) {
    const hi = byte >> 4;
    const lo = byte & 0x0F;
    if (hi > 9 || lo > 9) fail('INVALID_BCD', 'BCD contains a nibble greater than 9', { byte });
    text += `${hi}${lo}`;
  }
  if (digits != null) {
    integerRange(digits, 1, text.length, 'digits');
    text = text.slice(text.length - digits);
  }
  const numeric = Number(text);
  return Number.isSafeInteger(numeric) ? numeric : BigInt(text);
}

function encodeBcd(value, { bytes = null } = {}) {
  const textValue = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^\d+$/.test(textValue)) fail('INVALID_BCD', 'BCD source must contain decimal digits only', { value: textValue });
  let text = textValue.length & 1 ? `0${textValue}` : textValue;
  if (bytes != null) {
    integerRange(bytes, 1, 127, 'bytes');
    if (text.length > bytes * 2) fail('BCD_TOO_LARGE', 'BCD value does not fit requested byte count', { value: textValue, bytes });
    text = text.padStart(bytes * 2, '0');
  }
  const out = Buffer.alloc(text.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function decodeUnixTimestamp(value, { unit = 'seconds', order = 'ABCD', signed = false } = {}) {
  const bytes = asBuffer(value);
  let raw;
  if (bytes.length === 4) raw = signed ? BigInt(decodeInt32(bytes, { order })) : BigInt(decodeUInt32(bytes, { order }));
  else if (bytes.length === 8) raw = signed ? decodeInt64(bytes, { order }) : decodeUInt64(bytes, { order });
  else fail('INVALID_TIMESTAMP_LENGTH', 'Unix timestamp must use 4 or 8 bytes', { length: bytes.length });
  const factor = unit === 'milliseconds' ? 1n : unit === 'seconds' ? 1000n : null;
  if (factor == null) fail('INVALID_TIMESTAMP_UNIT', 'Timestamp unit must be seconds or milliseconds', { unit });
  const millis = raw * factor;
  const asNumber = Number(millis);
  if (!Number.isSafeInteger(asNumber)) fail('TIMESTAMP_OUT_OF_RANGE', 'Timestamp is outside JavaScript Date safe range', { millis: millis.toString() });
  const date = new Date(asNumber);
  if (Number.isNaN(date.getTime())) fail('TIMESTAMP_OUT_OF_RANGE', 'Timestamp cannot be represented as a Date', { millis: millis.toString() });
  return Object.freeze({ raw, unit, date, iso: date.toISOString() });
}

function decodeDateTimeRegisters(registers, { order = ['year', 'month', 'day', 'hour', 'minute', 'second'] } = {}) {
  if (!Array.isArray(registers) || registers.length < order.length) fail('INVALID_DATETIME', 'Not enough registers for date/time layout', { registers: registers?.length, fields: order.length });
  const fields = {};
  order.forEach((name, index) => { fields[name] = integerRange(registers[index], 0, 0xFFFF, `registers[${index}]`); });
  const year = fields.year;
  const month = fields.month;
  const day = fields.day;
  const hour = fields.hour || 0;
  const minute = fields.minute || 0;
  const second = fields.second || 0;
  if (!Number.isInteger(year) || year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    fail('INVALID_DATETIME', 'Date/time registers contain an invalid calendar value', { fields });
  }
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail('INVALID_DATETIME', 'Date/time registers do not form a valid calendar date', { fields });
  return Object.freeze({ fields: Object.freeze(fields), date, iso: date.toISOString() });
}

module.exports = {
  asBuffer,
  normalizeOrder,
  permuteBytes,
  registersToBytes,
  bytesToRegisters,
  decodeUInt16,
  decodeInt16,
  decodeUInt32,
  decodeInt32,
  decodeUInt64,
  decodeInt64,
  decodeFloat32,
  decodeFloat64,
  encodeUInt16,
  encodeInt16,
  encodeUInt32,
  encodeInt32,
  encodeUInt64,
  encodeInt64,
  encodeFloat32,
  encodeFloat64,
  encodeAscii,
  decodeAscii,
  encodeBcd,
  decodeBcd,
  decodeUnixTimestamp,
  decodeDateTimeRegisters,
};
