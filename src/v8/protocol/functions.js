'use strict';

const { fail } = require('./errors');
const { validatePdu } = require('./model');

const FC = Object.freeze({
  READ_COILS: 0x01,
  READ_DISCRETE_INPUTS: 0x02,
  READ_HOLDING_REGISTERS: 0x03,
  READ_INPUT_REGISTERS: 0x04,
  WRITE_SINGLE_COIL: 0x05,
  WRITE_SINGLE_REGISTER: 0x06,
  WRITE_MULTIPLE_COILS: 0x0F,
  WRITE_MULTIPLE_REGISTERS: 0x10,
  MASK_WRITE_REGISTER: 0x16,
  READ_WRITE_MULTIPLE_REGISTERS: 0x17,
  ENCAPSULATED_INTERFACE: 0x2B,
});

const MEI_READ_DEVICE_ID = 0x0E;

function uint16(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    fail('UINT16_OUT_OF_RANGE', `${field} must be between 0 and 65535`, { field, value });
  }
  return value;
}

function quantity(value, min, max, field = 'quantity') {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail('QUANTITY_OUT_OF_RANGE', `${field} must be between ${min} and ${max}`, {
      field,
      value,
      min,
      max,
    });
  }
  return value;
}

function exactLength(pdu, expected, code = 'INVALID_PDU_LENGTH') {
  if (pdu.length !== expected) {
    fail(code, `PDU length must be exactly ${expected} bytes`, {
      expected,
      actual: pdu.length,
      functionCode: pdu[0],
    });
  }
}

function packBits(values) {
  if (!Array.isArray(values)) fail('INVALID_VALUES', 'Bit values must be supplied as an array');
  const out = Buffer.alloc(Math.ceil(values.length / 8));
  values.forEach((value, index) => {
    if (value !== true && value !== false && value !== 0 && value !== 1) {
      fail('INVALID_BIT_VALUE', 'Bit values must be boolean, 0 or 1', { index, value });
    }
    if (Boolean(value)) out[index >> 3] |= 1 << (index & 7);
  });
  return out;
}

function unpackBits(bytes, bitCount = bytes.length * 8) {
  quantity(bitCount, 0, bytes.length * 8, 'bitCount');
  const values = [];
  for (let i = 0; i < bitCount; i++) values.push(Boolean(bytes[i >> 3] & (1 << (i & 7))));
  return values;
}

function normalizeRegisters(values, max, field = 'values') {
  if (!Array.isArray(values)) fail('INVALID_VALUES', `${field} must be an array`);
  quantity(values.length, 1, max, `${field}.length`);
  return values.map((value, index) => uint16(value, `${field}[${index}]`));
}

function encodeReadRequest({ functionCode, address, quantity: requestedQuantity }) {
  if (![FC.READ_COILS, FC.READ_DISCRETE_INPUTS, FC.READ_HOLDING_REGISTERS, FC.READ_INPUT_REGISTERS].includes(functionCode)) {
    fail('INVALID_FUNCTION_CODE', 'encodeReadRequest supports FC01, FC02, FC03 and FC04', { functionCode });
  }
  uint16(address, 'address');
  const max = functionCode <= FC.READ_DISCRETE_INPUTS ? 2000 : 125;
  quantity(requestedQuantity, 1, max);
  const pdu = Buffer.alloc(5);
  pdu[0] = functionCode;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(requestedQuantity, 3);
  return pdu;
}

function decodeReadRequest(pdu) {
  const raw = validatePdu(pdu);
  if (![1, 2, 3, 4].includes(raw[0])) fail('INVALID_FUNCTION_CODE', 'Not a standard read request', { functionCode: raw[0] });
  exactLength(raw, 5);
  const address = raw.readUInt16BE(1);
  const requestedQuantity = raw.readUInt16BE(3);
  const max = raw[0] <= 2 ? 2000 : 125;
  quantity(requestedQuantity, 1, max);
  return { functionCode: raw[0], address, quantity: requestedQuantity };
}

