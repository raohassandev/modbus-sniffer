'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame } = require('../src/modbus/decoder');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');

function reqBits(slave, fc, address, qty) {
  return appendCrc(Buffer.from([slave, fc, address >> 8, address & 0xff, qty >> 8, qty & 0xff]));
}

function rspBits3(slave, fc, b0, b1, b2) {
  return appendCrc(Buffer.from([slave, fc, 3, b0, b1, b2]));
}

test('FC01 3-byte data response is 8 bytes but is matched as a response', () => {
  const tracker = new AdvancedTransactionTracker({ requestTimeoutMs: 1000 });
  const req = decodeFrame(reqBits(5, 1, 100, 24));
  const reqTx = tracker.process(req, 1000);
  assert.equal(reqTx.direction, 'REQ');

  const decoded = decodeFrame(rspBits3(5, 1, 0x55, 0xaa, 0x0f));
  assert.equal(decoded.kind, 'ambiguous-read');
  const rspTx = tracker.process(decoded, 1037);
  assert.equal(rspTx.direction, 'RSP');
  assert.equal(rspTx.rttMs, 37);
  assert.equal(rspTx.request.startAddress, 100);
  assert.equal(rspTx.decoded.points.length, 24);
  assert.equal(tracker.pending.length, 0);
});

test('FC02 request whose address high-byte is 3 remains a request when no reply is pending', () => {
  const tracker = new AdvancedTransactionTracker({ requestTimeoutMs: 1000 });
  const decoded = decodeFrame(reqBits(8, 2, 0x0312, 16));
  assert.equal(decoded.kind, 'ambiguous-read');
  const tx = tracker.process(decoded, 2000);
  assert.equal(tx.direction, 'REQ');
  assert.equal(tx.decoded.startAddress, 0x0312);
  assert.equal(tx.decoded.quantity, 16);
  assert.equal(tracker.pending.length, 1);
});
