'use strict';

const { fail } = require('./errors');
const { validatePdu } = require('./model');

const EXTENDED_FC = Object.freeze({
  READ_EXCEPTION_STATUS: 0x07,
  DIAGNOSTICS: 0x08,
  GET_COMM_EVENT_COUNTER: 0x0B,
  GET_COMM_EVENT_LOG: 0x0C,
  REPORT_SERVER_ID: 0x11,
  READ_FILE_RECORD: 0x14,
  WRITE_FILE_RECORD: 0x15,
  READ_FIFO_QUEUE: 0x18,
});

const DIAGNOSTIC_SUBFUNCTION = Object.freeze({
  RETURN_QUERY_DATA: 0x0000,
  RESTART_COMMUNICATIONS_OPTION: 0x0001,
  RETURN_DIAGNOSTIC_REGISTER: 0x0002,
  CHANGE_ASCII_INPUT_DELIMITER: 0x0003,
  FORCE_LISTEN_ONLY_MODE: 0x0004,
  CLEAR_COUNTERS_AND_DIAGNOSTIC_REGISTER: 0x000A,
  RETURN_BUS_MESSAGE_COUNT: 0x000B,
  RETURN_BUS_COMM_ERROR_COUNT: 0x000C,
  RETURN_BUS_EXCEPTION_ERROR_COUNT: 0x000D,
  RETURN_SERVER_MESSAGE_COUNT: 0x000E,
  RETURN_SERVER_NO_RESPONSE_COUNT: 0x000F,
  RETURN_SERVER_NAK_COUNT: 0x0010,
  RETURN_SERVER_BUSY_COUNT: 0x0011,
  RETURN_BUS_CHARACTER_OVERRUN_COUNT: 0x0012,
  CLEAR_OVERRUN_COUNTER_AND_FLAG: 0x0014,
});

function uint16(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) fail('UINT16_OUT_OF_RANGE', `${field} must be 0..65535`, { field, value });
  return value;
}

function exact(raw, length) {
  if (raw.length !== length) fail('INVALID_PDU_LENGTH', `PDU length must be exactly ${length} bytes`, { functionCode: raw[0], expected: length, actual: raw.length });
}

function bytes(value, field = 'data') {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Buffer.from(value);
  fail('INVALID_BUFFER', `${field} must be a Buffer or byte array`, { field });
}

function encodeReadExceptionStatusRequest() {
  return Buffer.from([EXTENDED_FC.READ_EXCEPTION_STATUS]);
}

function decodeReadExceptionStatusRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_EXCEPTION_STATUS) fail('INVALID_FUNCTION_CODE', 'Not an FC07 request', { functionCode: raw[0] });
  exact(raw, 1);
  return { functionCode: raw[0] };
}

function encodeReadExceptionStatusResponse(status) {
  if (!Number.isInteger(status) || status < 0 || status > 0xFF) fail('BYTE_OUT_OF_RANGE', 'exception status must be 0..255', { status });
  return Buffer.from([EXTENDED_FC.READ_EXCEPTION_STATUS, status]);
}

function decodeReadExceptionStatusResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_EXCEPTION_STATUS) fail('INVALID_FUNCTION_CODE', 'Not an FC07 response', { functionCode: raw[0] });
  exact(raw, 2);
  return { functionCode: raw[0], status: raw[1] };
}

function encodeDiagnostics({ subFunction, data = 0 }) {
  uint16(subFunction, 'subFunction');
  const dataValue = Buffer.isBuffer(data) || Array.isArray(data) || ArrayBuffer.isView(data)
    ? bytes(data, 'data')
    : (() => {
        uint16(data, 'data');
        const out = Buffer.alloc(2);
        out.writeUInt16BE(data, 0);
        return out;
      })();
  if (dataValue.length !== 2) fail('INVALID_DIAGNOSTIC_DATA', 'Standard FC08 diagnostic data must contain exactly 2 bytes', { length: dataValue.length });
  const pdu = Buffer.alloc(5);
  pdu[0] = EXTENDED_FC.DIAGNOSTICS;
  pdu.writeUInt16BE(subFunction, 1);
  dataValue.copy(pdu, 3);
  return pdu;
}

