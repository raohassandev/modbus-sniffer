'use strict';

const { fail } = require('./errors');

function toBuffer(value, field = 'bytes') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Buffer.from(value);
  fail('INVALID_BUFFER', `${field} must be a Buffer, byte array or typed array`, { field });
}

function canonicalLetters(length) {
  if (!Number.isInteger(length) || length < 1 || length > 26) fail('INVALID_LENGTH', 'Permutation length must be 1..26', { length });
  return Array.from({ length }, (_, index) => String.fromCharCode(65 + index)).join('');
}

function normalizeByteOrder(order, length) {
  const canonical = canonicalLetters(length);
  if (order == null || order === 'native' || order === canonical) return canonical;
  const normalized = String(order).toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized.length !== length) fail('INVALID_BYTE_ORDER', `Byte order must contain exactly ${length} positions`, { order, length });
  const expected = [...canonical].sort().join('');
  const actual = [...normalized].sort().join('');
  if (actual !== expected) fail('INVALID_BYTE_ORDER', 'Byte order must contain every byte position exactly once', { order, expected: canonical });
  return normalized;
}

function permuteBytes(bytes, order) {
  const raw = toBuffer(bytes);
  const normalized = normalizeByteOrder(order, raw.length);
  const canonical = canonicalLetters(raw.length);
  const out = Buffer.alloc(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    const sourceIndex = normalized.indexOf(canonical[index]);
    out[index] = raw[sourceIndex];
  }
  return out;
}

function applyByteOrder(bytes, order) {
  const raw = toBuffer(bytes);
  const normalized = normalizeByteOrder(order, raw.length);
  const canonical = canonicalLetters(raw.length);
  const out = Buffer.alloc(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    const destinationIndex = normalized.indexOf(canonical[index]);
    out[destinationIndex] = raw[index];
  }
  return out;
}

function assertBits(bits) {
  if (![8, 16, 32, 64].includes(bits)) fail('INVALID_INTEGER_WIDTH', 'Integer width must be 8, 16, 32 or 64 bits', { bits });
}

function decodeIntegerExact(bytes, { bits = null, signed = false, order = null } = {}) {
  const raw = toBuffer(bytes);
  const resolvedBits = bits ?? raw.length * 8;
  assertBits(resolvedBits);
  const width = resolvedBits / 8;
  if (raw.length !== width) fail('INVALID_LENGTH', `Expected ${width} bytes for ${resolvedBits}-bit integer`, { actual: raw.length, expected: width });
  const normalized = permuteBytes(raw, order);
  let value = 0n;
  for (const octet of normalized) value = (value << 8n) | BigInt(octet);
  if (signed) {
    const signBit = 1n << BigInt(resolvedBits - 1);
    if (value & signBit) value -= 1n << BigInt(resolvedBits);
  }
  return value;
}

function decodeInteger(bytes, options = {}) {
  const exact = decodeIntegerExact(bytes, options);
  const numeric = Number(exact);
  return Number.isSafeInteger(numeric) ? numeric : exact;
}

function encodeIntegerExact(value, { bits = 16, signed = false, order = null } = {}) {
  assertBits(bits);
  const width = bits / 8;
  let exact;
  try { exact = BigInt(value); } catch { fail('INVALID_INTEGER', 'value must be an exact integer', { value }); }
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  if (exact < min || exact > max) fail('INTEGER_OUT_OF_RANGE', `value is outside ${signed ? 'signed' : 'unsigned'} ${bits}-bit range`, { value: String(value), bits, signed });
  let encoded = exact;
  if (signed && encoded < 0n) encoded += 1n << BigInt(bits);
  const canonical = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index -= 1) {
    canonical[index] = Number(encoded & 0xFFn);
    encoded >>= 8n;
  }
  return applyByteOrder(canonical, order);
}

function decodeFloat(bytes, { bits = null, order = null } = {}) {
  const raw = toBuffer(bytes);
  const resolvedBits = bits ?? raw.length * 8;
  if (![32, 64].includes(resolvedBits)) fail('INVALID_FLOAT_WIDTH', 'Float width must be 32 or 64 bits', { bits: resolvedBits });
  const width = resolvedBits / 8;
  if (raw.length !== width) fail('INVALID_LENGTH', `Expected ${width} bytes for float${resolvedBits}`, { actual: raw.length, expected: width });
  const normalized = permuteBytes(raw, order);
  return resolvedBits === 32 ? normalized.readFloatBE(0) : normalized.readDoubleBE(0);
}

function encodeFloat(value, { bits = 32, order = null } = {}) {
  if (![32, 64].includes(bits)) fail('INVALID_FLOAT_WIDTH', 'Float width must be 32 or 64 bits', { bits });
  if (!Number.isFinite(value)) fail('INVALID_FLOAT', 'value must be finite', { value });
  const canonical = Buffer.alloc(bits / 8);
  if (bits === 32) canonical.writeFloatBE(value, 0);
  else canonical.writeDoubleBE(value, 0);
  return applyByteOrder(canonical, order);
}

