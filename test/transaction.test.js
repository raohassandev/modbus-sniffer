'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame } = require('../src/modbus/decoder');
const { TransactionTracker } = require('../src/modbus/transactionTracker');

test('pairs FC03 request/response and maps register addresses', () => {
  const tracker = new TransactionTracker();
  const reqFrame = appendCrc(Buffer.from([1, 3, 0x7E, 0x4F, 0, 2]));
  const rspFrame = appendCrc(Buffer.from([1, 3, 4, 0x43, 0x2A, 0, 0]));
  const req = tracker.process(decodeFrame(reqFrame), 1000);
  const rsp = tracker.process(decodeFrame(rspFrame), 1055);
  assert.equal(req.direction, 'REQ');
  assert.equal(rsp.direction, 'RSP');
  assert.equal(rsp.rttMs, 55);
  assert.deepEqual(rsp.decoded.registers.map(x => [x.address, x.value]), [[32335, 17194], [32336, 0]]);
});