function decodeDiagnostics(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.DIAGNOSTICS) fail('INVALID_FUNCTION_CODE', 'Not an FC08 diagnostic PDU', { functionCode: raw[0] });
  exact(raw, 5);
  return {
    functionCode: raw[0],
    subFunction: raw.readUInt16BE(1),
    data: Buffer.from(raw.subarray(3, 5)),
    dataUInt16: raw.readUInt16BE(3),
  };
}

function encodeGetCommEventCounterRequest() {
  return Buffer.from([EXTENDED_FC.GET_COMM_EVENT_COUNTER]);
}

function decodeGetCommEventCounterRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.GET_COMM_EVENT_COUNTER) fail('INVALID_FUNCTION_CODE', 'Not an FC11 request', { functionCode: raw[0] });
  exact(raw, 1);
  return { functionCode: raw[0] };
}

function encodeGetCommEventCounterResponse({ status, eventCount }) {
  uint16(status, 'status');
  uint16(eventCount, 'eventCount');
  const pdu = Buffer.alloc(5);
  pdu[0] = EXTENDED_FC.GET_COMM_EVENT_COUNTER;
  pdu.writeUInt16BE(status, 1);
  pdu.writeUInt16BE(eventCount, 3);
  return pdu;
}

function decodeGetCommEventCounterResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.GET_COMM_EVENT_COUNTER) fail('INVALID_FUNCTION_CODE', 'Not an FC11 response', { functionCode: raw[0] });
  exact(raw, 5);
  return { functionCode: raw[0], status: raw.readUInt16BE(1), eventCount: raw.readUInt16BE(3) };
}

function encodeGetCommEventLogRequest() {
  return Buffer.from([EXTENDED_FC.GET_COMM_EVENT_LOG]);
}

function decodeGetCommEventLogRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.GET_COMM_EVENT_LOG) fail('INVALID_FUNCTION_CODE', 'Not an FC12 request', { functionCode: raw[0] });
  exact(raw, 1);
  return { functionCode: raw[0] };
}

function encodeGetCommEventLogResponse({ status, eventCount, messageCount, events = [] }) {
  uint16(status, 'status');
  uint16(eventCount, 'eventCount');
  uint16(messageCount, 'messageCount');
  const eventBytes = bytes(events, 'events');
  const byteCount = 6 + eventBytes.length;
  if (byteCount > 251) fail('BYTE_COUNT_OUT_OF_RANGE', 'FC12 event log payload exceeds maximum PDU size', { byteCount });
  const pdu = Buffer.alloc(2 + byteCount);
  pdu[0] = EXTENDED_FC.GET_COMM_EVENT_LOG;
  pdu[1] = byteCount;
  pdu.writeUInt16BE(status, 2);
  pdu.writeUInt16BE(eventCount, 4);
  pdu.writeUInt16BE(messageCount, 6);
  eventBytes.copy(pdu, 8);
  return pdu;
}

function decodeGetCommEventLogResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.GET_COMM_EVENT_LOG) fail('INVALID_FUNCTION_CODE', 'Not an FC12 response', { functionCode: raw[0] });
  if (raw.length < 8) fail('INVALID_PDU_LENGTH', 'FC12 response is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (byteCount < 6 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC12 byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  return {
    functionCode: raw[0],
    byteCount,
    status: raw.readUInt16BE(2),
    eventCount: raw.readUInt16BE(4),
    messageCount: raw.readUInt16BE(6),
    events: Buffer.from(raw.subarray(8)),
  };
}

function encodeReportServerIdRequest() {
  return Buffer.from([EXTENDED_FC.REPORT_SERVER_ID]);
}

function decodeReportServerIdRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.REPORT_SERVER_ID) fail('INVALID_FUNCTION_CODE', 'Not an FC17 request', { functionCode: raw[0] });
  exact(raw, 1);
  return { functionCode: raw[0] };
}

function encodeReportServerIdResponse({ serverId, runIndicator = 0xFF, additionalData = [] }) {
  const id = bytes(serverId, 'serverId');
  if (!id.length) fail('INVALID_SERVER_ID', 'FC17 serverId must contain at least one byte');
  if (!Number.isInteger(runIndicator) || runIndicator < 0 || runIndicator > 0xFF) fail('BYTE_OUT_OF_RANGE', 'runIndicator must be 0..255', { runIndicator });
  const extra = bytes(additionalData, 'additionalData');
  const byteCount = id.length + 1 + extra.length;
  if (byteCount > 251) fail('BYTE_COUNT_OUT_OF_RANGE', 'FC17 response exceeds maximum PDU size', { byteCount });
  return Buffer.concat([Buffer.from([EXTENDED_FC.REPORT_SERVER_ID, byteCount]), id, Buffer.from([runIndicator]), extra]);
}

