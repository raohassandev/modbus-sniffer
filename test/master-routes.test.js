'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { installMasterRoutes, errorStatus, errorGuidance, jsonSafeDetails } = require('../src/master/masterRoutes');

async function withServer({ state, runtime, monitorStore = null }, fn) {
  const app = express();
  app.use(express.json());
  installMasterRoutes({ app, state, runtime, monitorStore });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function fakeRuntime() {
  const calls = [];
  return {
    calls,
    status: () => ({ connected:false, stats:{ txRequests:0, rxResponses:0, errors:0, timeouts:0 } }),
    connect: async config => { calls.push(['connect', config]); return { connected:true, config, stats:{} }; },
    disconnect: async () => { calls.push(['disconnect']); return { connected:false, stats:{} }; },
    read: async request => { calls.push(['read', request]); return { ok:true, request, rows:[], stats:{} }; },
  };
}

test('Master route contract exposes status, connect, read and disconnect', async () => {
  const runtime = fakeRuntime();
  const state = { getStatus: () => ({ connection:{ status:'idle' }, config:{} }) };
  await withServer({ state, runtime }, async base => {
    let response = await fetch(`${base}/api/master/status`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).connected, false);

    response = await fetch(`${base}/api/master/connect`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ type:'tcp', host:'127.0.0.1', port:502, timeoutMs:1000 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).connected, true);

    response = await fetch(`${base}/api/master/read`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ unitId:1, functionCode:3, address:0, quantity:10 }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);

    response = await fetch(`${base}/api/master/disconnect`, { method:'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(runtime.calls.map(call => call[0]), ['connect', 'read', 'disconnect']);
  });
});

test('Master route contract persists Monitor Sessions through the injected durable store', async () => {
  const runtime = fakeRuntime();
  const state = { getStatus: () => ({ connection:{ status:'idle' }, config:{} }) };
  let saved={version:1,activeId:null,sessions:[]};
  const monitorStore={
    load:()=>saved,
    save:value=>{saved=value;return saved;}
  };
  await withServer({ state, runtime, monitorStore }, async base => {
    let response=await fetch(`${base}/api/master/monitor-sessions`);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),saved);

    const payload={version:1,activeId:'m1',sessions:[{id:'m1',name:'Meter'}]};
    response=await fetch(`${base}/api/master/monitor-sessions`,{
      method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),payload);

  });
});

test('Master serial connect refuses silent takeover when passive Analyzer owns the same COM port', async () => {
  const runtime = fakeRuntime();
  const state = {
    getStatus: () => ({
      connection:{ status:'open' },
      config:{ port:'COM5', baudRate:9600 },
    }),
  };
  await withServer({ state, runtime }, async base => {
    const response = await fetch(`${base}/api/master/connect`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ type:'rtu', path:'COM5', baudRate:9600 }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'PASSIVE_CAPTURE_ACTIVE');
    assert.equal(body.details.port, 'COM5');
    assert.equal(body.details.requiresConfirmation, true);
    assert.equal(runtime.calls.length, 0, 'active Master must not open while passive Analyzer owns the same port');
  });
});

test('Master may use a different serial port without disturbing passive Analyzer', async () => {
  const runtime = fakeRuntime();
  const state = {
    getStatus: () => ({ connection:{ status:'open' }, config:{ port:'COM3' } }),
  };
  await withServer({ state, runtime }, async base => {
    const response = await fetch(`${base}/api/master/connect`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({ type:'rtu', path:'COM5', baudRate:9600 }),
    });
    assert.equal(response.status, 200);
    assert.equal(runtime.calls[0][0], 'connect');
    assert.equal(runtime.calls[0][1].path, 'COM5');
  });
});


test('Master route error mapping uses protocol-appropriate HTTP statuses and actionable guidance', () => {
  assert.equal(errorStatus({code:'TIMEOUT'}),408);
  assert.equal(errorStatus({code:'MODBUS_EXCEPTION'}),422);
  assert.equal(errorStatus({code:'CONNECTION_LOST'}),503);
  assert.equal(errorStatus({code:'INVALID_ARGUMENT'}),400);
  const timeout=errorGuidance({code:'TIMEOUT'});
  assert.equal(timeout.retryable,true);
  assert.match(timeout.hint,/Verify Unit ID/);
  const exception=errorGuidance({code:'MODBUS_EXCEPTION',details:{exceptionCode:2}});
  assert.equal(exception.category,'modbus-exception');
  assert.match(exception.hint,/Illegal Data Address/);
  const details=jsonSafeDetails({requestRaw:Buffer.from([0,1,2]),nested:{responseRaw:Buffer.from([3,4])}});
  assert.equal(details.requestRawHex,'000102');
  assert.equal(details.nested.responseRawHex,'0304');
});

test('Master read route returns structured timeout guidance instead of gateway-style 504', async () => {
  const runtime=fakeRuntime();
  runtime.read=async()=>{const e=new Error('No Modbus response within 1000 ms');e.code='TIMEOUT';e.details={timeoutMs:1000,requestRaw:Buffer.from([0,1])};throw e;};
  const state={getStatus:()=>({connection:{status:'idle'},config:{}})};
  await withServer({state,runtime},async base=>{
    const response=await fetch(`${base}/api/master/read`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({unitId:1,functionCode:3,address:0,quantity:1})
    });
    assert.equal(response.status,408);
    const body=await response.json();
    assert.equal(body.code,'TIMEOUT');
    assert.equal(body.category,'timeout');
    assert.equal(body.retryable,true);
    assert.match(body.hint,/Verify Unit ID/);
    assert.equal(body.details.requestRawHex,'0001');
  });
});

test('Master read route returns Modbus exceptions as device-level 422 evidence, not HTTP 502', async () => {
  const runtime=fakeRuntime();
  runtime.read=async()=>{const e=new Error('Modbus exception 2');e.code='MODBUS_EXCEPTION';e.details={exceptionCode:2};throw e;};
  const state={getStatus:()=>({connection:{status:'idle'},config:{}})};
  await withServer({state,runtime},async base=>{
    const response=await fetch(`${base}/api/master/read`,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({unitId:1,functionCode:3,address:9999,quantity:1})
    });
    assert.equal(response.status,422);
    const body=await response.json();
    assert.equal(body.code,'MODBUS_EXCEPTION');
    assert.match(body.hint,/Illegal Data Address/);
  });
});
