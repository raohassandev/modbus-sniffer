'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendCrc } = require('../src/modbus/crc16');
const { FrameExtractor } = require('../src/modbus/frameExtractor');

test('extracts back-to-back valid FC03 request and response frames', () => {
  const extractor = new FrameExtractor({ baudRate: 9600 });
  const frames = [];
  extractor.on('frame', frame => frames.push(frame));
  const req = appendCrc(Buffer.from([1, 3, 0, 10, 0, 2]));
  const rsp = appendCrc(Buffer.from([1, 3, 4, 0, 1, 0, 2]));
  extractor.push(Buffer.concat([req, rsp]), 1000);
  extractor.flush();
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], req);
  assert.deepEqual(frames[1], rsp);
});
