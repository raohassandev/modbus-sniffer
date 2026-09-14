'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('net');
const {decodeFrame}=require('../src/modbus/decoder');
const {buildTcpDeviceIdRequest,buildRtuDeviceIdRequest,readIdentity,scanTcpDeviceIds,scanRtuDeviceIds}=require('../src/activeDiscovery');
const {hasValidCrc}=require('../src/modbus/crc16');

const text=s=>[...Buffer.from(s,'utf8')];
function tcpAdu(tid,unit,pdu){const len=1+pdu.length;return Buffer.from([tid>>8,tid&255,0,0,len>>8,len&255,unit,...pdu]);}

test('active discovery request builders emit FC43/MEI 0x0E only',()=>{
  const tcp=buildTcpDeviceIdRequest(7,3,1,0);assert.equal(tcp[7],43);assert.equal(tcp[8],14);assert.equal(tcp[9],1);assert.equal(tcp[10],0);
  const rtu=buildRtuDeviceIdRequest(3,1,0);assert.equal(rtu[0],3);assert.equal(rtu[1],43);assert.equal(rtu[2],14);assert.equal(hasValidCrc(rtu),true);
  assert.ok(![5,6,15,16,22].includes(tcp[7]));assert.ok(![5,6,15,16,22].includes(rtu[1]));
});

test('readIdentity follows segmented FC43 responses and merges objects',async()=>{
  let calls=0;
  const query=async(_u,_c,obj)=>{calls++;if(obj===0)return{rttMs:5,frame:{decoded:{functionCode:43,meiType:14,readDeviceIdCode:2,conformityLevel:2,moreFollows:true,nextObjectId:2,objects:[{objectId:0,value:'ACME'},{objectId:1,value:'MTR'}]}}};return{rttMs:6,frame:{decoded:{functionCode:43,meiType:14,readDeviceIdCode:2,conformityLevel:2,moreFollows:false,nextObjectId:0,objects:[{objectId:2,value:'2.1'},{objectId:5,value:'EM500'}]}}};};
  const r=await readIdentity(query,4,{readDeviceIdCode:2,maxSegments:4});assert.equal(calls,2);assert.equal(r.responded,true);assert.equal(r.identification.vendorName,'ACME');assert.equal(r.identification.modelName,'EM500');assert.equal(r.segments.length,2);
});

test('TCP active scan is sequential, read-only, and distinguishes unsupported vs silent units',async()=>{
  let buffer=Buffer.alloc(0),requests=[];
  const server=net.createServer(socket=>socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=7){const len=buffer.readUInt16BE(4),total=6+len;if(buffer.length<total)break;const req=Buffer.from(buffer.subarray(0,total));buffer=buffer.subarray(total);requests.push(req);const tid=req.readUInt16BE(0),unit=req[6];assert.equal(req[7],43);assert.equal(req[8],14);
    if(unit===1)socket.write(tcpAdu(tid,unit,[0xAB,1]));
    if(unit===2)socket.write(tcpAdu(tid,unit,[43,14,1,1,0,0,2,0,4,...text('ACME'),5,5,...text('X1000')]));
  }}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  try{const scan=await scanTcpDeviceIds({host:'127.0.0.1',port,unitStart:1,unitEnd:3,timeoutMs:120,interRequestMs:20});assert.equal(scan.readOnly,true);assert.equal(scan.responding.length,2);assert.equal(scan.identified.length,1);assert.equal(scan.results[0].identificationSupported,false);assert.equal(scan.results[1].identification.modelName,'X1000');assert.equal(scan.results[2].responded,false);assert.equal(requests.length,3);assert.ok(requests.every(r=>r[7]===43));}
  finally{await new Promise(resolve=>server.close(resolve));}
});

test('RTU active discovery is blocked before serial access unless both safety confirmations are true',async()=>{
  await assert.rejects(scanRtuDeviceIds({port:'COM_DOES_NOT_EXIST',unitStart:1,unitEnd:1}),e=>e.code==='RTU_DISCOVERY_CONFIRMATION_REQUIRED');
  await assert.rejects(scanRtuDeviceIds({port:'COM_DOES_NOT_EXIST',unitStart:1,unitEnd:1,maintenanceConfirmed:true}),e=>e.code==='RTU_DISCOVERY_CONFIRMATION_REQUIRED');
});

test('FC43 RTU request remains a request under the normal decoder',()=>{
  const d=decodeFrame(buildRtuDeviceIdRequest(10,1,0));assert.equal(d.kind,'request');assert.equal(d.functionCode,43);assert.equal(d.objectId,0);
});
