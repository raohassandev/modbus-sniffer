'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { MasterRuntime }=require('../src/master/masterRuntime');
const { EvidenceHub, mergeEvidence }=require('../src/evidence/evidenceHub');

test('unified Evidence Hub classifies Master and Slave loopback traffic correctly',async t=>{
  const slave=new SlaveRuntime();
  const master=new MasterRuntime();
  const hub=new EvidenceHub({maxRows:500});

  const onMaster=event=>hub.ingest(event,{sourceType:'Master'});
  const onSlave=event=>hub.ingest(event,{sourceType:'Slave'});
  master.on('event',onMaster);
  slave.on('event',onSlave);

  t.after(async()=>{
    master.off('event',onMaster);
    slave.off('event',onSlave);
    await master.disconnect();
    await slave.shutdown();
  });

  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  slave.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[10,20]});
  await master.connect({type:'tcp',host:'127.0.0.1',port:started.listenAddress.port,timeoutMs:1000});

  const read=await master.read({unitId:1,functionCode:3,address:0,quantity:2});
  assert.deepEqual(read.rows.map(row=>row.rawValue),[10,20]);

  const rows=hub.list({limit:50});
  assert.ok(rows.some(row=>row.sourceType==='Master'&&row.direction==='REQ'&&row.functionCode===3));
  assert.ok(rows.some(row=>row.sourceType==='Master'&&row.direction==='RSP'&&row.functionCode===3));
  assert.ok(rows.some(row=>row.sourceType==='Slave'&&row.direction==='REQ'&&row.functionCode===3));
  assert.ok(rows.some(row=>row.sourceType==='Slave'&&row.direction==='RSP'&&row.functionCode===3));

  const slaveReq=rows.find(row=>row.sourceType==='Slave'&&row.direction==='REQ');
  assert.equal(slaveReq.ownerMode,'slave');
  assert.equal(slaveReq.connectionId!=null,true);
  assert.equal(slaveReq.transport,'TCP');

  const masterOnly=hub.list({sourceType:'Master',limit:50});
  assert.ok(masterOnly.length>=2);
  assert.ok(masterOnly.every(row=>row.sourceType==='Master'));
});

test('Evidence Hub retains bounded annotations separately from packet rows',()=>{
  const hub=new EvidenceHub({maxRows:100});
  const annotation=hub.ingestAnnotation({
    timestamp:1234,
    type:'recipe.step-passed',
    source:'recipe-engine',
    ownerMode:'test',
    details:{stepId:'read-1',type:'read'}
  },{sourceType:'Test Sequence',direction:'TEST'});

  assert.equal(annotation.direction,'TEST');
  assert.equal(annotation.sourceType,'Test Sequence');
  assert.equal(annotation.eventType,'recipe.step-passed');

  for(let i=0;i<150;i++){
    hub.ingestAnnotation({timestamp:2000+i,type:'discovery.unit-result',source:'active-discovery',unitId:(i%247)+1,functionCode:43,details:{transport:'TCP'}},{sourceType:'Discovery',direction:'DISCOVERY'});
  }
  assert.equal(hub.status().rows,100);
  assert.equal(hub.list({sourceType:'Discovery',limit:200}).length,100);
});

test('mergeEvidence orders passive and active rows by timestamp and enforces limit',()=>{
  const passive=[
    {id:1,timestamp:100,sourceType:'Sniffer'},
    {id:2,timestamp:300,sourceType:'Sniffer'},
  ];
  const active=[
    {id:1000000001,timestamp:200,sourceType:'Master'},
    {id:1000000002,timestamp:400,sourceType:'Slave'},
  ];
  const merged=mergeEvidence(passive,active,{limit:3});
  assert.deepEqual(merged.map(row=>row.timestamp),[200,300,400]);
  assert.deepEqual(merged.map(row=>row.sourceType),['Master','Sniffer','Slave']);
});

test('stable unified Traffic extension loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/traffic-evidence-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/traffic-evidence-v7.css'),'utf8');
  const server=fs.readFileSync(path.join(root,'src/platformWebServerV61.js'),'utf8');

  new vm.Script(ui,{filename:'traffic-evidence-v7.js'});
  assert.match(loader,/traffic-evidence-v7\.css/);
  assert.match(loader,/evidence\.src='\/traffic-evidence-v7\.js/);
  assert.match(ui,/All sources/);
  assert.match(ui,/Test Sequence/);
  assert.match(ui,/DISCOVERY/);
  assert.match(server,/new EvidenceHub/);
  assert.match(server,/unifiedTransactions/);
  assert.match(server,/\/api\/evidence\/status/);
  assert.match(server,/sourceType:'Master'/);
  assert.match(server,/sourceType:'Slave'/);
  assert.match(css,/\.evidence-source-badge/);
});
