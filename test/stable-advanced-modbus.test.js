'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { MasterRuntime, normalizeAdvancedRequest }=require('../src/master/masterRuntime');
const { protocol }=require('../src/modbusCore');

test('advanced Master functions interoperate with built-in TCP Slave',async t=>{
  const slave=new SlaveRuntime();
  const master=new MasterRuntime();
  t.after(async()=>{await master.disconnect();await slave.shutdown();});

  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  slave.seedFileRecords({unitId:1,records:[{fileNumber:2,recordNumber:10,values:[111,222,333]}]});
  slave.seedFifo({unitId:1,address:50,values:[7,8,9]});
  await master.connect({type:'tcp',host:'127.0.0.1',port:started.listenAddress.port,timeoutMs:1000});

  const deviceId=await master.advanced({unitId:1,functionCode:43,readDeviceIdCode:1,objectId:0});
  assert.equal(deviceId.ok,true);
  assert.equal(deviceId.decoded.functionCode,protocol.FC.ENCAPSULATED_INTERFACE);
  assert.ok(Array.isArray(deviceId.decoded.objects));
  assert.ok(deviceId.decoded.objects.length>=3);

  const fileRead=await master.advanced({
    unitId:1,functionCode:20,
    records:[{fileNumber:2,recordNumber:10,recordLength:3}]
  });
  assert.deepEqual(fileRead.decoded.records[0].values,[111,222,333]);

  const fifo=await master.advanced({unitId:1,functionCode:24,address:50});
  assert.deepEqual(fifo.decoded.values,[7,8,9]);

  const fileWrite=await master.write({
    unitId:1,functionCode:21,
    records:[{fileNumber:2,recordNumber:10,values:[444,555,666]}],
    confirmation:{confirmed:true,bulk:true},
    readBack:true,
    comment:'FC21 loopback'
  });
  assert.equal(fileWrite.ok,true);
  assert.equal(fileWrite.verification?.matched,true);
  assert.equal(master.status().writeState,'LOCKED');

  const fileReadAfter=await master.advanced({
    unitId:1,functionCode:20,
    records:[{fileNumber:2,recordNumber:10,recordLength:3}]
  });
  assert.deepEqual(fileReadAfter.decoded.records[0].values,[444,555,666]);

  const stats=master.status().stats;
  assert.ok(stats.advancedOperations>=4);
  assert.ok(master.writeAuditEntries({limit:10}).some(row=>row.functionCode===21&&row.verification?.matched===true));
});

test('serial diagnostic request builder enforces transport and LAB boundaries',()=>{
  const fc07=normalizeAdvancedRequest({unitId:1,functionCode:7},'rtu');
  assert.equal(fc07.pdu[0],7);

  const fc08=normalizeAdvancedRequest({unitId:1,functionCode:8,subFunction:0,data:0x1234},'ascii');
  assert.equal(fc08.pdu[0],8);
  assert.equal(protocol.decodeDiagnosticsRequest(fc08.pdu).data,0x1234);

  assert.throws(
    ()=>normalizeAdvancedRequest({unitId:1,functionCode:8,subFunction:10,data:0},'rtu'),
    error=>error?.code==='LAB_CONFIRMATION_REQUIRED'
  );
  const cleared=normalizeAdvancedRequest({unitId:1,functionCode:8,subFunction:10,data:0,labConfirmed:true},'rtu');
  assert.equal(protocol.decodeDiagnosticsRequest(cleared.pdu).subFunction,10);

  for(const fc of [7,8,11,12,17]){
    assert.throws(
      ()=>normalizeAdvancedRequest({unitId:1,functionCode:fc},'tcp'),
      error=>error?.code==='FUNCTION_NOT_APPLICABLE'
    );
  }
});
