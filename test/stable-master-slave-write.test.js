'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { MasterRuntime }=require('../src/master/masterRuntime');

test('stable Master guarded writes interoperate with stable Slave and relock',async t=>{
  const slave=new SlaveRuntime();
  const master=new MasterRuntime();
  t.after(async()=>{await master.disconnect();await slave.shutdown();});

  const slaveStatus=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  const port=slaveStatus.listenAddress.port;
  slave.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[100,200,300,400]});

  const connected=await master.connect({type:'tcp',host:'127.0.0.1',port,timeoutMs:1000});
  assert.equal(connected.connected,true);
  assert.equal(connected.writeState,'LOCKED');

  const single=await master.write({
    unitId:1,functionCode:6,address:1,value:777,
    confirmation:{confirmed:true},readBack:true,comment:'loopback FC06'
  });
  assert.equal(single.ok,true);
  assert.equal(single.verification?.matched,true);
  assert.equal(master.status().writeState,'LOCKED');
  assert.deepEqual(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:4}).values,[100,777,300,400]);

  await assert.rejects(
    master.write({unitId:1,functionCode:16,address:2,values:[11,22],confirmation:{confirmed:true},readBack:true}),
    error=>error?.code==='BULK_CONFIRMATION_REQUIRED'
  );
  assert.equal(master.status().writeState,'LOCKED');

  const bulk=await master.write({
    unitId:1,functionCode:16,address:2,values:[11,22],
    confirmation:{confirmed:true,bulk:true},readBack:true,comment:'loopback FC16'
  });
  assert.equal(bulk.verification?.matched,true);
  assert.deepEqual(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:4}).values,[100,777,11,22]);

  const mask=await master.write({
    unitId:1,functionCode:22,address:0,andMask:0xFF00,orMask:0x0005,
    confirmation:{confirmed:true},readBack:true
  });
  assert.equal(mask.verification?.matched,true);
  assert.equal(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:1}).values[0],5);

  const rw=await master.write({
    unitId:1,functionCode:23,address:2,readAddress:0,readQuantity:2,writeAddress:2,values:[33,44],
    confirmation:{confirmed:true,bulk:true},readBack:true
  });
  assert.equal(rw.verification?.matched,true);
  assert.deepEqual(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:4}).values,[5,777,33,44]);

  const audit=master.writeAuditEntries({limit:20});
  assert.ok(audit.length>=4);
  assert.ok(audit.some(row=>row.functionCode===6&&row.result==='success'&&row.verification?.matched===true));
  assert.ok(audit.some(row=>row.functionCode===16&&row.result==='failed'&&row.preflightRejected===true&&row.transmitted===false));
  assert.ok(audit.some(row=>row.functionCode===22&&row.result==='success'));
  assert.ok(audit.some(row=>row.functionCode===23&&row.result==='success'));

  const reset=master.resetStats();
  assert.equal(reset.stats.txRequests,0);
  assert.equal(reset.stats.errors,0);
  assert.equal(reset.stats.writeOperations,0);
});

test('guarded write browser extension loads after register mapping and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/master-write-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/master-write-v7.css'),'utf8');
  new vm.Script(ui,{filename:'master-write-v7.js'});

  const mapping=loader.indexOf("registerMeta.src='/master-register-meta-v7.js");
  const write=loader.indexOf("masterWrite.src='/master-write-v7.js",mapping);
  assert.ok(mapping>=0&&write>mapping,'guarded write UI must load after register mapping');
  assert.match(loader,/master-write-v7\.css/);
  assert.match(ui,/FC22 — Mask Write Register/);
  assert.match(ui,/FC23 — Read\/Write Multiple Registers/);
  assert.match(ui,/\/api\/master\/write/);
  assert.match(ui,/\/api\/master\/write-audit/);
  assert.match(ui,/\/api\/master\/stats\/reset/);
  assert.match(ui,/BULK|bulk write/i);
  assert.match(ui,/broadcast/i);
  assert.match(css,/\.master-write-dialog/);
});
