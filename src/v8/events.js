'use strict';

const { randomUUID } = require('node:crypto');

function normalizeRawHex(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.replace(/\s+/g, '').toUpperCase();
  if (Buffer.isBuffer(raw) || ArrayBuffer.isView(raw) || Array.isArray(raw)) {
    return Buffer.from(raw).toString('hex').toUpperCase();
  }
  throw new TypeError('raw must be a hex string, Buffer, typed array, byte array, or null');
}

function createWorkbenchEvent({
  eventId = randomUUID(),
  timestamp = Date.now(),
  type,
  source,
  connectionId = null,
  channelId = null,
  ownerMode = null,
  direction = null,
  unitId = null,
  functionCode = null,
  raw = null,
  details = {},
}) {
  if (!type || typeof type !== 'string') throw new TypeError('type is required');
  if (!source || typeof source !== 'string') throw new TypeError('source is required');
  if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be a finite number');
  if (unitId != null && (!Number.isInteger(unitId) || unitId < 0 || unitId > 255)) {
    throw new RangeError('unitId must be 0..255 when supplied');
  }
  if (functionCode != null && (!Number.isInteger(functionCode) || functionCode < 1 || functionCode > 255)) {
    throw new RangeError('functionCode must be 1..255 when supplied');
  }
  if (details == null || typeof details !== 'object' || Array.isArray(details)) {
    throw new TypeError('details must be an object');
  }

  return Object.freeze({
    schemaVersion: 1,
    eventId,
    timestamp,
    type,
    source,
    connectionId,
    channelId,
    ownerMode,
    direction,
    unitId,
    functionCode,
    rawHex: normalizeRawHex(raw),
    details: Object.freeze({ ...details }),
  });
}

module.exports = {
  normalizeRawHex,
  createWorkbenchEvent,
};
