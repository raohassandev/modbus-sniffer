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

class RecoveringTcpTransport extends EventEmitter {
  constructor() {
    super();
    this.state='closed';
    this.sent=[];
    this.opens=0;
    this.receiveCalls=0;
    this.capabilities={ transport:'tcp-client', duplex:true, supportsMatchedReceive:true };
  }
  async open() { this.opens += 1; this.state='open'; this.emit('state',{state:'open'}); return {state:'open'}; }
  async close() { this.state='closed'; this.emit('state',{state:'closed'}); return {state:'closed'}; }
  async send(bytes) {
    if(this.state!=='open'){const e=new Error('not open');e.code='NOT_OPEN';throw e;}
    this.sent.push(Buffer.from(bytes));
  }
  async receive() {
    this.receiveCalls += 1;
    if(this.receiveCalls===1){
      this.state='closed';
      this.emit('state',{state:'closed'});
      const e=new Error('simulated TCP drop');
      e.code='CONNECTION_LOST';
      throw e;
    }
    const request=protocol.decodeTcpAdu(this.sent[this.sent.length-1]);
    const pdu=protocol.encodeReadRegistersResponse({functionCode:3,values:[321]});
    return protocol.encodeTcpAdu({transactionId:request.transactionId,unitId:request.unitId,pdu});
  }
}

test('connection normalization supports RTU, ASCII and TCP with bounded defaults', () => {
  assert.deepEqual(normalizeConnectionConfig({ type:'rtu', path:'COM5' }), {
    type:'rtu', path:'COM5', baudRate:9600, dataBits:8, stopBits:1, parity:'none', timeoutMs:1000, echoSuppression:false,
    retries:0, retryDelayMs:100, interRequestDelayMs:0, rtsTxMode:'none', rtsSettleMs:0,
  });
  assert.deepEqual(normalizeConnectionConfig({ type:'ascii', path:'/dev/ttyUSB0', baudRate:19200, parity:'even' }), {
    type:'ascii', path:'/dev/ttyUSB0', baudRate:19200, dataBits:8, stopBits:1, parity:'even', timeoutMs:1000, echoSuppression:false,
    retries:0, retryDelayMs:100, interRequestDelayMs:0, rtsTxMode:'none', rtsSettleMs:0,
  });
  assert.deepEqual(normalizeConnectionConfig({ type:'tcp', host:'192.168.1.50' }), {
    type:'tcp', host:'192.168.1.50', port:502, timeoutMs:1000, retries:0, retryDelayMs:100, interRequestDelayMs:0,
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

test('MasterRuntime automatically reopens one dropped TCP read even when user retries are zero', async () => {
  let transport;
  const runtime=new MasterRuntime({transportFactory:()=> (transport=new RecoveringTcpTransport())});
  const connected=await runtime.connect({type:'tcp',host:'127.0.0.1',port:502,timeoutMs:250,retries:0});
  assert.equal(connected.connected,true);

  const out=await runtime.read({unitId:1,functionCode:3,address:0,quantity:1,retries:0});
  assert.equal(out.ok,true);
  assert.deepEqual(out.rows.map(row=>row.value),[321]);
  assert.equal(out.attempts,2);
  assert.equal(transport.opens,2,'initial open plus one transport recovery');
  assert.equal(transport.sent.length,2);
  assert.equal(out.stats.retryAttempts,1);
  assert.equal(out.stats.transportRecoveries,1);
  assert.equal(out.stats.errors,0);
  await runtime.disconnect();
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
