'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SlaveRuntime,normalizeConfig,framingForType,publicConfig}=require('../src/slave/slaveRuntime');

test('advanced Slave transport normalization maps wire framing correctly',()=>{
  assert.equal(framingForType('tcp'),'tcp');
  assert.equal(framingForType('tls'),'tcp');
  assert.equal(framingForType('udp'),'tcp');
  assert.equal(framingForType('rtu-tcp'),'rtu');
  assert.equal(framingForType('rtu-udp'),'rtu');
  assert.equal(framingForType('ascii-tcp'),'ascii');
  assert.equal(framingForType('ascii-udp'),'ascii');
  assert.equal(normalizeConfig({type:'udp',host:'127.0.0.1',port:0}).maxPeers,256);
  assert.equal(normalizeConfig({type:'tls',host:'127.0.0.1',cert:'CERT',key:'KEY'}).port,802);
  assert.throws(()=>normalizeConfig({type:'tls',host:'127.0.0.1'}),e=>e?.code==='TLS_MATERIAL_REQUIRED');
});

test('Slave LAB requires explicit confirmation and supports deterministic fault policy',async t=>{
  const runtime=new SlaveRuntime();
  t.after(()=>runtime.shutdown());
  await runtime.configure({type:'tcp',host:'127.0.0.1',port:0});
  assert.throws(()=>runtime.armLab({responseDelayMs:10},{confirmed:false}),e=>e?.code==='LAB_CONFIRMATION_REQUIRED');
  const lab=runtime.armLab({responseDelayMs:10,forceExceptionCode:2,forceExceptionEveryN:1},{confirmed:true});
  assert.equal(lab.enabled,true);
  assert.equal(lab.policy.responseDelayMs,10);
  assert.equal(lab.policy.forceExceptionCode,2);
  assert.equal(runtime.disarmLab().enabled,false);
});

test('Slave generators are bounded behind LAB confirmation',async t=>{
  const runtime=new SlaveRuntime();
  t.after(()=>runtime.shutdown());
  await runtime.configure({type:'tcp',host:'127.0.0.1',port:0});
  assert.throws(()=>runtime.saveGenerator({generatorId:'g1',unitId:1,area:'holdingRegisters',address:0,quantity:1,kind:'counter',intervalMs:100,params:{start:0,step:1}}),e=>e?.code==='LAB_CONFIRMATION_REQUIRED');
  const gen=runtime.saveGenerator({generatorId:'g1',unitId:1,area:'holdingRegisters',address:0,quantity:1,kind:'counter',intervalMs:100,params:{start:0,step:1},labConfirmed:true});
  assert.equal(gen.generatorId,'g1');
  assert.equal(runtime.listGenerators().length,1);
  assert.equal(runtime.removeGenerator('g1'),true);
});

test('Slave public status/events/export never expose TLS private key',async t=>{
  const runtime=new SlaveRuntime();
  t.after(()=>runtime.shutdown());
  await runtime.configure({type:'tls',host:'127.0.0.1',port:0,cert:'CERT',key:'TOP-SECRET'});
  const status=runtime.status();
  assert.equal(status.config.tls.key,null);
  assert.equal(status.config.tls.keyConfigured,true);
  assert.doesNotMatch(JSON.stringify(status),/TOP-SECRET/);
  const exported=runtime.exportConfig();
  assert.equal(exported.config.tls.key,null);
  assert.equal(exported.config.tls.keyConfigured,true);
  assert.equal(exported.config.tls.credentialsRequired,true);
  assert.doesNotMatch(JSON.stringify(exported),/TOP-SECRET/);
  assert.equal(publicConfig(runtime.config).tls.key,null);
});

test('advanced Slave browser assets load and parse',()=>{
  const root=path.resolve(__dirname,'..');
  const base=fs.readFileSync(path.join(root,'public/slave-v7.js'),'utf8');
  const lab=fs.readFileSync(path.join(root,'public/slave-lab-v7.js'),'utf8');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  new vm.Script(base,{filename:'slave-v7.js'});new vm.Script(lab,{filename:'slave-lab-v7.js'});
  assert.match(base,/RTU\/TCP/);assert.match(base,/ASCII\/UDP/);assert.match(base,/Server Certificate PEM/);
  assert.match(lab,/Fault \/ Exception Policy/);assert.match(lab,/Dynamic Value Generator/);assert.match(lab,/labConfirmed/);
  assert.match(loader,/slave-lab-v7\.js/);
});
