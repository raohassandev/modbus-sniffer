'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {appendCrc}=require('../src/modbus/crc16');
const {decodeFrame}=require('../src/modbus/decoder');
const {FrameExtractor}=require('../src/modbus/frameExtractor');
const {decodeTcpAdu}=require('../src/modbus/tcpParser');
const {AdvancedTransactionTracker}=require('../src/modbus/advancedTransactionTracker');
const {buildPassiveDiscovery}=require('../src/discoveryService');
const {makeDeviceKey}=require('../src/transportIdentity');

const text=s=>[...Buffer.from(s,'utf8')];
function idResponse({slave=1,code=1,conformity=1,more=0,next=0,objects=[]}={}){
  const body=[slave,43,14,code,conformity,more,next,objects.length];
  for(const [id,value] of objects){const b=text(value);body.push(id,b.length,...b);}
  return appendCrc(Buffer.from(body));
}
function tcpAdu(unit,pdu,tid=1){const len=1+pdu.length;return Buffer.from([tid>>8,tid&255,0,0,len>>8,len&255,unit,...pdu]);}

test('FC43 MEI 0x0E request and response decode standard device ID objects',()=>{
  const req=appendCrc(Buffer.from([1,43,14,1,0])),dr=decodeFrame(req);
  assert.equal(dr.kind,'request');assert.equal(dr.functionCode,43);assert.equal(dr.meiType,14);assert.equal(dr.readDeviceIdCode,1);assert.equal(dr.objectId,0);

  const rsp=idResponse({objects:[[0,'ACME'],[1,'MTR-1'],[2,'1.2.3']]}),d=decodeFrame(rsp);
  assert.equal(d.kind,'response');assert.equal(d.payloadValid,true);assert.equal(d.identification.vendorName,'ACME');assert.equal(d.identification.productCode,'MTR-1');assert.equal(d.identification.revision,'1.2.3');assert.equal(d.numberOfObjects,3);
});

test('RTU frame extractor emits fragmented variable-length FC43 response as one frame',()=>{
  const rsp=idResponse({objects:[[0,'Vendor'],[4,'Energy Meter'],[5,'EM500']]}),x=new FrameExtractor({baudRate:9600}),seen=[],noise=[];
  x.on('frame',b=>seen.push(b));x.on('noise',b=>noise.push(b));
  x.push(rsp.subarray(0,6),100);x.push(rsp.subarray(6,13),101);x.push(rsp.subarray(13),102);x.flush();
  assert.equal(seen.length,1);assert.deepEqual(seen[0],rsp);assert.equal(noise.reduce((n,b)=>n+b.length,0),0);assert.equal(decodeFrame(seen[0]).identification.modelName,'EM500');
});

test('Modbus TCP FC43 uses the same device identification decoder',()=>{
  const pdu=Buffer.from([43,14,1,1,0,0,2,0,4,...text('ACME'),5,5,...text('X1000')]);
  const d=decodeTcpAdu(tcpAdu(7,pdu,55)).decoded;
  assert.equal(d.transport,'TCP');assert.equal(d.unitId,7);assert.equal(d.transactionId,55);assert.equal(d.identification.vendorName,'ACME');assert.equal(d.identification.modelName,'X1000');
});

test('FC43 request-response pair is matched by RTU transaction tracker',()=>{
  const t=new AdvancedTransactionTracker(),req=decodeFrame(appendCrc(Buffer.from([3,43,14,1,0]))),rsp=decodeFrame(idResponse({slave:3,objects:[[0,'Vendor']]}));
  assert.equal(t.process(req,1000).direction,'REQ');const tx=t.process(rsp,1035);assert.equal(tx.direction,'RSP');assert.equal(tx.rttMs,35);assert.equal(tx.request.objectId,0);
});

test('passive discovery groups channels devices blocks and segmented FC43 identity without transmitting',()=>{
  const channelId='rtu:sn-test',deviceKey=makeDeviceKey(channelId,1);
  const seg1={timestamp:1000,direction:'RSP',channelId,deviceKey,unitId:1,slaveId:1,functionCode:43,decoded:{functionCode:43,meiType:14,readDeviceIdCode:2,conformityLevel:2,moreFollows:true,nextObjectId:2,objects:[{objectId:0,value:'ACME'},{objectId:1,value:'MTR'}]}};
  const seg2={timestamp:1010,direction:'RSP',channelId,deviceKey,unitId:1,slaveId:1,functionCode:43,decoded:{functionCode:43,meiType:14,readDeviceIdCode:2,conformityLevel:2,moreFollows:false,nextObjectId:0,objects:[{objectId:2,value:'2.0'},{objectId:5,value:'EM500'}]}};
  const state={
    getChannels:()=>[{channelId,transport:'RTU',name:'RTU COM7',endpoint:'COM7'}],
    getDevices:()=>[{channelId,deviceKey,transport:'RTU',unitId:1,slaveId:1,confirmed:true,status:'online',responses:10,requests:10,registerCount:4,pollGroupCount:1,lastResponseAt:1010}],
    getPollGroups:()=>[{channelId,deviceKey,unitId:1,slaveId:1,functionCode:3,startAddress:1000,endAddress:1003,quantity:4,requests:10,responses:10,timeouts:0,medianIntervalMs:1000,jitterPct:1}],
    getRegisters:()=>[],getTransactions:()=>[seg1,seg2]
  };
  const d=buildPassiveDiscovery(state);assert.equal(d.transmit,false);assert.equal(d.summary.channels,1);assert.equal(d.summary.confirmedDevices,1);const dev=d.channels[0].devices[0];assert.equal(dev.identification.vendorName,'ACME');assert.equal(dev.identification.modelName,'EM500');assert.equal(dev.identification.segmented,true);assert.equal(dev.identification.terminalSegmentObserved,true);assert.deepEqual(dev.functionCodes,[3,43]);assert.equal(dev.registerBlocks[0].startAddress,1000);
});

test('passive discovery flags conflicting Device ID values as suspicion, not certainty',()=>{
  const channelId='tcp:proxy:x',deviceKey=makeDeviceKey(channelId,2),base={direction:'RSP',channelId,deviceKey,unitId:2,slaveId:2,functionCode:43};
  const txs=[{...base,timestamp:1,decoded:{functionCode:43,meiType:14,objects:[{objectId:0,value:'Vendor-A'}],moreFollows:false}},{...base,timestamp:2,decoded:{functionCode:43,meiType:14,objects:[{objectId:0,value:'Vendor-B'}],moreFollows:false}}];
  const state={getChannels:()=>[{channelId,transport:'TCP',endpoint:'10.0.0.2:502'}],getDevices:()=>[{channelId,deviceKey,transport:'TCP',unitId:2,confirmed:true,responses:2}],getPollGroups:()=>[],getRegisters:()=>[],getTransactions:()=>txs};
  const dev=buildPassiveDiscovery(state).channels[0].devices[0];assert.equal(dev.suspectedConflict,true);assert.equal(dev.identification.conflicts[0].values.length,2);
});