function encodeReadBitsResponse({ functionCode, values }) {
  if (![FC.READ_COILS, FC.READ_DISCRETE_INPUTS].includes(functionCode)) {
    fail('INVALID_FUNCTION_CODE', 'Bit response must use FC01 or FC02', { functionCode });
  }
  quantity(values?.length, 1, 2000, 'values.length');
  const data = packBits(values);
  return Buffer.concat([Buffer.from([functionCode, data.length]), data]);
}

function decodeReadBitsResponse(pdu, { expectedQuantity = null } = {}) {
  const raw = validatePdu(pdu);
  if (![FC.READ_COILS, FC.READ_DISCRETE_INPUTS].includes(raw[0])) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC01/FC02 response', { functionCode: raw[0] });
  }
  if (raw.length < 3) fail('INVALID_PDU_LENGTH', 'Read-bits response is too short');
  const byteCount = raw[1];
  if (raw.length !== 2 + byteCount) {
    fail('BYTE_COUNT_MISMATCH', 'Read-bits response byte count does not match payload', {
      byteCount,
      payloadBytes: raw.length - 2,
    });
  }
  let bitCount = byteCount * 8;
  if (expectedQuantity != null) {
    quantity(expectedQuantity, 1, 2000, 'expectedQuantity');
    const expectedBytes = Math.ceil(expectedQuantity / 8);
    if (byteCount !== expectedBytes) {
      fail('BYTE_COUNT_MISMATCH', 'Read-bits response byte count does not match requested quantity', {
        byteCount,
        expectedBytes,
        expectedQuantity,
      });
    }
    bitCount = expectedQuantity;
  }
  return { functionCode: raw[0], byteCount, values: unpackBits(raw.subarray(2), bitCount) };
}

function encodeReadRegistersResponse({ functionCode, values }) {
  if (![FC.READ_HOLDING_REGISTERS, FC.READ_INPUT_REGISTERS, FC.READ_WRITE_MULTIPLE_REGISTERS].includes(functionCode)) {
    fail('INVALID_FUNCTION_CODE', 'Register response must use FC03, FC04 or FC23', { functionCode });
  }
  const regs = normalizeRegisters(values, 125);
  const data = Buffer.alloc(regs.length * 2);
  regs.forEach((value, index) => data.writeUInt16BE(value, index * 2));
  return Buffer.concat([Buffer.from([functionCode, data.length]), data]);
}

function decodeReadRegistersResponse(pdu, { expectedQuantity = null } = {}) {
  const raw = validatePdu(pdu);
  if (![FC.READ_HOLDING_REGISTERS, FC.READ_INPUT_REGISTERS, FC.READ_WRITE_MULTIPLE_REGISTERS].includes(raw[0])) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC03/FC04/FC23 register response', { functionCode: raw[0] });
  }
  if (raw.length < 4) fail('INVALID_PDU_LENGTH', 'Register response is too short');
  const byteCount = raw[1];
  if (byteCount === 0 || (byteCount & 1) !== 0 || raw.length !== 2 + byteCount) {
    fail('BYTE_COUNT_MISMATCH', 'Register response must contain an even byte count matching its payload', {
      byteCount,
      payloadBytes: raw.length - 2,
    });
  }
  const registerCount = byteCount / 2;
  quantity(registerCount, 1, 125, 'registerCount');
  if (expectedQuantity != null && registerCount !== expectedQuantity) {
    fail('QUANTITY_MISMATCH', 'Register response count does not match requested quantity', {
      expectedQuantity,
      registerCount,
    });
  }
  const values = [];
  for (let offset = 2; offset < raw.length; offset += 2) values.push(raw.readUInt16BE(offset));
  return { functionCode: raw[0], byteCount, values };
}

function encodeWriteSingleCoilRequest({ address, value }) {
  uint16(address, 'address');
  const rawValue = value === true || value === 1 || value === 0xFF00 ? 0xFF00
    : value === false || value === 0 || value === 0x0000 ? 0x0000
      : null;
  if (rawValue == null) fail('INVALID_COIL_VALUE', 'FC05 coil value must be false/0/0x0000 or true/1/0xFF00', { value });
  const pdu = Buffer.alloc(5);
  pdu[0] = FC.WRITE_SINGLE_COIL;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(rawValue, 3);
  return pdu;
}

