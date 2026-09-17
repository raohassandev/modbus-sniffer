'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const protocol = require('../src/v8/protocol');
const {
  MasterRuntime,
  normalizeConnectionConfig,
  normalizeReadRequest,
  referenceAddress,
} = require('../src/master/masterRuntime');

class FakeTransport extends EventEmitter {
  constructor(response) {
    super();
    this.response = Buffer.from(response);
    this.state = 'closed';
    this.sent = [];
    this.capabilities = { transport: 'fake', duplex: true };
  }
  async open() { this.state = 'open'; this.emit('state', { state:'open' }); return { state:'open' }; }
  async close() { this.state = 'closed'; this.emit('state', { state:'closed' }); return { state:'closed' }; }
  async send(bytes) { this.sent.push(Buffer.from(bytes)); }
  async receive() { return Buffer.from(this.response); }
}

test('connection normalization supports RTU, ASCII and TCP with bounded defaults', () => {
  assert.deepEqual(normalizeConnectionConfig({ type:'rtu', path:'COM5' }), {
    type:'rtu', path:'COM5', baudRate:9600, dataBits:8, stopBits:1, parity:'none', timeoutMs:1000, echoSuppression:false,
  });
  assert.deepEqual(normalizeConnectionConfig({ type:'ascii', path:'/dev/ttyUSB0', baudRate:19200, parity:'even' }), {
    type:'ascii', path:'/dev/ttyUSB0', baudRate:19200, dataBits:8, stopBits:1, parity:'even', timeoutMs:1000, echoSuppression:false,
  });
  assert.deepEqual(normalizeConnectionConfig({ type:'tcp', host:'192.168.1.50' }), {
    type:'tcp', host:'192.168.1.50', port:502, timeoutMs:1000,
  });
  assert.throws(() => normalizeConnectionConfig({ type:'tcp', host:'', port:502 }), /host\/IP address is required/);
});

test('read request validation applies Modbus FC01-04 quantity limits', () => {
  assert.deepEqual(normalizeReadRequest({ unitId:1, functionCode:3, address:0, quantity:125 }), {
    unitId:1, functionCode:3, address:0, quantity:125, timeoutMs:null,
  });
  assert.throws(() => normalizeReadRequest({ unitId:1, functionCode:3, address:0, quantity:126 }), /quantity must be 1\.\.125/);
  assert.throws(() => normalizeReadRequest({ unitId:1, functionCode:5, address:0, quantity:1 }), /functionCode must be 1\.\.4/);
});

test('reference addressing is explicit without changing raw PDU addresses', () => {
  assert.equal(referenceAddress(1, 0), '00001');
  assert.equal(referenceAddress(2, 0), '10001');
  assert.equal(referenceAddress(3, 0), '40001');
  assert.equal(referenceAddress(4, 0), '30001');
  assert.equal(referenceAddress(3, 9), '40010');
});

test('MasterRuntime performs an RTU FC03 read using the shared MasterEngine', async () => {
  const responsePdu = protocol.encodeReadRegistersResponse({ functionCode:3, values:[100, 200] });
  const responseAdu = protocol.encodeRtuAdu(1, responsePdu);
  let transport;
  const runtime = new MasterRuntime({
    transportFactory: () => (transport = new FakeTransport(responseAdu)),
    now: (() => { let t=1000; return () => ++t; })(),
  });

  const connected = await runtime.connect({ type:'rtu', path:'COM5', timeoutMs:500 });
  assert.equal(connected.connected, true);
  assert.equal(connected.writeState, 'LOCKED');

  const out = await runtime.read({ unitId:1, functionCode:3, address:0, quantity:2 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows.map(row => row.value), [100, 200]);
  assert.deepEqual(out.rows.map(row => row.reference), ['40001', '40002']);
  assert.equal(out.rows[0].rawHex, '0x0064');
  assert.equal(out.stats.txRequests, 1);
  assert.equal(out.stats.rxResponses, 1);
  assert.equal(out.stats.errors, 0);
  assert.equal(transport.sent.length, 1);
  assert.equal(protocol.decodeRtuAdu(transport.sent[0]).unitId, 1);
  await runtime.disconnect();
  assert.equal(runtime.status().connected, false);
});

test('MasterRuntime decodes FC01 bit responses into live rows', async () => {
  const responsePdu = protocol.encodeReadBitsResponse({ functionCode:1, values:[true, false, true] });
  const responseAdu = protocol.encodeRtuAdu(7, responsePdu);
  const runtime = new MasterRuntime({ transportFactory: () => new FakeTransport(responseAdu) });
  await runtime.connect({ type:'rtu', path:'COM7' });
  const out = await runtime.read({ unitId:7, functionCode:1, address:10, quantity:3 });
  assert.deepEqual(out.rows.map(row => row.value), [true, false, true]);
  assert.deepEqual(out.rows.map(row => row.reference), ['00011', '00012', '00013']);
  await runtime.disconnect();
});
