'use strict';

const { appendCrc, hasValidCrc } = require('../../modbus/crc16');
const { appendLrc, hasValidLrc } = require('./lrc');
const { fail } = require('./errors');
const {
  MAX_PDU_LENGTH,
  toBuffer,
  validatePdu,
  validateUnitId,
} = require('./model');

const MAX_RTU_ADU_LENGTH = 256;
const MAX_TCP_ADU_LENGTH = 260;

function validateUInt16(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    fail('UINT16_OUT_OF_RANGE', `${field} must be an integer between 0 and 65535`, { field, value });
  }
  return value;
}

function encodeRtuAdu(unitId, pdu) {
  validateUnitId(unitId);
  const normalizedPdu = validatePdu(pdu);
  return appendCrc(Buffer.concat([Buffer.from([unitId]), normalizedPdu]));
}

function decodeRtuAdu(frame) {
  const raw = toBuffer(frame, 'frame');
  if (raw.length < 4) {
    fail('RTU_ADU_TOO_SHORT', 'RTU ADU must be at least 4 bytes', { length: raw.length });
  }
  if (raw.length > MAX_RTU_ADU_LENGTH) {
    fail('RTU_ADU_TOO_LONG', `RTU ADU cannot exceed ${MAX_RTU_ADU_LENGTH} bytes`, {
      length: raw.length,
      max: MAX_RTU_ADU_LENGTH,
    });
  }
  if (!hasValidCrc(raw)) {
    fail('CRC_MISMATCH', 'RTU ADU CRC validation failed');
  }
  const unitId = raw[0];
  const pdu = validatePdu(raw.subarray(1, -2));
  return {
    transport: 'RTU',
    unitId,
    pdu: Buffer.from(pdu),
    raw: Buffer.from(raw),
  };
}

function encodeAsciiAdu(unitId, pdu) {
  validateUnitId(unitId);
  const normalizedPdu = validatePdu(pdu);
  const binary = appendLrc(Buffer.concat([Buffer.from([unitId]), normalizedPdu]));
  return Buffer.from(`:${binary.toString('hex').toUpperCase()}\r\n`, 'ascii');
}

function decodeAsciiAdu(frame) {
  const ascii = Buffer.isBuffer(frame) ? frame.toString('ascii') : String(frame ?? '');
  if (!ascii.startsWith(':')) {
    fail('ASCII_MISSING_START', 'Modbus ASCII frame must start with a colon');
  }
  if (!ascii.endsWith('\r\n')) {
    fail('ASCII_MISSING_TERMINATOR', 'Modbus ASCII frame must end with CRLF');
  }

  const hex = ascii.slice(1, -2);
  if (hex.length < 6) {
    fail('ASCII_ADU_TOO_SHORT', 'Modbus ASCII frame does not contain Unit, PDU and LRC', { hexLength: hex.length });
  }
  if ((hex.length & 1) !== 0 || !/^[0-9A-Fa-f]+$/.test(hex)) {
    fail('ASCII_INVALID_HEX', 'Modbus ASCII payload must contain complete hexadecimal byte pairs');
  }

  const binary = Buffer.from(hex, 'hex');
  if (binary.length > MAX_PDU_LENGTH + 2) {
    fail('ASCII_ADU_TOO_LONG', 'Modbus ASCII binary payload exceeds Unit + PDU + LRC limits', {
      length: binary.length,
      max: MAX_PDU_LENGTH + 2,
    });
  }
  if (!hasValidLrc(binary)) {
    fail('LRC_MISMATCH', 'Modbus ASCII LRC validation failed');
  }

  const unitId = binary[0];
  const pdu = validatePdu(binary.subarray(1, -1));
  return {
    transport: 'ASCII',
    unitId,
    pdu: Buffer.from(pdu),
    raw: Buffer.from(ascii, 'ascii'),
    binary: Buffer.from(binary),
  };
}

function encodeTcpAdu({ transactionId, protocolId = 0, unitId, pdu }) {
  validateUInt16(transactionId, 'transactionId');
  validateUInt16(protocolId, 'protocolId');
  validateUnitId(unitId);
  const normalizedPdu = validatePdu(pdu);
  const length = normalizedPdu.length + 1;

  const header = Buffer.alloc(7);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(protocolId, 2);
  header.writeUInt16BE(length, 4);
  header[6] = unitId;
  return Buffer.concat([header, normalizedPdu]);
}

function decodeTcpAdu(adu, { requireProtocolIdZero = true } = {}) {
  const raw = toBuffer(adu, 'adu');
  if (raw.length < 8) {
    fail('TCP_ADU_TOO_SHORT', 'Modbus TCP ADU must include a 7-byte MBAP header and function code', {
      length: raw.length,
    });
  }
  if (raw.length > MAX_TCP_ADU_LENGTH) {
    fail('TCP_ADU_TOO_LONG', `Modbus TCP ADU cannot exceed ${MAX_TCP_ADU_LENGTH} bytes`, {
      length: raw.length,
      max: MAX_TCP_ADU_LENGTH,
    });
  }

  const transactionId = raw.readUInt16BE(0);
  const protocolId = raw.readUInt16BE(2);
  const length = raw.readUInt16BE(4);
  const unitId = raw[6];

  if (requireProtocolIdZero && protocolId !== 0) {
    fail('INVALID_PROTOCOL_ID', 'Modbus TCP Protocol ID must be zero', { protocolId });
  }
  if (length < 2 || length > MAX_PDU_LENGTH + 1) {
    fail('INVALID_MBAP_LENGTH', 'MBAP length must include Unit ID plus a valid PDU', {
      length,
      min: 2,
      max: MAX_PDU_LENGTH + 1,
    });
  }
  const expectedLength = 6 + length;
  if (raw.length !== expectedLength) {
    fail('MBAP_LENGTH_MISMATCH', 'MBAP length does not match the supplied ADU bytes', {
      declaredLength: length,
      expectedAduLength: expectedLength,
      actualAduLength: raw.length,
    });
  }

  const pdu = validatePdu(raw.subarray(7));
  return {
    transport: 'TCP',
    transactionId,
    protocolId,
    unitId,
    pdu: Buffer.from(pdu),
    raw: Buffer.from(raw),
  };
}

module.exports = {
  MAX_RTU_ADU_LENGTH,
  MAX_TCP_ADU_LENGTH,
  validateUInt16,
  encodeRtuAdu,
  decodeRtuAdu,
  encodeAsciiAdu,
  decodeAsciiAdu,
  encodeTcpAdu,
  decodeTcpAdu,
};
