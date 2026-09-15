'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame, EXCEPTION_NAMES } = require('../src/modbus/decoder');
const { FrameExtractor } = require('../src/modbus/frameExtractor');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');

const rtu = bytes => appendCrc(Buffer.from(bytes));

test('FC08 Diagnostics preserves variable payload and subfunction meaning', () => {
  const raw = rtu([1,8,0,0,0x12,0x34,0x56,0x78]);
  const d = decodeFrame(raw);
  assert.equal(d.functionName, 'Diagnostics');
  assert.equal(d.subFunction, 0);
  assert.equal(d.subFunctionName, 'Return Query Data');
  assert.deepEqual(d.dataWords, [0x1234,0x5678]);
  assert.equal(d.payloadValid, true);

  const extractor = new FrameExtractor({baudRate:115200});
  const frames=[]; extractor.on('frame',x=>frames.push(x));
  extractor.push(raw.subarray(0,8),1000);
  extractor.push(raw.subarray(8),1000.1);
  extractor.flush();
  assert.equal(frames.length,1);
  assert.equal(frames[0].toString('hex'),raw.toString('hex'));
});

test('FC20 Read File Record request and response decode standard records', () => {
  const req = decodeFrame(rtu([1,20,7,6,0,1,0,2,0,2]));
  assert.equal(req.kind,'request');
  assert.deepEqual(req.records,[{referenceType:6,fileNumber:1,recordNumber:2,recordLength:2}]);
  assert.equal(req.payloadValid,true);

  const rsp = decodeFrame(rtu([1,20,6,5,6,0x11,0x11,0x22,0x22]));
  assert.equal(rsp.kind,'response');
  assert.equal(rsp.records.length,1);
  assert.deepEqual(rsp.records[0].words,[0x1111,0x2222]);
  assert.equal(rsp.payloadValid,true);
});

test('FC21 Write File Record is parsed and request echo is paired without guessing', () => {
  const raw = rtu([1,21,11,6,0,1,0,2,0,2,0x11,0x11,0x22,0x22]);
  const d=decodeFrame(raw);
  assert.equal(d.kind,'ambiguous');
  assert.equal(d.records[0].fileNumber,1);
  assert.deepEqual(d.records[0].words,[0x1111,0x2222]);
  const tracker=new AdvancedTransactionTracker();
  assert.equal(tracker.process(decodeFrame(raw),1000).direction,'REQ');
  const rsp=tracker.process(decodeFrame(raw),1015);
  assert.equal(rsp.direction,'RSP');
  assert.equal(rsp.rttMs,15);
});

test('FC24 Read FIFO Queue request and response decode with bounded count', () => {
  const req=decodeFrame(rtu([1,24,0x12,0x34]));
  assert.equal(req.kind,'request');
  assert.equal(req.fifoPointerAddress,0x1234);

  const raw=rtu([1,24,0,6,0,2,0x11,0x11,0x22,0x22]);
  const rsp=decodeFrame(raw);
  assert.equal(rsp.kind,'response');
  assert.equal(rsp.fifoCount,2);
  assert.deepEqual(rsp.fifoValues,[0x1111,0x2222]);
  assert.equal(rsp.payloadValid,true);

  const extractor=new FrameExtractor(); const frames=[];extractor.on('frame',x=>frames.push(x));
  for(let i=0;i<raw.length;i++)extractor.push(raw.subarray(i,i+1),1000+i);
  extractor.flush();assert.equal(frames.length,1);
});

test('protocol quantity and byte-count bounds reject unsafe point/register creation', () => {
  const zero=decodeFrame(rtu([1,3,0,0,0,0]));
  assert.equal(zero.kind,'request');assert.equal(zero.payloadValid,false);

  const max=decodeFrame(rtu([1,3,0xFF,0xFF,0,1]));
  assert.equal(max.startAddress,65535);assert.equal(max.quantity,1);assert.equal(max.payloadValid,true);

  const tooMany=decodeFrame(rtu([1,3,0,0,0,126]));
  assert.equal(tooMany.payloadValid,false);

  const badWrite=decodeFrame(rtu([1,16,0,10,0,2,2,0x12,0x34]));
  assert.equal(badWrite.kind,'request');assert.equal(badWrite.payloadValid,false);assert.equal(badWrite.words,undefined);

  const badFifo=decodeFrame(rtu([1,24,0,4,0,2,0x12,0x34]));
  assert.equal(badFifo.payloadValid,false);assert.equal(badFifo.fifoValues,undefined);
});

test('all defined Modbus exception codes and unknown vendor functions are preserved safely', () => {
  for(const [code,name] of Object.entries(EXCEPTION_NAMES)){
    const d=decodeFrame(rtu([7,0x83,Number(code)]));
    assert.equal(d.exception,true);assert.equal(d.exceptionCode,Number(code));assert.equal(d.exceptionName,name);
  }
  const privateFc=decodeFrame(rtu([2,65,0xDE,0xAD,0xBE,0xEF]));
  assert.equal(privateFc.kind,'unknown');
  assert.equal(privateFc.payloadHex,'DEADBEEF');
});