function encodeWriteSingleRegisterRequest({ address, value }) {
  uint16(address, 'address');
  uint16(value, 'value');
  const pdu = Buffer.alloc(5);
  pdu[0] = FC.WRITE_SINGLE_REGISTER;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value, 3);
  return pdu;
}

function decodeWriteSingleRequest(pdu) {
  const raw = validatePdu(pdu);
  if (![FC.WRITE_SINGLE_COIL, FC.WRITE_SINGLE_REGISTER].includes(raw[0])) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC05/FC06 request', { functionCode: raw[0] });
  }
  exactLength(raw, 5);
  const address = raw.readUInt16BE(1);
  const rawValue = raw.readUInt16BE(3);
  if (raw[0] === FC.WRITE_SINGLE_COIL && rawValue !== 0x0000 && rawValue !== 0xFF00) {
    fail('INVALID_COIL_VALUE', 'FC05 request contains an invalid encoded coil value', { rawValue });
  }
  return {
    functionCode: raw[0],
    address,
    value: raw[0] === FC.WRITE_SINGLE_COIL ? rawValue === 0xFF00 : rawValue,
    rawValue,
  };
}

function encodeWriteMultipleCoilsRequest({ address, values }) {
  uint16(address, 'address');
  quantity(values?.length, 1, 1968, 'values.length');
  const data = packBits(values);
  const pdu = Buffer.alloc(6 + data.length);
  pdu[0] = FC.WRITE_MULTIPLE_COILS;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(values.length, 3);
  pdu[5] = data.length;
  data.copy(pdu, 6);
  return pdu;
}

function encodeWriteMultipleRegistersRequest({ address, values }) {
  uint16(address, 'address');
  const regs = normalizeRegisters(values, 123);
  const pdu = Buffer.alloc(6 + regs.length * 2);
  pdu[0] = FC.WRITE_MULTIPLE_REGISTERS;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(regs.length, 3);
  pdu[5] = regs.length * 2;
  regs.forEach((value, index) => pdu.writeUInt16BE(value, 6 + index * 2));
  return pdu;
}

function decodeWriteMultipleRequest(pdu) {
  const raw = validatePdu(pdu);
  if (![FC.WRITE_MULTIPLE_COILS, FC.WRITE_MULTIPLE_REGISTERS].includes(raw[0])) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC15/FC16 request', { functionCode: raw[0] });
  }
  if (raw.length < 7) fail('INVALID_PDU_LENGTH', 'Write-multiple request is too short');
  const address = raw.readUInt16BE(1);
  const requestedQuantity = raw.readUInt16BE(3);
  const byteCount = raw[5];
  if (raw.length !== 6 + byteCount) {
    fail('BYTE_COUNT_MISMATCH', 'Write-multiple byte count does not match payload', { byteCount, payloadBytes: raw.length - 6 });
  }
  if (raw[0] === FC.WRITE_MULTIPLE_COILS) {
    quantity(requestedQuantity, 1, 1968);
    const expectedBytes = Math.ceil(requestedQuantity / 8);
    if (byteCount !== expectedBytes) fail('BYTE_COUNT_MISMATCH', 'FC15 byte count does not match coil quantity', { byteCount, expectedBytes });
    return { functionCode: raw[0], address, quantity: requestedQuantity, values: unpackBits(raw.subarray(6), requestedQuantity) };
  }
  quantity(requestedQuantity, 1, 123);
  if (byteCount !== requestedQuantity * 2) fail('BYTE_COUNT_MISMATCH', 'FC16 byte count does not match register quantity', { byteCount, expectedBytes: requestedQuantity * 2 });
  const values = [];
  for (let offset = 6; offset < raw.length; offset += 2) values.push(raw.readUInt16BE(offset));
  return { functionCode: raw[0], address, quantity: requestedQuantity, values };
}

