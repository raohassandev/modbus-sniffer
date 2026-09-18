'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { scanTcpDeviceIds }=require('../src/activeDiscovery');
const { ActiveDiscoveryManager }=require('../src/activeDiscoveryManager');
const { EvidenceHub }=require('../src/evidence/evidenceHub');

test('TCP active Discovery emits exact FC43 request/response evidence against built-in Slave',async t=>{
  const slave=new SlaveRuntime();
  t.after(()=>slave.shutdown());

  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  const packets=[];

  const result=await scanTcpDeviceIds({
    host:'127.0.0.1',
    port:started.listenAddress.port,
    unitStart:1,
    unitEnd:1,
    timeoutMs:750,
    interRequestMs:20,
    readDeviceIdCode:1,
    maxSegments:4,
    onEvidence:event=>packets.push(event),
  });

  assert.equal(result.results.length,1);
  assert.equal(result.results[0].responded,true);
  assert.equal(result.results[0].identificationSupported,true);
  assert.ok(result.results[0].objects.length>=3);

  const tx=packets.find(event=>event.type==='traffic.tx');
  const rx=packets.find(event=>event.type==='traffic.rx');
  assert.ok(tx,'discovery Tx evidence missing');
  assert.ok(rx,'discovery Rx evidence missing');
  assert.equal(tx.unitId,1);
  assert.equal(tx.functionCode,43);
  assert.equal(tx.details.framing,'tcp');
  assert.match(tx.rawHex,/^[0-9A-F]+$/);
  assert.equal(rx.unitId,1);
  assert.equal(rx.functionCode,43);
  assert.ok(Number(rx.details.rttMs)>=0);
  assert.match(rx.rawHex,/^[0-9A-F]+$/);

  const hub=new EvidenceHub({maxRows:100});
  const txRow=hub.ingest(tx,{sourceType:'Discovery'});
  const rxRow=hub.ingest(rx,{sourceType:'Discovery'});
  assert.equal(txRow.direction,'REQ');
  assert.equal(rxRow.direction,'RSP');
  assert.equal(txRow.sourceType,'Discovery');
  assert.equal(rxRow.transport,'TCP');
});

test('ActiveDiscoveryManager relays raw evidence with the active jobId',async()=>{
  const emitted=[];
  const fakeScan=async({onEvidence,onProgress})=>{
    onEvidence?.({
      timestamp:100,
      type:'traffic.tx',
      source:'active-discovery',
      ownerMode:'discovery',
      connectionId:'discovery:tcp:test:502',
      unitId:3,
      functionCode:43,
      rawHex:'000100000005032B0E0100',
      details:{framing:'tcp',transactionId:1},
    });
    const result={unitId:3,responded:true,identificationSupported:true,objects:[{objectId:0,value:'Vendor'}]};
    onProgress?.({transport:'TCP',unitId:3,current:1,total:1,result});
    return {transport:'TCP',results:[result],responding:[result],identified:[result]};
  };
  const manager=new ActiveDiscoveryManager({scanTcp:fakeScan,scanRtu:fakeScan});
  manager.on('evidence',event=>emitted.push(event));
  const started=manager.start({transport:'TCP',host:'example.test',unitStart:3,unitEnd:3});
  assert.ok(started.jobId);
  await manager.promise;
  assert.equal(emitted.length,1);
  assert.equal(emitted[0].details.jobId,started.jobId);
  assert.equal(emitted[0].unitId,3);
  assert.equal(emitted[0].functionCode,43);
});
