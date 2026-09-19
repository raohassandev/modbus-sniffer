'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {DiscoveryEngineeringService}=require('../src/discoveryEngineering');

class FakeMaster extends EventEmitter{
  constructor(){super();this.calls=[];this.connected=true;this.config={type:'tcp',host:'127.0.0.1',port:502};}
  status(){return {connected:this.connected,config:this.config};}
  async read(input){
    this.calls.push({kind:'read',...input});
    if(input.unitId===2)throw Object.assign(new Error('timeout'),{code:'TIMEOUT'});
    return {rttMs:5,rows:Array.from({length:input.quantity},(_,i)=>({address:input.address+i,value:100+input.address+i,rawValue:100+input.address+i,reference:String(40001+input.address+i)}))};
  }
  async advanced(input){
    this.calls.push({kind:'advanced',...input});
    if(input.functionCode===7)throw Object.assign(new Error('illegal function'),{code:'MODBUS_EXCEPTION',details:{exceptionCode:1,rttMs:3}});
    return {rttMs:4,decoded:{functionCode:input.functionCode}};
  }
}

test('engineering discovery unit/range scans reuse connected Master',async()=>{
  const master=new FakeMaster(),svc=new DiscoveryEngineeringService({masterRuntime:master});
  const units=await svc.scanUnits({unitStart:1,unitEnd:3,functionCode:3,address:0,quantity:1,interRequestMs:0});
  assert.equal(units.result.results.length,3);
  assert.equal(units.result.responding,2);
  assert.equal(units.result.results[1].responded,false);

  const range=await svc.scanRange({unitId:1,functionCode:3,addressStart:0,addressEnd:5,chunk:2,interRequestMs:0});
  assert.equal(range.result.points.length,6);
  assert.equal(range.result.blocks.length,3);
  assert.equal(range.result.interpretations.length>0,true);
  const monitor=svc.monitorDefinition(range.runId);
  assert.deepEqual({unitId:monitor.unitId,functionCode:monitor.functionCode,address:monitor.address,quantity:monitor.quantity},{unitId:1,functionCode:3,address:0,quantity:6});
  const simulator=svc.simulatorDefinition(range.runId);
  assert.equal(simulator.area,'holdingRegisters');
  assert.deepEqual(simulator.values,[100,101,102,103,104,105]);
});

test('engineering discovery function and quantity probes classify outcomes',async()=>{
  const master=new FakeMaster(),svc=new DiscoveryEngineeringService({masterRuntime:master});
  const probe=await svc.probeFunctions({unitId:1,address:0,functionCodes:[3,7,43],interRequestMs:0});
  assert.equal(probe.result.results.find(x=>x.functionCode===3).supported,true);
  assert.equal(probe.result.results.find(x=>x.functionCode===7).supported,false);
  assert.equal(probe.result.results.find(x=>x.functionCode===43).supported,true);

  const quantity=await svc.probeQuantities({unitId:1,functionCode:3,address:0,quantities:[1,2,4],interRequestMs:0});
  assert.equal(quantity.result.maxWorkingQuantity,4);
});

test('engineering discovery enforces serial Unit ID limit before scanning',async()=>{
  const master=new FakeMaster(),svc=new DiscoveryEngineeringService({masterRuntime:master});
  master.config={type:'rtu',path:'COM1'};
  await assert.rejects(()=>svc.scanRange({unitId:248,functionCode:3,addressStart:0,addressEnd:1,interRequestMs:0}),e=>e?.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>svc.probeQuantities({unitId:248,functionCode:3,address:0,quantities:[1],interRequestMs:0}),e=>e?.code==='INVALID_ARGUMENT');
  master.config={type:'tcp',host:'127.0.0.1',port:502};
  const range=await svc.scanRange({unitId:255,functionCode:3,addressStart:0,addressEnd:0,chunk:1,interRequestMs:0});
  assert.equal(range.result.unitId,255);
});

test('engineering discovery refuses scans without connected Master and caps range size',async()=>{
  const master=new FakeMaster(),svc=new DiscoveryEngineeringService({masterRuntime:master});
  master.connected=false;
  await assert.rejects(()=>svc.scanUnits({}),e=>e?.code==='MASTER_NOT_CONNECTED');
  master.connected=true;
  await assert.rejects(()=>svc.scanRange({unitId:1,functionCode:3,addressStart:0,addressEnd:5000}),e=>e?.code==='SCAN_TOO_LARGE');
});

test('Discovery engineering browser panel loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'public/discovery-engineering-v7.js'),'utf8');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  new vm.Script(ui,{filename:'discovery-engineering-v7.js'});
  assert.match(ui,/Unit Scan/);
  assert.match(ui,/Function Probe/);
  assert.match(ui,/adopt-simulator/);
  assert.match(loader,/discovery-engineering-v7\.js/);
});
