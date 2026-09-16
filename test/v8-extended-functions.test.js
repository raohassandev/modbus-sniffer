'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const p = require('../src/v8/protocol');

test('v8 standard function registry includes the extended protocol matrix', () => {
  assert.equal(p.FC.READ_EXCEPTION_STATUS, 0x07);
  assert.equal(p.FC.DIAGNOSTICS, 0x08);
  assert.equal(p.FC.GET_COMM_EVENT_COUNTER, 0x0B);
  assert.equal(p.FC.GET_COMM_EVENT_LOG, 0x0C);
  assert.equal(p.FC.REPORT_SERVER_ID, 0x11);
  assert.equal(p.FC.READ_FILE_RECORD, 0x14);
  assert.equal(p.FC.WRITE_FILE_RECORD, 0x15);
  assert.equal(p.FC.READ_FIFO_QUEUE, 0x18);
});

test('FC07 Read Exception Status request/response round-trip', () => {
  assert.equal(p.encodeReadExceptionStatusRequest().toString('hex').toUpperCase(), '07');
  assert.deepEqual(p.decodeReadExceptionStatusRequest(Buffer.from('07', 'hex')), { functionCode: 0x07 });
  assert.equal(p.encodeReadExceptionStatusResponse(0x5A).toString('hex').toUpperCase(), '075A');
  assert.deepEqual(p.decodeReadExceptionStatusResponse(Buffer.from('075A', 'hex')), { functionCode: 0x07, status: 0x5A });
});

test('FC08 Diagnostics uses fixed standard subfunction/data layout', () => {
  const pdu = p.encodeDiagnostics({ subFunction: p.DIAGNOSTIC_SUBFUNCTION.RETURN_QUERY_DATA, data: 0xA55A });
  assert.equal(pdu.toString('hex').toUpperCase(), '080000A55A');
  const decoded = p.decodeDiagnostics(pdu);
  assert.equal(decoded.subFunction, 0);
  assert.equal(decoded.dataUInt16, 0xA55A);
  assert.throws(() => p.decodeDiagnostics(Buffer.from('08000000', 'hex')), (error) => error.code === 'INVALID_PDU_LENGTH');
});

test('FC11 event counter and FC12 event log round-trip', () => {
  assert.equal(p.encodeGetCommEventCounterRequest().toString('hex').toUpperCase(), '0B');
  const counter = p.decodeGetCommEventCounterResponse(p.encodeGetCommEventCounterResponse({ status: 0xFFFF, eventCount: 17 }));
  assert.deepEqual(counter, { functionCode: 0x0B, status: 0xFFFF, eventCount: 17 });

  const log = p.decodeGetCommEventLogResponse(p.encodeGetCommEventLogResponse({
    status: 0x0000,
    eventCount: 2,
    messageCount: 10,
    events: Buffer.from([0x20, 0x40]),
  }));
  assert.equal(log.byteCount, 8);
  assert.equal(log.eventCount, 2);
  assert.equal(log.messageCount, 10);
  assert.equal(log.events.toString('hex').toUpperCase(), '2040');
});

test('FC17 Report Server ID keeps explicit server-id boundary', () => {
  const pdu = p.encodeReportServerIdResponse({
    serverId: Buffer.from('4142', 'hex'),
    runIndicator: 0xFF,
    additionalData: Buffer.from('7638', 'hex'),
  });
  const decoded = p.decodeReportServerIdResponse(pdu, { serverIdLength: 2 });
  assert.equal(decoded.serverId.toString('hex').toUpperCase(), '4142');
  assert.equal(decoded.runIndicator, 0xFF);
  assert.equal(decoded.additionalData.toString('hex').toUpperCase(), '7638'.toUpperCase());
});

test('FC20 Read File Record request and response support multiple records', () => {
  const request = p.encodeReadFileRecordRequest({ records: [
    { fileNumber: 4, recordNumber: 1, recordLength: 2 },
    { fileNumber: 5, recordNumber: 10, recordLength: 1 },
  ] });
  const decodedRequest = p.decodeReadFileRecordRequest(request);
  assert.equal(decodedRequest.records.length, 2);
  assert.deepEqual(decodedRequest.records[0], { referenceType: 6, fileNumber: 4, recordNumber: 1, recordLength: 2 });

  const response = p.encodeReadFileRecordResponse({ records: [
    { values: [0x1111, 0x2222] },
    { values: [0x3333] },
  ] });
  assert.deepEqual(p.decodeReadFileRecordResponse(response).records.map((record) => record.values), [[0x1111, 0x2222], [0x3333]]);
});

test('FC21 Write File Record echoes the exact write record structure', () => {
  const pdu = p.encodeWriteFileRecord({ records: [
    { fileNumber: 1, recordNumber: 2, values: [0x1234, 0x5678] },
    { fileNumber: 3, recordNumber: 4, values: [0x9ABC] },
  ] });
  const decoded = p.decodeWriteFileRecord(pdu);
  assert.deepEqual(decoded.records.map((record) => ({ fileNumber: record.fileNumber, recordNumber: record.recordNumber, values: record.values })), [
    { fileNumber: 1, recordNumber: 2, values: [0x1234, 0x5678] },
    { fileNumber: 3, recordNumber: 4, values: [0x9ABC] },
  ]);
  assert.deepEqual(p.decodeWriteFileRecord(Buffer.from(pdu)), decoded);
});

test('FC24 FIFO Queue request/response validates byte and FIFO counts', () => {
  const request = p.encodeReadFifoQueueRequest({ address: 0x1234 });
  assert.equal(request.toString('hex').toUpperCase(), '181234');
  assert.deepEqual(p.decodeReadFifoQueueRequest(request), { functionCode: 0x18, address: 0x1234 });

  const response = p.encodeReadFifoQueueResponse({ values: [1, 2, 65535] });
  assert.deepEqual(p.decodeReadFifoQueueResponse(response), {
    functionCode: 0x18,
    byteCount: 8,
    fifoCount: 3,
    values: [1, 2, 65535],
  });
  assert.throws(() => p.encodeReadFifoQueueResponse({ values: Array(32).fill(0) }), (error) => error.code === 'QUANTITY_OUT_OF_RANGE');
});

test('extended standard codecs reject malformed reference types and byte counts', () => {
  const badReadFile = Buffer.from('140706000100000001', 'hex');
  badReadFile[2] = 0x05;
  assert.throws(() => p.decodeReadFileRecordRequest(badReadFile), (error) => error.code === 'INVALID_REFERENCE_TYPE');

  const badFifo = Buffer.from('18000400020001', 'hex');
  assert.throws(() => p.decodeReadFifoQueueResponse(badFifo), (error) => error.code === 'BYTE_COUNT_MISMATCH');
});