function decodeReportServerIdResponse(pdu, { serverIdLength = 1 } = {}) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.REPORT_SERVER_ID) fail('INVALID_FUNCTION_CODE', 'Not an FC17 response', { functionCode: raw[0] });
  const byteCount = raw[1];
  if (byteCount < 2 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC17 byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  if (!Number.isInteger(serverIdLength) || serverIdLength < 1 || serverIdLength >= byteCount) fail('INVALID_SERVER_ID_LENGTH', 'serverIdLength must leave one byte for run indicator', { serverIdLength, byteCount });
  const runOffset = 2 + serverIdLength;
  return {
    functionCode: raw[0],
    byteCount,
    serverId: Buffer.from(raw.subarray(2, runOffset)),
    runIndicator: raw[runOffset],
    additionalData: Buffer.from(raw.subarray(runOffset + 1)),
  };
}

function normalizeFileReadRecord(record, index = 0) {
  if (!record || typeof record !== 'object') fail('INVALID_FILE_RECORD', 'File record must be an object', { index });
  const fileNumber = uint16(record.fileNumber, `records[${index}].fileNumber`);
  const recordNumber = uint16(record.recordNumber, `records[${index}].recordNumber`);
  const recordLength = uint16(record.recordLength, `records[${index}].recordLength`);
  if (recordLength < 1 || recordLength > 125) fail('QUANTITY_OUT_OF_RANGE', 'File record length must be 1..125 registers', { index, recordLength });
  return { referenceType: 0x06, fileNumber, recordNumber, recordLength };
}

function encodeReadFileRecordRequest({ records }) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'FC20 requires at least one sub-request');
  const normalized = records.map(normalizeFileReadRecord);
  const byteCount = normalized.length * 7;
  if (byteCount > 245) fail('BYTE_COUNT_OUT_OF_RANGE', 'FC20 request data must not exceed 245 bytes', { byteCount });
  const pdu = Buffer.alloc(2 + byteCount);
  pdu[0] = EXTENDED_FC.READ_FILE_RECORD;
  pdu[1] = byteCount;
  normalized.forEach((record, index) => {
    const offset = 2 + index * 7;
    pdu[offset] = 0x06;
    pdu.writeUInt16BE(record.fileNumber, offset + 1);
    pdu.writeUInt16BE(record.recordNumber, offset + 3);
    pdu.writeUInt16BE(record.recordLength, offset + 5);
  });
  return pdu;
}

function decodeReadFileRecordRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_FILE_RECORD) fail('INVALID_FUNCTION_CODE', 'Not an FC20 request', { functionCode: raw[0] });
  if (raw.length < 9) fail('INVALID_PDU_LENGTH', 'FC20 request is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (byteCount < 7 || byteCount > 245 || byteCount % 7 !== 0 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC20 request byte count is invalid', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  for (let offset = 2; offset < raw.length; offset += 7) {
    if (raw[offset] !== 0x06) fail('INVALID_REFERENCE_TYPE', 'FC20 reference type must be 0x06', { referenceType: raw[offset] });
    records.push(normalizeFileReadRecord({ fileNumber: raw.readUInt16BE(offset + 1), recordNumber: raw.readUInt16BE(offset + 3), recordLength: raw.readUInt16BE(offset + 5) }, records.length));
  }
  return { functionCode: raw[0], byteCount, records };
}

function encodeReadFileRecordResponse({ records }) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'FC20 response requires at least one sub-response');
  const chunks = records.map((record, index) => {
    const values = record?.values;
    if (!Array.isArray(values) || !values.length || values.length > 125) fail('INVALID_FILE_RECORD', 'FC20 response values must contain 1..125 registers', { index });
    values.forEach((value, valueIndex) => uint16(value, `records[${index}].values[${valueIndex}]`));
    const data = Buffer.alloc(values.length * 2);
    values.forEach((value, valueIndex) => data.writeUInt16BE(value, valueIndex * 2));
    return Buffer.concat([Buffer.from([1 + data.length, 0x06]), data]);
  });
  const byteCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (byteCount > 251) fail('BYTE_COUNT_OUT_OF_RANGE', 'FC20 response exceeds maximum PDU size', { byteCount });
  return Buffer.concat([Buffer.from([EXTENDED_FC.READ_FILE_RECORD, byteCount]), ...chunks]);
}

function decodeReadFileRecordResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_FILE_RECORD) fail('INVALID_FUNCTION_CODE', 'Not an FC20 response', { functionCode: raw[0] });
  const byteCount = raw[1];
  if (byteCount < 4 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC20 response byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  let offset = 2;
  while (offset < raw.length) {
    const responseLength = raw[offset];
    if (responseLength < 3 || (responseLength - 1) % 2 !== 0 || offset + 1 + responseLength > raw.length) fail('INVALID_FILE_RECORD', 'FC20 sub-response length is invalid', { responseLength, offset });
    if (raw[offset + 1] !== 0x06) fail('INVALID_REFERENCE_TYPE', 'FC20 reference type must be 0x06', { referenceType: raw[offset + 1] });
    const values = [];
    for (let cursor = offset + 2; cursor < offset + 1 + responseLength; cursor += 2) values.push(raw.readUInt16BE(cursor));
    records.push({ referenceType: 0x06, values });
    offset += 1 + responseLength;
  }
  return { functionCode: raw[0], byteCount, records };
}

function normalizeFileWriteRecord(record, index = 0) {
  if (!record || typeof record !== 'object' || !Array.isArray(record.values) || !record.values.length) fail('INVALID_FILE_RECORD', 'FC21 record requires values', { index });
  const fileNumber = uint16(record.fileNumber, `records[${index}].fileNumber`);
  const recordNumber = uint16(record.recordNumber, `records[${index}].recordNumber`);
  if (record.values.length > 122) fail('QUANTITY_OUT_OF_RANGE', 'FC21 record may contain at most 122 registers', { index, quantity: record.values.length });
  const values = record.values.map((value, valueIndex) => uint16(value, `records[${index}].values[${valueIndex}]`));
  return { referenceType: 0x06, fileNumber, recordNumber, recordLength: values.length, values };
}

function encodeWriteFileRecord({ records }) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'FC21 requires at least one sub-request');
  const normalized = records.map(normalizeFileWriteRecord);
  const byteCount = normalized.reduce((sum, record) => sum + 7 + record.values.length * 2, 0);
  if (byteCount > 251) fail('BYTE_COUNT_OUT_OF_RANGE', 'FC21 request exceeds maximum PDU size', { byteCount });
  const pdu = Buffer.alloc(2 + byteCount);
  pdu[0] = EXTENDED_FC.WRITE_FILE_RECORD;
  pdu[1] = byteCount;
  let offset = 2;
  for (const record of normalized) {
    pdu[offset] = 0x06;
    pdu.writeUInt16BE(record.fileNumber, offset + 1);
    pdu.writeUInt16BE(record.recordNumber, offset + 3);
    pdu.writeUInt16BE(record.recordLength, offset + 5);
    record.values.forEach((value, index) => pdu.writeUInt16BE(value, offset + 7 + index * 2));
    offset += 7 + record.values.length * 2;
  }
  return pdu;
}

function decodeWriteFileRecord(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.WRITE_FILE_RECORD) fail('INVALID_FUNCTION_CODE', 'Not an FC21 PDU', { functionCode: raw[0] });
  const byteCount = raw[1];
  if (byteCount < 9 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC21 byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  let offset = 2;
  while (offset < raw.length) {
    if (offset + 7 > raw.length) fail('INVALID_FILE_RECORD', 'FC21 sub-request header is truncated', { offset });
    if (raw[offset] !== 0x06) fail('INVALID_REFERENCE_TYPE', 'FC21 reference type must be 0x06', { referenceType: raw[offset] });
    const fileNumber = raw.readUInt16BE(offset + 1);
    const recordNumber = raw.readUInt16BE(offset + 3);
    const recordLength = raw.readUInt16BE(offset + 5);
    if (recordLength < 1 || recordLength > 122) fail('QUANTITY_OUT_OF_RANGE', 'FC21 record length is invalid', { recordLength });
    const end = offset + 7 + recordLength * 2;
    if (end > raw.length) fail('INVALID_FILE_RECORD', 'FC21 record data is truncated', { recordLength, offset });
    const values = [];
    for (let cursor = offset + 7; cursor < end; cursor += 2) values.push(raw.readUInt16BE(cursor));
    records.push({ referenceType: 0x06, fileNumber, recordNumber, recordLength, values });
    offset = end;
  }
  if (offset !== raw.length) fail('INVALID_FILE_RECORD', 'FC21 record boundary does not match PDU end', { offset, length: raw.length });
  return { functionCode: raw[0], byteCount, records };
}

