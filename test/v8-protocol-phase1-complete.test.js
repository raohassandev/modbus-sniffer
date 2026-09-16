'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

const p = v8.protocol;

function hex(buffer) { return Buffer.from(buffer).toString('hex').toUpperCase(); }

test('v8 exposes one merged standard function-code table', () => {
  assert.equal(p.FC.READ_COILS, 0x01);
  assert.equal(p.FC.READ_EXCEPTION_STATUS, 0x07);
  assert.equal(p.FC.DIAGNOSTICS, 0x08);
  assert.equal(p.FC.GET_COMM_EVENT_COUNTER, 0x0B);
  assert.equal(p.FC.GET_COMM_EVENT_LOG, 0x0C);
  assert.equal(p.FC.REPORT_SERVER_ID, 0x11);
  assert.equal(p.FC.READ_FILE_RECORD, 0x14);
  assert.equal(p.FC.WRITE_FILE_RECORD, 0x15);
  assert.equal(p.FC.MASK_WRITE_REGISTER, 0x16);
  assert.equal(p.FC.READ_WRITE_MULTIPLE_REGISTERS, 0x17);
  assert.equal(p.FC.READ_FIFO_QUEUE, 0x18);
  assert.equal(p.FC.ENCAPSULATED_INTERFACE, 0x2B);
});

test('FC07 Read Exception Status golden vector round-trip', () => {
  const request = p.encodeReadExceptionStatusRequest();
  assert.equal(hex(request), '07');
  assert.deepEqual(p.decodeReadExceptionStatusRequest(request), { functionCode: 7 });
  const response = p.encodeReadExceptionStatusResponse({ status: 0x55 });
  assert.equal(hex(response), '0755');
  assert.deepEqual(p.decodeReadExceptionStatusResponse(response), { functionCode: 7, status: 0x55 });
});

test('FC08 Diagnostics golden vector round-trip', () => {
  const request = p.encodeDiagnosticsRequest({ subFunction: 0, data: 0x1234 });
  assert.equal(hex(request), '0800001234');
  assert.deepEqual(p.decodeDiagnosticsRequest(request), { functionCode: 8, subFunction: 0, data: 0x1234 });
  assert.equal(hex(p.encodeDiagnosticsResponse({ subFunction: 4, data: 0 })), '0800040000');
});

test('FC11/FC12 communications event codecs validate counts and payload', () => {
  assert.equal(hex(p.encodeCommEventCounterRequest()), '0B');
  const counter = p.encodeCommEventCounterResponse({ status: 0xFFFF, eventCount: 3 });
  assert.equal(hex(counter), '0BFFFF0003');
  assert.deepEqual(p.decodeCommEventCounterResponse(counter), { functionCode: 11, status: 0xFFFF, eventCount: 3 });

  const log = p.encodeCommEventLogResponse({ status: 0xFFFF, eventCount: 3, messageCount: 4, events: [0x40, 0x20] });
  assert.equal(hex(log), '0C08FFFF000300044020');
  const decoded = p.decodeCommEventLogResponse(log);
  assert.equal(decoded.status, 0xFFFF);
  assert.equal(decoded.eventCount, 3);
  assert.equal(decoded.messageCount, 4);
  assert.equal(hex(decoded.events), '4020');
});

test('FC17 Report Server ID preserves additional data', () => {
  const response = p.encodeReportServerIdResponse({ serverId: 0x11, runIndicatorStatus: 0xFF, additionalData: Buffer.from('AB', 'ascii') });
  assert.equal(hex(response), '110411FF4142');
  const decoded = p.decodeReportServerIdResponse(response);
  assert.equal(decoded.serverId, 0x11);
  assert.equal(decoded.runIndicatorStatus, 0xFF);
  assert.equal(decoded.additionalData.toString('ascii'), 'AB');
});

test('FC20 Read File Record golden vectors round-trip', () => {
  const request = p.encodeReadFileRecordRequest({ records: [{ fileNumber: 4, recordNumber: 1, recordLength: 2 }] });
  assert.equal(hex(request), '140706000400010002');
  assert.deepEqual(p.decodeReadFileRecordRequest(request).records[0], { referenceType: 6, fileNumber: 4, recordNumber: 1, recordLength: 2 });

  const response = p.encodeReadFileRecordResponse({ records: [{ values: [0x0DFE, 0x0020] }] });
  assert.equal(hex(response), '140605060DFE0020');
  assert.deepEqual(p.decodeReadFileRecordResponse(response).records[0].values, [0x0DFE, 0x0020]);
});

test('FC21 Write File Record golden vector is symmetrical request/response', () => {
  const request = p.encodeWriteFileRecordRequest({ records: [{ fileNumber: 4, recordNumber: 1, values: [0x0DFE, 0x0020] }] });
  assert.equal(hex(request), '150B060004000100020DFE0020');
  const decoded = p.decodeWriteFileRecordRequest(request);
  assert.equal(decoded.records[0].recordLength, 2);
  assert.deepEqual(decoded.records[0].values, [0x0DFE, 0x0020]);
  assert.equal(hex(p.encodeWriteFileRecordResponse({ records: decoded.records })), hex(request));
});

