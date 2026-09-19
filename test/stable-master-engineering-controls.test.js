'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {MasterRuntime,normalizeConnectionConfig,normalizeReadRequest}=require('../src/master/masterRuntime');

test('Master engineering connection config persists retries spacing and RS485 RTS',()=>{
  const cfg=normalizeConnectionConfig({type:'rtu',path:'COM9',baudRate:115200,parity:'even',dataBits:8,stopBits:1,timeoutMs:700,retries:2,retryDelayMs:40,interRequestDelayMs:15,rtsTxMode:'high-during-tx',rtsSettleMs:3});
  assert.equal(cfg.retries,2);assert.equal(cfg.retryDelayMs,40);assert.equal(cfg.interRequestDelayMs,15);
  assert.equal(cfg.rtsTxMode,'high-during-tx');assert.equal(cfg.rtsSettleMs,3);
  assert.equal(normalizeReadRequest({unitId:255,functionCode:3,address:0,quantity:1},'tcp').unitId,255);
  assert.throws(()=>normalizeReadRequest({unitId:248,functionCode:3,address:0,quantity:1},'rtu'));
});

test('Master read retries transient timeout and reports actual attempts',async()=>{
  const runtime=new MasterRuntime();
  runtime.config={type:'tcp',timeoutMs:100,retries:1,retryDelayMs:0,interRequestDelayMs:0};
  runtime.connectionId='fake';
  let calls=0;
  runtime.engine={request:async()=>{calls++;if(calls===1)throw Object.assign(new Error('timeout'),{code:'TIMEOUT'});return {rttMs:4,decoded:{values:[123]},requestRaw:Buffer.from([1]),responseRaw:Buffer.from([2])};}};
  const out=await runtime.read({unitId:1,functionCode:3,address:0,quantity:1});
  assert.equal(out.attempts,2);
  assert.equal(out.rows[0].value,123);
  assert.equal(runtime.stats.txRequests,2);
  assert.equal(runtime.stats.retryAttempts,1);
  assert.equal(runtime.stats.rxResponses,1);
});

test('Master does not retry non-transient Modbus exception',async()=>{
  const runtime=new MasterRuntime();
  runtime.config={type:'tcp',timeoutMs:100,retries:5,retryDelayMs:0,interRequestDelayMs:0};
  runtime.connectionId='fake';
  let calls=0;
  runtime.engine={request:async()=>{calls++;throw Object.assign(new Error('exception'),{code:'MODBUS_EXCEPTION'});}};
  await assert.rejects(()=>runtime.read({unitId:1,functionCode:3,address:0,quantity:1}),e=>e?.code==='MODBUS_EXCEPTION');
  assert.equal(calls,1);
  assert.equal(runtime.stats.retryAttempts,0);
});

test('Master engineering UI and Monitor counter baseline assets parse',()=>{
  const root=path.resolve(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'public/master-v7.js'),'utf8');
  const sessions=fs.readFileSync(path.join(root,'public/master-sessions-v7.js'),'utf8');
  const write=fs.readFileSync(path.join(root,'public/master-write-v7.js'),'utf8');
  new vm.Script(ui,{filename:'master-v7.js'});new vm.Script(sessions,{filename:'master-sessions-v7.js'});new vm.Script(write,{filename:'master-write-v7.js'});
  assert.match(ui,/masterRetries/);assert.match(ui,/masterRtsMode/);
  assert.match(write,/masterOpenTraffic/);
  assert.match(sessions,/ModbusMasterSessionCounters/);assert.match(sessions,/counterBaseline/);
});
