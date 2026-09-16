'use strict';

const { fail } = require('./errors');
const { validatePdu } = require('./model');

const FC = Object.freeze({
  READ_EXCEPTION_STATUS: 0x07,
  DIAGNOSTICS: 0x08,
  GET_COMM_EVENT_COUNTER: 0x0B,
  GET_COMM_EVENT_LOG: 0x0C,
  REPORT_SERVER_ID: 0x11,
  READ_FILE_RECORD: 0x14,
  WRITE_FILE_RECORD: 0x15,
  READ_FIFO_QUEUE: 0x18,
});

const FILE_REFERENCE_TYPE = 0x06;

function byte(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) fail('BYTE_OUT_OF_RANGE', `${field} must be 0..255`, { field, value });
  return value;
}

function uint16(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) fail('UINT16_OUT_OF_RANGE', `${field} must be 0..65535`, { field, value });
  return value;
}

function exactLength(raw, expected) {
  if (raw.length !== expected) fail('INVALID_PDU_LENGTH', `PDU length must be exactly ${expected} bytes`, { expected, actual: raw.length, functionCode: raw[0] });
}

function expectFc(raw, functionCode, label) {
  if (raw[0] !== functionCode) fail('INVALID_FUNCTION_CODE', `Not an ${label} PDU`, { functionCode: raw[0], expected: functionCode });
}

function encodeReadExceptionStatusRequest() {
  return Buffer.from([FC.READ_EXCEPTION_STATUS]);
}

function decodeReadExceptionStatusRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_EXCEPTION_STATUS, 'FC07 request');
  exactLength(raw, 1);
  return { functionCode: raw[0] };
}

function encodeReadExceptionStatusResponse({ status }) {
  byte(status, 'status');
  return Buffer.from([FC.READ_EXCEPTION_STATUS, status]);
}

function decodeReadExceptionStatusResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_EXCEPTION_STATUS, 'FC07 response');
  exactLength(raw, 2);
  return { functionCode: raw[0], status: raw[1] };
}

function encodeDiagnosticsRequest({ subFunction, data = 0 }) {
  uint16(subFunction, 'subFunction');
  uint16(data, 'data');
  const pdu = Buffer.alloc(5);
  pdu[0] = FC.DIAGNOSTICS;
  pdu.writeUInt16BE(subFunction, 1);
  pdu.writeUInt16BE(data, 3);
  return pdu;
}

function decodeDiagnosticsRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.DIAGNOSTICS, 'FC08 request');
  exactLength(raw, 5);
  return { functionCode: raw[0], subFunction: raw.readUInt16BE(1), data: raw.readUInt16BE(3) };
}

function encodeDiagnosticsResponse({ subFunction, data = 0 }) {
  return encodeDiagnosticsRequest({ subFunction, data });
}

function decodeDiagnosticsResponse(pdu) {
  return decodeDiagnosticsRequest(pdu);
}

function encodeCommEventCounterRequest() {
  return Buffer.from([FC.GET_COMM_EVENT_COUNTER]);
}

function decodeCommEventCounterRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.GET_COMM_EVENT_COUNTER, 'FC11 request');
  exactLength(raw, 1);
  return { functionCode: raw[0] };
}

function encodeCommEventCounterResponse({ status, eventCount }) {
  uint16(status, 'status');
  uint16(eventCount, 'eventCount');
  const pdu = Buffer.alloc(5);
  pdu[0] = FC.GET_COMM_EVENT_COUNTER;
  pdu.writeUInt16BE(status, 1);
  pdu.writeUInt16BE(eventCount, 3);
  return pdu;
}

function decodeCommEventCounterResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.GET_COMM_EVENT_COUNTER, 'FC11 response');
  exactLength(raw, 5);
  return { functionCode: raw[0], status: raw.readUInt16BE(1), eventCount: raw.readUInt16BE(3) };
}

function encodeCommEventLogRequest() {
  return Buffer.from([FC.GET_COMM_EVENT_LOG]);
}

function decodeCommEventLogRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.GET_COMM_EVENT_LOG, 'FC12 request');
  exactLength(raw, 1);
  return { functionCode: raw[0] };
}

function encodeCommEventLogResponse({ status, eventCount, messageCount, events = [] }) {
  uint16(status, 'status');
  uint16(eventCount, 'eventCount');
  uint16(messageCount, 'messageCount');
  const eventBytes = Buffer.from(events);
  if (eventBytes.length > 243) fail('EVENT_LOG_TOO_LONG', 'FC12 event list cannot exceed 243 bytes', { length: eventBytes.length });
  const byteCount = 6 + eventBytes.length;
  const pdu = Buffer.alloc(2 + byteCount);
  pdu[0] = FC.GET_COMM_EVENT_LOG;
  pdu[1] = byteCount;
  pdu.writeUInt16BE(status, 2);
  pdu.writeUInt16BE(eventCount, 4);
  pdu.writeUInt16BE(messageCount, 6);
  eventBytes.copy(pdu, 8);
  return validatePdu(pdu);
}

function decodeCommEventLogResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.GET_COMM_EVENT_LOG, 'FC12 response');
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
  return Buffer.from([FC.REPORT_SERVER_ID]);
}

function decodeReportServerIdRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.REPORT_SERVER_ID, 'FC17 request');
  exactLength(raw, 1);
  return { functionCode: raw[0] };
}

function encodeReportServerIdResponse({ serverId, runIndicatorStatus = 0xFF, additionalData = Buffer.alloc(0) }) {
  byte(serverId, 'serverId');
  byte(runIndicatorStatus, 'runIndicatorStatus');
  const extra = Buffer.from(additionalData ?? []);
  if (extra.length > 249) fail('SERVER_ID_DATA_TOO_LONG', 'FC17 additional data is too long', { length: extra.length });
  const byteCount = 2 + extra.length;
  return validatePdu(Buffer.concat([Buffer.from([FC.REPORT_SERVER_ID, byteCount, serverId, runIndicatorStatus]), extra]));
}

function decodeReportServerIdResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.REPORT_SERVER_ID, 'FC17 response');
  if (raw.length < 4) fail('INVALID_PDU_LENGTH', 'FC17 response is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (byteCount < 2 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC17 byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  return {
    functionCode: raw[0],
    byteCount,
    serverId: raw[2],
    runIndicatorStatus: raw[3],
    additionalData: Buffer.from(raw.subarray(4)),
  };
}

function normalizeReadFileRecords(records) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'records must be a non-empty array');
  if (records.length > 35) fail('TOO_MANY_FILE_RECORDS', 'FC20 supports at most 35 seven-byte subrequests in one PDU', { count: records.length });
  return records.map((record, index) => {
    const referenceType = record.referenceType ?? FILE_REFERENCE_TYPE;
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'File record reference type must be 0x06', { index, referenceType });
    uint16(record.fileNumber, `records[${index}].fileNumber`);
    uint16(record.recordNumber, `records[${index}].recordNumber`);
    if (!Number.isInteger(record.recordLength) || record.recordLength < 1 || record.recordLength > 125) fail('QUANTITY_OUT_OF_RANGE', 'recordLength must be 1..125', { index, recordLength: record.recordLength });
    return { referenceType, fileNumber: record.fileNumber, recordNumber: record.recordNumber, recordLength: record.recordLength };
  });
}

function encodeReadFileRecordRequest({ records }) {
  const normalized = normalizeReadFileRecords(records);
  const byteCount = normalized.length * 7;
  if (byteCount > 245) fail('FILE_RECORD_REQUEST_TOO_LONG', 'FC20 request data cannot exceed 245 bytes', { byteCount });
  const pdu = Buffer.alloc(2 + byteCount);
  pdu[0] = FC.READ_FILE_RECORD;
  pdu[1] = byteCount;
  normalized.forEach((record, index) => {
    const offset = 2 + index * 7;
    pdu[offset] = FILE_REFERENCE_TYPE;
    pdu.writeUInt16BE(record.fileNumber, offset + 1);
    pdu.writeUInt16BE(record.recordNumber, offset + 3);
    pdu.writeUInt16BE(record.recordLength, offset + 5);
  });
  return validatePdu(pdu);
}

function decodeReadFileRecordRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_FILE_RECORD, 'FC20 request');
  if (raw.length < 9) fail('INVALID_PDU_LENGTH', 'FC20 request is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (byteCount < 7 || byteCount > 245 || byteCount % 7 !== 0 || raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC20 byte count must be a multiple of 7 and match payload', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  for (let offset = 2; offset < raw.length; offset += 7) {
    const referenceType = raw[offset];
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'FC20 reference type must be 0x06', { referenceType, offset });
    const recordLength = raw.readUInt16BE(offset + 5);
    if (recordLength < 1 || recordLength > 125) fail('QUANTITY_OUT_OF_RANGE', 'FC20 record length must be 1..125', { recordLength });
    records.push({ referenceType, fileNumber: raw.readUInt16BE(offset + 1), recordNumber: raw.readUInt16BE(offset + 3), recordLength });
  }
  return { functionCode: raw[0], byteCount, records };
}

function encodeReadFileRecordResponse({ records }) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'records must be a non-empty array');
  const parts = [];
  let byteCount = 0;
  records.forEach((record, index) => {
    const referenceType = record.referenceType ?? FILE_REFERENCE_TYPE;
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'File record reference type must be 0x06', { index, referenceType });
    const values = Array.isArray(record.values) ? record.values : [];
    if (!values.length || values.length > 125) fail('QUANTITY_OUT_OF_RANGE', 'FC20 record values length must be 1..125', { index, length: values.length });
    const data = Buffer.alloc(values.length * 2);
    values.forEach((value, valueIndex) => {
      uint16(value, `records[${index}].values[${valueIndex}]`);
      data.writeUInt16BE(value, valueIndex * 2);
    });
    const responseLength = 1 + data.length;
    if (responseLength > 0xFF) fail('FILE_RECORD_RESPONSE_TOO_LONG', 'FC20 one subresponse exceeds one-byte length', { index, responseLength });
    parts.push(Buffer.concat([Buffer.from([responseLength, referenceType]), data]));
    byteCount += 1 + responseLength;
  });
  if (byteCount > 251) fail('FILE_RECORD_RESPONSE_TOO_LONG', 'FC20 response data cannot exceed 251 bytes', { byteCount });
  return validatePdu(Buffer.concat([Buffer.from([FC.READ_FILE_RECORD, byteCount]), ...parts]));
}

function decodeReadFileRecordResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_FILE_RECORD, 'FC20 response');
  if (raw.length < 5) fail('INVALID_PDU_LENGTH', 'FC20 response is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC20 response byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  let offset = 2;
  while (offset < raw.length) {
    const responseLength = raw[offset++];
    if (responseLength < 3 || offset + responseLength > raw.length + 1) fail('INVALID_FILE_RECORD_RESPONSE', 'FC20 subresponse length is invalid', { responseLength, offset: offset - 1 });
    const end = offset + responseLength;
    const referenceType = raw[offset++];
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'FC20 reference type must be 0x06', { referenceType, offset: offset - 1 });
    const dataBytes = responseLength - 1;
    if ((dataBytes & 1) !== 0 || offset + dataBytes > raw.length) fail('INVALID_FILE_RECORD_RESPONSE', 'FC20 register data must contain complete 16-bit values', { dataBytes });
    const values = [];
    while (offset < end) {
      values.push(raw.readUInt16BE(offset));
      offset += 2;
    }
    records.push({ referenceType, values });
  }
  return { functionCode: raw[0], byteCount, records };
}