test('FC24 Read FIFO Queue validates FIFO count and byte count', () => {
  const request = p.encodeReadFifoQueueRequest({ address: 1 });
  assert.equal(hex(request), '180001');
  const response = p.encodeReadFifoQueueResponse({ values: [0x0DFE, 0x0020] });
  assert.equal(hex(response), '18000600020DFE0020');
  assert.deepEqual(p.decodeReadFifoQueueResponse(response).values, [0x0DFE, 0x0020]);
});

test('unified request decoder recognizes extended FCs and preserves unsupported/vendor PDUs', () => {
  assert.equal(p.decodeRequestPdu(Buffer.from([0x07])).functionCode, 7);
  assert.equal(p.decodeRequestPdu(Buffer.from([0x18, 0x00, 0x01])).address, 1);
  const vendor = p.decodeRequestPdu(Buffer.from([0x41, 0xAA, 0xBB]));
  assert.equal(vendor.vendorOrUnsupported, true);
  assert.equal(hex(vendor.data), 'AABB');
  assert.equal(hex(vendor.pdu), '41AABB');
});

test('shared data model handles integer widths and exact 64-bit values', () => {
  assert.equal(p.decodeInteger(Buffer.from('FFFE', 'hex'), { bits: 16, signed: true }), -2);
  assert.equal(p.decodeInteger(Buffer.from('33441122', 'hex'), { bits: 32, order: 'CDAB' }), 0x11223344);
  const exact = p.decodeInteger(Buffer.from('FFFFFFFFFFFFFFFF', 'hex'), { bits: 64, signed: false });
  assert.equal(typeof exact, 'bigint');
  assert.equal(exact, 0xFFFFFFFFFFFFFFFFn);
  assert.equal(hex(p.encodeIntegerExact(0x11223344n, { bits: 32, order: 'CDAB' })), '33441122');
});

test('shared data model handles float32/float64 permutations', () => {
  const f32 = p.encodeFloat(12.5, { bits: 32, order: 'BADC' });
  assert.equal(p.decodeFloat(f32, { bits: 32, order: 'BADC' }), 12.5);
  const f64 = p.encodeFloat(-12345.25, { bits: 64, order: 'HGFEDCBA' });
  assert.equal(p.decodeFloat(f64, { bits: 64, order: 'HGFEDCBA' }), -12345.25);
});

test('shared data model handles ASCII, BCD and timestamp helpers', () => {
  const ascii = p.encodeAscii('INV1', { length: 8 });
  assert.equal(hex(ascii), '494E563100000000');
  assert.equal(p.decodeAscii(ascii), 'INV1');

  const bcd = p.encodeBcd('260916', { digits: 6 });
  assert.equal(hex(bcd), '260916');
  assert.equal(p.decodeBcd(bcd, { digits: 6 }), '260916');
  assert.equal(p.decodeBcdDateTime(Buffer.from('260916123045', 'hex')).toISOString(), '2026-09-16T12:30:45.000Z');
  assert.equal(p.decodeTimestamp(1_700_000_000, { unit: 'seconds' }).toISOString(), '2023-11-14T22:13:20.000Z');
});

test('deterministic v8 codec fuzz round-trips integer and float byte permutations', () => {
  let state = 0x12345678;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  const orders32 = ['ABCD', 'BADC', 'CDAB', 'DCBA'];
  for (let index = 0; index < 1000; index += 1) {
    const value = next();
    const order = orders32[index % orders32.length];
    const encoded = p.encodeIntegerExact(BigInt(value), { bits: 32, order });
    assert.equal(p.decodeIntegerExact(encoded, { bits: 32, order }), BigInt(value));
  }
  for (let index = 0; index < 250; index += 1) {
    const value = (next() / 0xFFFFFFFF) * 100000 - 50000;
    const order = orders32[index % orders32.length];
    const encoded = p.encodeFloat(value, { bits: 32, order });
    const decoded = p.decodeFloat(encoded, { bits: 32, order });
    assert.ok(Number.isFinite(decoded));
    assert.ok(Math.abs(decoded - value) < 0.02);
  }
});

test('malformed extended PDUs fail with structured protocol errors', () => {
  assert.throws(() => p.decodeCommEventLogResponse(Buffer.from('0C07FFFF00030004', 'hex')), (error) => error.code === 'BYTE_COUNT_MISMATCH');
  assert.throws(() => p.decodeReadFileRecordRequest(Buffer.from('14070600040001', 'hex')), (error) => error.code === 'INVALID_PDU_LENGTH' || error.code === 'BYTE_COUNT_MISMATCH');
  assert.throws(() => p.decodeReadFifoQueueResponse(Buffer.from('18000600030DFE0020', 'hex')), (error) => error.code === 'BYTE_COUNT_MISMATCH');
  assert.throws(() => p.decodeBcd(Buffer.from([0xFA])), (error) => error.code === 'INVALID_BCD');
});