function encodeWriteMultipleResponse({ functionCode, address, quantity: writtenQuantity }) {
  if (![FC.WRITE_MULTIPLE_COILS, FC.WRITE_MULTIPLE_REGISTERS].includes(functionCode)) {
    fail('INVALID_FUNCTION_CODE', 'Write-multiple response must use FC15 or FC16', { functionCode });
  }
  uint16(address, 'address');
  quantity(writtenQuantity, 1, functionCode === FC.WRITE_MULTIPLE_COILS ? 1968 : 123);
  const pdu = Buffer.alloc(5);
  pdu[0] = functionCode;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(writtenQuantity, 3);
  return pdu;
}

function decodeWriteMultipleResponse(pdu) {
  const raw = validatePdu(pdu);
  if (![FC.WRITE_MULTIPLE_COILS, FC.WRITE_MULTIPLE_REGISTERS].includes(raw[0])) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC15/FC16 response', { functionCode: raw[0] });
  }
  exactLength(raw, 5);
  const address = raw.readUInt16BE(1);
  const writtenQuantity = raw.readUInt16BE(3);
  quantity(writtenQuantity, 1, raw[0] === FC.WRITE_MULTIPLE_COILS ? 1968 : 123);
  return { functionCode: raw[0], address, quantity: writtenQuantity };
}

function encodeMaskWriteRegisterRequest({ address, andMask, orMask }) {
  uint16(address, 'address');
  uint16(andMask, 'andMask');
  uint16(orMask, 'orMask');
  const pdu = Buffer.alloc(7);
  pdu[0] = FC.MASK_WRITE_REGISTER;
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(andMask, 3);
  pdu.writeUInt16BE(orMask, 5);
  return pdu;
}

function decodeMaskWriteRegisterRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== FC.MASK_WRITE_REGISTER) fail('INVALID_FUNCTION_CODE', 'Not an FC22 Mask Write Register request/response', { functionCode: raw[0] });
  exactLength(raw, 7);
  return {
    functionCode: raw[0],
    address: raw.readUInt16BE(1),
    andMask: raw.readUInt16BE(3),
    orMask: raw.readUInt16BE(5),
  };
}

function encodeReadWriteMultipleRegistersRequest({ readAddress, readQuantity, writeAddress, values }) {
  uint16(readAddress, 'readAddress');
  quantity(readQuantity, 1, 125, 'readQuantity');
  uint16(writeAddress, 'writeAddress');
  const regs = normalizeRegisters(values, 121, 'values');
  const pdu = Buffer.alloc(10 + regs.length * 2);
  pdu[0] = FC.READ_WRITE_MULTIPLE_REGISTERS;
  pdu.writeUInt16BE(readAddress, 1);
  pdu.writeUInt16BE(readQuantity, 3);
  pdu.writeUInt16BE(writeAddress, 5);
  pdu.writeUInt16BE(regs.length, 7);
  pdu[9] = regs.length * 2;
  regs.forEach((value, index) => pdu.writeUInt16BE(value, 10 + index * 2));
  return pdu;
}

function decodeReadWriteMultipleRegistersRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== FC.READ_WRITE_MULTIPLE_REGISTERS) fail('INVALID_FUNCTION_CODE', 'Not an FC23 request', { functionCode: raw[0] });
  if (raw.length < 12) fail('INVALID_PDU_LENGTH', 'FC23 request is too short');
  const readAddress = raw.readUInt16BE(1);
  const readQuantity = raw.readUInt16BE(3);
  const writeAddress = raw.readUInt16BE(5);
  const writeQuantity = raw.readUInt16BE(7);
  const byteCount = raw[9];
  quantity(readQuantity, 1, 125, 'readQuantity');
  quantity(writeQuantity, 1, 121, 'writeQuantity');
  if (byteCount !== writeQuantity * 2 || raw.length !== 10 + byteCount) {
    fail('BYTE_COUNT_MISMATCH', 'FC23 write byte count does not match write quantity', {
      byteCount,
      expectedBytes: writeQuantity * 2,
      payloadBytes: raw.length - 10,
    });
  }
  const values = [];
  for (let offset = 10; offset < raw.length; offset += 2) values.push(raw.readUInt16BE(offset));
  return { functionCode: raw[0], readAddress, readQuantity, writeAddress, writeQuantity, values };
}