function normalizeWriteFileRecords(records) {
  if (!Array.isArray(records) || !records.length) fail('INVALID_FILE_RECORDS', 'records must be a non-empty array');
  return records.map((record, index) => {
    const referenceType = record.referenceType ?? FILE_REFERENCE_TYPE;
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'File record reference type must be 0x06', { index, referenceType });
    uint16(record.fileNumber, `records[${index}].fileNumber`);
    uint16(record.recordNumber, `records[${index}].recordNumber`);
    const values = Array.isArray(record.values) ? record.values : [];
    if (!values.length || values.length > 121) fail('QUANTITY_OUT_OF_RANGE', 'FC21 record values length must be 1..121', { index, length: values.length });
    values.forEach((value, valueIndex) => uint16(value, `records[${index}].values[${valueIndex}]`));
    return { referenceType, fileNumber: record.fileNumber, recordNumber: record.recordNumber, values: [...values] };
  });
}

function encodeWriteFileRecordRequest({ records }) {
  const normalized = normalizeWriteFileRecords(records);
  const parts = [];
  let byteCount = 0;
  normalized.forEach((record) => {
    const block = Buffer.alloc(7 + record.values.length * 2);
    block[0] = FILE_REFERENCE_TYPE;
    block.writeUInt16BE(record.fileNumber, 1);
    block.writeUInt16BE(record.recordNumber, 3);
    block.writeUInt16BE(record.values.length, 5);
    record.values.forEach((value, index) => block.writeUInt16BE(value, 7 + index * 2));
    parts.push(block);
    byteCount += block.length;
  });
  if (byteCount > 251) fail('FILE_RECORD_REQUEST_TOO_LONG', 'FC21 request data cannot exceed 251 bytes', { byteCount });
  return validatePdu(Buffer.concat([Buffer.from([FC.WRITE_FILE_RECORD, byteCount]), ...parts]));
}

function decodeWriteFileRecordRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.WRITE_FILE_RECORD, 'FC21 request/response');
  if (raw.length < 11) fail('INVALID_PDU_LENGTH', 'FC21 PDU is too short', { actual: raw.length });
  const byteCount = raw[1];
  if (raw.length !== 2 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC21 byte count does not match payload', { byteCount, payloadBytes: raw.length - 2 });
  const records = [];
  let offset = 2;
  while (offset < raw.length) {
    if (offset + 7 > raw.length) fail('TRUNCATED_FILE_RECORD', 'FC21 record header is truncated', { offset });
    const referenceType = raw[offset];
    if (referenceType !== FILE_REFERENCE_TYPE) fail('INVALID_REFERENCE_TYPE', 'FC21 reference type must be 0x06', { referenceType, offset });
    const fileNumber = raw.readUInt16BE(offset + 1);
    const recordNumber = raw.readUInt16BE(offset + 3);
    const recordLength = raw.readUInt16BE(offset + 5);
    if (recordLength < 1 || recordLength > 121) fail('QUANTITY_OUT_OF_RANGE', 'FC21 record length must be 1..121', { recordLength, offset });
    const dataStart = offset + 7;
    const dataEnd = dataStart + recordLength * 2;
    if (dataEnd > raw.length) fail('TRUNCATED_FILE_RECORD', 'FC21 record data is truncated', { offset, recordLength });
    const values = [];
    for (let dataOffset = dataStart; dataOffset < dataEnd; dataOffset += 2) values.push(raw.readUInt16BE(dataOffset));
    records.push({ referenceType, fileNumber, recordNumber, recordLength, values });
    offset = dataEnd;
  }
  return { functionCode: raw[0], byteCount, records };
}

function encodeWriteFileRecordResponse({ records }) {
  return encodeWriteFileRecordRequest({ records });
}

function decodeWriteFileRecordResponse(pdu) {
  return decodeWriteFileRecordRequest(pdu);
}

function encodeReadFifoQueueRequest({ address }) {
  uint16(address, 'address');
  const pdu = Buffer.alloc(3);
  pdu[0] = FC.READ_FIFO_QUEUE;
  pdu.writeUInt16BE(address, 1);
  return pdu;
}

function decodeReadFifoQueueRequest(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_FIFO_QUEUE, 'FC24 request');
  exactLength(raw, 3);
  return { functionCode: raw[0], address: raw.readUInt16BE(1) };
}

