'use strict';

const { fail } = require('./errors');

const MAX_PDU_LENGTH = 253;

function toBuffer(value, field = 'data') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value == null) return Buffer.alloc(0);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Buffer.from(value);
  fail('INVALID_BUFFER', `${field} must be a Buffer, byte array, typed array, or null`, { field });
}

function validateByte(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
    fail('BYTE_OUT_OF_RANGE', `${field} must be an integer between 0 and 255`, { field, value });
  }
  return value;
}

function validateUnitId(unitId) {
  return validateByte(unitId, 'unitId');
}

function validateFunctionCode(functionCode) {
  validateByte(functionCode, 'functionCode');
  if (functionCode === 0) {
    fail('INVALID_FUNCTION_CODE', 'functionCode 0 is not a valid Modbus function', { functionCode });
  }
  return functionCode;
}

function validatePdu(pdu) {
  const normalized = toBuffer(pdu, 'pdu');
  if (normalized.length < 1) {
    fail('PDU_TOO_SHORT', 'A Modbus PDU must contain at least the function code');
  }
  if (normalized.length > MAX_PDU_LENGTH) {
    fail('PDU_TOO_LONG', `A Modbus PDU cannot exceed ${MAX_PDU_LENGTH} bytes`, {
      length: normalized.length,
      max: MAX_PDU_LENGTH,
    });
  }
  validateFunctionCode(normalized[0]);
  return normalized;
}

function createMessage({ unitId, functionCode, data = Buffer.alloc(0) }) {
  validateUnitId(unitId);
  validateFunctionCode(functionCode);
  const payload = toBuffer(data, 'data');
  const pdu = Buffer.concat([Buffer.from([functionCode]), payload]);
  validatePdu(pdu);

  const isException = (functionCode & 0x80) !== 0;
  if (isException) {
    if (payload.length !== 1) {
      fail('INVALID_EXCEPTION_PDU', 'A Modbus exception response must contain exactly one exception code byte', {
        functionCode,
        length: payload.length,
      });
    }
    const originalFunctionCode = functionCode & 0x7F;
    if (originalFunctionCode === 0) {
      fail('INVALID_EXCEPTION_PDU', 'Exception function code does not identify a valid original function', {
        functionCode,
      });
    }
    return Object.freeze({
      kind: 'exception',
      unitId,
      functionCode,
      originalFunctionCode,
      exceptionCode: payload[0],
      data: Buffer.from(payload),
      pdu: Buffer.from(pdu),
    });
  }

  return Object.freeze({
    kind: 'message',
    unitId,
    functionCode,
    data: Buffer.from(payload),
    pdu: Buffer.from(pdu),
  });
}

function parsePdu({ unitId, pdu }) {
  validateUnitId(unitId);
  const normalized = validatePdu(pdu);
  return createMessage({
    unitId,
    functionCode: normalized[0],
    data: normalized.subarray(1),
  });
}

function createException({ unitId, functionCode, exceptionCode }) {
  validateUnitId(unitId);
  validateFunctionCode(functionCode);
  if (functionCode & 0x80) {
    fail('INVALID_FUNCTION_CODE', 'createException expects the original function code without the exception bit', {
      functionCode,
    });
  }
  validateByte(exceptionCode, 'exceptionCode');
  if (exceptionCode === 0) {
    fail('INVALID_EXCEPTION_CODE', 'exceptionCode 0 is not valid', { exceptionCode });
  }
  return createMessage({
    unitId,
    functionCode: functionCode | 0x80,
    data: Buffer.from([exceptionCode]),
  });
}

module.exports = {
  MAX_PDU_LENGTH,
  toBuffer,
  validateByte,
  validateUnitId,
  validateFunctionCode,
  validatePdu,
  createMessage,
  parsePdu,
  createException,
};