function encodeDeviceIdRequest({ readDeviceIdCode = 1, objectId = 0 } = {}) {
  if (!Number.isInteger(readDeviceIdCode) || readDeviceIdCode < 1 || readDeviceIdCode > 4) {
    fail('INVALID_DEVICE_ID_CODE', 'Read Device Identification code must be 1..4', { readDeviceIdCode });
  }
  if (!Number.isInteger(objectId) || objectId < 0 || objectId > 0xFF) {
    fail('BYTE_OUT_OF_RANGE', 'objectId must be 0..255', { objectId });
  }
  return Buffer.from([FC.ENCAPSULATED_INTERFACE, MEI_READ_DEVICE_ID, readDeviceIdCode, objectId]);
}

function decodeDeviceIdRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== FC.ENCAPSULATED_INTERFACE || raw[1] !== MEI_READ_DEVICE_ID) {
    fail('INVALID_FUNCTION_CODE', 'Not an FC43/MEI 0x0E Device Identification request');
  }
  exactLength(raw, 4);
  const readDeviceIdCode = raw[2];
  if (readDeviceIdCode < 1 || readDeviceIdCode > 4) fail('INVALID_DEVICE_ID_CODE', 'Read Device Identification code must be 1..4', { readDeviceIdCode });
  return { functionCode: raw[0], meiType: raw[1], readDeviceIdCode, objectId: raw[3] };
}

function encodeDeviceIdResponse({
  readDeviceIdCode = 1,
  conformityLevel = 1,
  moreFollows = false,
  nextObjectId = 0,
  objects = [],
}) {
  if (!Number.isInteger(readDeviceIdCode) || readDeviceIdCode < 1 || readDeviceIdCode > 4) fail('INVALID_DEVICE_ID_CODE', 'Read Device Identification code must be 1..4', { readDeviceIdCode });
  if (!Number.isInteger(conformityLevel) || conformityLevel < 0 || conformityLevel > 0xFF) fail('BYTE_OUT_OF_RANGE', 'conformityLevel must be 0..255', { conformityLevel });
  if (!Number.isInteger(nextObjectId) || nextObjectId < 0 || nextObjectId > 0xFF) fail('BYTE_OUT_OF_RANGE', 'nextObjectId must be 0..255', { nextObjectId });
  if (!Array.isArray(objects) || objects.length > 0xFF) fail('INVALID_DEVICE_ID_OBJECTS', 'objects must be an array with at most 255 entries');
  const parts = [Buffer.from([
    FC.ENCAPSULATED_INTERFACE,
    MEI_READ_DEVICE_ID,
    readDeviceIdCode,
    conformityLevel,
    moreFollows ? 0xFF : 0x00,
    nextObjectId,
    objects.length,
  ])];
  for (const [index, object] of objects.entries()) {
    if (!Number.isInteger(object.id) || object.id < 0 || object.id > 0xFF) fail('BYTE_OUT_OF_RANGE', 'Device ID object id must be 0..255', { index, id: object.id });
    const value = Buffer.isBuffer(object.value) ? Buffer.from(object.value) : Buffer.from(String(object.value ?? ''), 'utf8');
    if (value.length > 0xFF) fail('DEVICE_ID_OBJECT_TOO_LONG', 'Device ID object value cannot exceed 255 bytes', { index, length: value.length });
    parts.push(Buffer.from([object.id, value.length]), value);
  }
  return validatePdu(Buffer.concat(parts));
}

function decodeDeviceIdResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== FC.ENCAPSULATED_INTERFACE || raw[1] !== MEI_READ_DEVICE_ID) fail('INVALID_FUNCTION_CODE', 'Not an FC43/MEI 0x0E Device Identification response');
  if (raw.length < 7) fail('INVALID_PDU_LENGTH', 'Device Identification response is too short');
  const numberOfObjects = raw[6];
  let offset = 7;
  const objects = [];
  for (let i = 0; i < numberOfObjects; i++) {
    if (offset + 2 > raw.length) fail('TRUNCATED_DEVICE_ID_OBJECT', 'Device Identification object header is truncated', { objectIndex: i });
    const id = raw[offset++];
    const length = raw[offset++];
    if (offset + length > raw.length) fail('TRUNCATED_DEVICE_ID_OBJECT', 'Device Identification object value is truncated', { objectIndex: i, id, length });
    const value = Buffer.from(raw.subarray(offset, offset + length));
    offset += length;
    objects.push({ id, value, text: value.toString('utf8') });
  }
  if (offset !== raw.length) fail('DEVICE_ID_TRAILING_BYTES', 'Device Identification response contains bytes after the declared object list', { trailingBytes: raw.length - offset });
  return {
    functionCode: raw[0],
    meiType: raw[1],
    readDeviceIdCode: raw[2],
    conformityLevel: raw[3],
    moreFollows: raw[4] !== 0,
    nextObjectId: raw[5],
    objects,
  };
}

function decodeExceptionPdu(pdu) {
  const raw = validatePdu(pdu);
  if ((raw[0] & 0x80) === 0) fail('NOT_EXCEPTION_PDU', 'PDU is not an exception response', { functionCode: raw[0] });
  exactLength(raw, 2, 'INVALID_EXCEPTION_PDU');
  return { functionCode: raw[0], originalFunctionCode: raw[0] & 0x7F, exceptionCode: raw[1] };
}

function decodeRequestPdu(pdu) {
  const raw = validatePdu(pdu);
  switch (raw[0]) {
    case FC.READ_COILS:
    case FC.READ_DISCRETE_INPUTS:
    case FC.READ_HOLDING_REGISTERS:
    case FC.READ_INPUT_REGISTERS:
      return decodeReadRequest(raw);
    case FC.WRITE_SINGLE_COIL:
    case FC.WRITE_SINGLE_REGISTER:
      return decodeWriteSingleRequest(raw);
    case FC.WRITE_MULTIPLE_COILS:
    case FC.WRITE_MULTIPLE_REGISTERS:
      return decodeWriteMultipleRequest(raw);
    case FC.MASK_WRITE_REGISTER:
      return decodeMaskWriteRegisterRequest(raw);
    case FC.READ_WRITE_MULTIPLE_REGISTERS:
      return decodeReadWriteMultipleRegistersRequest(raw);
    case FC.ENCAPSULATED_INTERFACE:
      return decodeDeviceIdRequest(raw);
    default:
      return { functionCode: raw[0], vendorOrUnsupported: true, data: Buffer.from(raw.subarray(1)), pdu: Buffer.from(raw) };
  }
}

module.exports = {
  FC,
  MEI_READ_DEVICE_ID,
  packBits,
  unpackBits,
  encodeReadRequest,
  decodeReadRequest,
  encodeReadBitsResponse,
  decodeReadBitsResponse,
  encodeReadRegistersResponse,
  decodeReadRegistersResponse,
  encodeWriteSingleCoilRequest,
  encodeWriteSingleRegisterRequest,
  decodeWriteSingleRequest,
  encodeWriteMultipleCoilsRequest,
  encodeWriteMultipleRegistersRequest,
  decodeWriteMultipleRequest,
  encodeWriteMultipleResponse,
  decodeWriteMultipleResponse,
  encodeMaskWriteRegisterRequest,
  decodeMaskWriteRegisterRequest,
  encodeReadWriteMultipleRegistersRequest,
  decodeReadWriteMultipleRegistersRequest,
  encodeDeviceIdRequest,
  decodeDeviceIdRequest,
  encodeDeviceIdResponse,
  decodeDeviceIdResponse,
  decodeExceptionPdu,
  decodeRequestPdu,
};