function encodeReadFifoQueueResponse({ values }) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 31) fail('QUANTITY_OUT_OF_RANGE', 'FC24 FIFO count must be 1..31', { length: values?.length });
  values.forEach((value, index) => uint16(value, `values[${index}]`));
  const fifoCount = values.length;
  const byteCount = 2 + fifoCount * 2;
  const pdu = Buffer.alloc(3 + byteCount);
  pdu[0] = FC.READ_FIFO_QUEUE;
  pdu.writeUInt16BE(byteCount, 1);
  pdu.writeUInt16BE(fifoCount, 3);
  values.forEach((value, index) => pdu.writeUInt16BE(value, 5 + index * 2));
  return validatePdu(pdu);
}

function decodeReadFifoQueueResponse(pdu) {
  const raw = validatePdu(pdu);
  expectFc(raw, FC.READ_FIFO_QUEUE, 'FC24 response');
  if (raw.length < 7) fail('INVALID_PDU_LENGTH', 'FC24 response is too short', { actual: raw.length });
  const byteCount = raw.readUInt16BE(1);
  const fifoCount = raw.readUInt16BE(3);
  if (fifoCount < 1 || fifoCount > 31) fail('QUANTITY_OUT_OF_RANGE', 'FC24 FIFO count must be 1..31', { fifoCount });
  const expectedByteCount = 2 + fifoCount * 2;
  if (byteCount !== expectedByteCount || raw.length !== 3 + byteCount) fail('BYTE_COUNT_MISMATCH', 'FC24 byte count does not match FIFO count/payload', { byteCount, expectedByteCount, payloadBytes: raw.length - 3 });
  const values = [];
  for (let offset = 5; offset < raw.length; offset += 2) values.push(raw.readUInt16BE(offset));
  return { functionCode: raw[0], byteCount, fifoCount, values };
}

function decodeExtendedRequestPdu(pdu) {
  const raw = validatePdu(pdu);
  switch (raw[0]) {
    case FC.READ_EXCEPTION_STATUS: return decodeReadExceptionStatusRequest(raw);
    case FC.DIAGNOSTICS: return decodeDiagnosticsRequest(raw);
    case FC.GET_COMM_EVENT_COUNTER: return decodeCommEventCounterRequest(raw);
    case FC.GET_COMM_EVENT_LOG: return decodeCommEventLogRequest(raw);
    case FC.REPORT_SERVER_ID: return decodeReportServerIdRequest(raw);
    case FC.READ_FILE_RECORD: return decodeReadFileRecordRequest(raw);
    case FC.WRITE_FILE_RECORD: return decodeWriteFileRecordRequest(raw);
    case FC.READ_FIFO_QUEUE: return decodeReadFifoQueueRequest(raw);
    default: return null;
  }
}

module.exports = {
  FC,
  FILE_REFERENCE_TYPE,
  encodeReadExceptionStatusRequest,
  decodeReadExceptionStatusRequest,
  encodeReadExceptionStatusResponse,
  decodeReadExceptionStatusResponse,
  encodeDiagnosticsRequest,
  decodeDiagnosticsRequest,
  encodeDiagnosticsResponse,
  decodeDiagnosticsResponse,
  encodeCommEventCounterRequest,
  decodeCommEventCounterRequest,
  encodeCommEventCounterResponse,
  decodeCommEventCounterResponse,
  encodeCommEventLogRequest,
  decodeCommEventLogRequest,
  encodeCommEventLogResponse,
  decodeCommEventLogResponse,
  encodeReportServerIdRequest,
  decodeReportServerIdRequest,
  encodeReportServerIdResponse,
  decodeReportServerIdResponse,
  encodeReadFileRecordRequest,
  decodeReadFileRecordRequest,
  encodeReadFileRecordResponse,
  decodeReadFileRecordResponse,
  encodeWriteFileRecordRequest,
  decodeWriteFileRecordRequest,
  encodeWriteFileRecordResponse,
  decodeWriteFileRecordResponse,
  encodeReadFifoQueueRequest,
  decodeReadFifoQueueRequest,
  encodeReadFifoQueueResponse,
  decodeReadFifoQueueResponse,
  decodeExtendedRequestPdu,
};
