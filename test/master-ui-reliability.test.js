'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'public/master-v7.js'),'utf8');
const runtime=fs.readFileSync(path.join(root,'src/master/masterRuntime.js'),'utf8');
const routes=fs.readFileSync(path.join(root,'src/master/masterRoutes.js'),'utf8');

test('Master UI reliability source parses and carries structured backend guidance',()=>{
  assert.doesNotThrow(()=>new vm.Script(ui,{filename:'master-v7.js'}));
  assert.match(ui,/error\.category = body\.category/);
  assert.match(ui,/error\.retryable = Boolean\(body\.retryable\)/);
  assert.match(ui,/error\.hint = body\.hint/);
  assert.match(ui,/function describeMasterError/);
  assert.match(ui,/MODBUS_EXCEPTION/);
  assert.match(ui,/TIMEOUT/);
});

test('Master read failure reconciles live backend connection state before continuing polling',()=>{
  const start=ui.indexOf('async function readOnce');
  const end=ui.indexOf('function scheduleNextPoll',start);
  const block=ui.slice(start,end);
  assert.match(block,/await request\('\/api\/master\/status'\)/);
  assert.match(block,/setConnected\(Boolean\(status\.connected\), status\)/);
  assert.match(block,/if \(status && !status\.connected\) stopPolling\(\)/);
  assert.match(block,/describeMasterError\(error\)/);
});

test('Master UI restores the transport mode from live backend status after reload',()=>{
  const start=ui.indexOf('async function refreshStatus');
  const end=ui.indexOf('async function connect',start);
  const section=ui.slice(start,end);
  assert.match(section,/setType\(status\.config\.type \|\| app\.type\)/);
});

test('Master TCP UI permits the Modbus TCP Unit-ID range without widening serial range',()=>{
  const start=ui.indexOf('function setType');
  const end=ui.indexOf("masterNav.addEventListener",start);
  const block=ui.slice(start,end);
  assert.match(block,/masterUnitId/);
  assert.match(block,/type === 'tcp' \? '255' : '247'/);
});

test('Master runtime performs one safe TCP transport recovery independent of user retry count',()=>{
  assert.match(runtime,/transportRecoveries: 0/);
  assert.match(runtime,/reconnectable = new Set/);
  assert.match(runtime,/recoveryRetriesUsed < 1/);
  assert.match(runtime,/await this\.engine\.open\(\)/);
  assert.match(runtime,/this\.stats\.transportRecoveries \+= 1/);
});

test('Master API no longer represents Modbus exceptions/timeouts as gateway 502/504 errors',()=>{
  assert.match(routes,/code === 'TIMEOUT'\) return 408/);
  assert.match(routes,/code === 'MODBUS_EXCEPTION'\) return 422/);
  assert.match(routes,/category: guidance\.category/);
  assert.match(routes,/retryable: guidance\.retryable/);
  assert.match(routes,/hint: guidance\.hint/);
  assert.doesNotMatch(routes,/TIMEOUT'\]\) return 504/);
  assert.doesNotMatch(routes,/MODBUS_EXCEPTION'\]\) return 502/);
});