function encodeReadFifoQueueRequest({ address }) {
  uint16(address, 'address');
  const pdu = Buffer.alloc(3);
  pdu[0] = EXTENDED_FC.READ_FIFO_QUEUE;
  pdu.writeUInt16BE(address, 1);
  return pdu;
}

function decodeReadFifoQueueRequest(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_FIFO_QUEUE) fail('INVALID_FUNCTION_CODE', 'Not an FC24 request', { functionCode: raw[0] });
  exact(raw, 3);
  return { functionCode: raw[0], address: raw.readUInt16BE(1) };
}

function encodeReadFifoQueueResponse({ values }) {
  if (!Array.isArray(values) || values.length > 31) fail('QUANTITY_OUT_OF_RANGE', 'FC24 FIFO count must be 0..31 registers', { quantity: values?.length });
  values.forEach((value, index) => uint16(value, `values[${index}]`));
  const byteCount = 2 + values.length * 2;
  const pdu = Buffer.alloc(3 + byteCount);
  pdu[0] = EXTENDED_FC.READ_FIFO_QUEUE;
  pdu.writeUInt16BE(byteCount, 1);
  pdu.writeUInt16BE(values.length, 3);
  values.forEach((value, index) => pdu.writeUInt16BE(value, 5 + index * 2));
  return pdu;
}

function decodeReadFifoQueueResponse(pdu) {
  const raw = validatePdu(pdu);
  if (raw[0] !== EXTENDED_FC.READ_FIFO_QUEUE) fail('INVALID_FUNCTION_CODE', 'Not an FC24 response', { functionCode: raw[0] });
  if (raw.length < 5) fail('INVALID_PDU_LENGTH', 'FC24 response is too short', { actual: raw.length });
  const byteCount = raw.readUInt16BE(1);
  const fifoCount = raw.readUInt16BE(3);
  if (fifoCount > 31 || byteCount !== 2 + fifoCount * 2 || raw.length !== 3 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC24 FIFO count/byte count does not match payload', { byteCount, fifoCount, payloadBytes: raw.length - 3 });
  const values = [];
  for (let offset = 5; offset < raw.length; offset += 2) values.push(raw.readUInt16BE(offset));
  return { functionCode: raw[0], byteCount, fifoCount, values };
}

module.exports = {
  EXTENDED_FC,
  DIAGNOSTIC_SUBFUNCTION,
  encodeReadExceptionStatusRequest,
  decodeReadExceptionStatusRequest,
  encodeReadExceptionStatusResponse,
  decodeReadExceptionStatusResponse,
  encodeDiagnostics,
  decodeDiagnostics,
  encodeGetCommEventCounterRequest,
  decodeGetCommEventCounterRequest,
  encodeGetCommEventCounterResponse,
  decodeGetCommEventCounterResponse,
  encodeGetCommEventLogRequest,
  decodeGetCommEventLogRequest,
  encodeGetCommEventLogResponse,
  decodeGetCommEventLogResponse,
  encodeReportServerIdRequest,
  decodeReportServerIdRequest,
  encodeReportServerIdResponse,
  decodeReportServerIdResponse,
  encodeReadFileRecordRequest,
  decodeReadFileRecordRequest,
  encodeReadFileRecordResponse,
  decodeReadFileRecordResponse,
  encodeWriteFileRecord,
  decodeWriteFileRecord,
  encodeReadFifoQueueRequest,
  decodeReadFifoQueueRequest,
  encodeReadFifoQueueResponse,
  decodeReadFifoQueueResponse,
};