function decodeAscii(bytes, { trimNull = true, trimSpace = false } = {}) {
  let text = toBuffer(bytes).toString('ascii');
  if (trimNull) text = text.replace(/\x00+$/g, '');
  if (trimSpace) text = text.replace(/\s+$/g, '');
  return text;
}

function encodeAscii(text, { length = null, padByte = 0x00, truncate = false } = {}) {
  if (typeof text !== 'string') fail('INVALID_TEXT', 'text must be a string');
  if (!Number.isInteger(padByte) || padByte < 0 || padByte > 0xFF) fail('BYTE_OUT_OF_RANGE', 'padByte must be 0..255', { padByte });
  const raw = Buffer.from(text, 'ascii');
  if (length == null) return raw;
  if (!Number.isInteger(length) || length < 0) fail('INVALID_LENGTH', 'length must be a non-negative integer', { length });
  if (raw.length > length && !truncate) fail('TEXT_TOO_LONG', 'ASCII text exceeds requested fixed length', { length, actual: raw.length });
  const out = Buffer.alloc(length, padByte);
  raw.copy(out, 0, 0, Math.min(raw.length, length));
  return out;
}

function decodeBcd(bytes, { digits = null } = {}) {
  const raw = toBuffer(bytes);
  let text = '';
  raw.forEach((octet, index) => {
    const high = (octet >> 4) & 0x0F;
    const low = octet & 0x0F;
    if (high > 9 || low > 9) fail('INVALID_BCD', 'BCD nibble must be 0..9', { index, octet });
    text += `${high}${low}`;
  });
  if (digits != null) {
    if (!Number.isInteger(digits) || digits < 1 || digits > raw.length * 2) fail('INVALID_LENGTH', 'digits must fit supplied BCD bytes', { digits, max: raw.length * 2 });
    text = text.slice(text.length - digits);
  }
  return text;
}

function encodeBcd(value, { digits = null } = {}) {
  let text = String(value);
  if (!/^\d+$/.test(text)) fail('INVALID_BCD', 'BCD value must contain decimal digits only', { value });
  const resolvedDigits = digits ?? text.length;
  if (!Number.isInteger(resolvedDigits) || resolvedDigits < 1) fail('INVALID_LENGTH', 'digits must be a positive integer', { digits });
  if (text.length > resolvedDigits) fail('BCD_TOO_LONG', 'BCD value exceeds configured digit width', { value, digits: resolvedDigits });
  text = text.padStart(resolvedDigits, '0');
  if (text.length % 2) text = `0${text}`;
  const out = Buffer.alloc(text.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number(text[index * 2]) * 16 + Number(text[index * 2 + 1]);
  return out;
}

function decodeTimestamp(value, { unit = 'seconds', epochMs = 0 } = {}) {
  let numeric;
  if (typeof value === 'bigint') numeric = value;
  else if (Number.isSafeInteger(value)) numeric = BigInt(value);
  else fail('INVALID_TIMESTAMP', 'Timestamp must be an exact integer', { value });
  let milliseconds;
  if (unit === 'seconds') milliseconds = numeric * 1000n;
  else if (unit === 'milliseconds') milliseconds = numeric;
  else fail('INVALID_TIMESTAMP_UNIT', 'Timestamp unit must be seconds or milliseconds', { unit });
  milliseconds += BigInt(epochMs);
  const asNumber = Number(milliseconds);
  if (!Number.isSafeInteger(asNumber)) fail('TIMESTAMP_OUT_OF_RANGE', 'Timestamp cannot be represented safely by JavaScript Date', { milliseconds: milliseconds.toString() });
  const date = new Date(asNumber);
  if (Number.isNaN(date.getTime())) fail('TIMESTAMP_OUT_OF_RANGE', 'Timestamp is outside supported Date range', { milliseconds: asNumber });
  return date;
}

function decodeBcdDateTime(bytes, { order = 'YYMMDDhhmmss', century = 2000 } = {}) {
  const raw = toBuffer(bytes);
  const digits = decodeBcd(raw);
  const tokens = order.match(/YY|MM|DD|hh|mm|ss/g) || [];
  if (tokens.length * 2 !== digits.length) fail('INVALID_TIMESTAMP_LAYOUT', 'BCD datetime layout does not match byte count', { order, bytes: raw.length });
  const fields = {};
  tokens.forEach((token, index) => { fields[token] = Number(digits.slice(index * 2, index * 2 + 2)); });
  const year = century + (fields.YY ?? 0);
  const month = fields.MM ?? 1;
  const day = fields.DD ?? 1;
  const hour = fields.hh ?? 0;
  const minute = fields.mm ?? 0;
  const second = fields.ss ?? 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    fail('INVALID_TIMESTAMP', 'BCD datetime contains an invalid calendar value', { year, month, day, hour, minute, second });
  }
  return date;
}

module.exports = {
  normalizeByteOrder,
  permuteBytes,
  applyByteOrder,
  decodeIntegerExact,
  decodeInteger,
  encodeIntegerExact,
  decodeFloat,
  encodeFloat,
  decodeAscii,
  encodeAscii,
  decodeBcd,
  encodeBcd,
  decodeTimestamp,
  decodeBcdDateTime,
};
