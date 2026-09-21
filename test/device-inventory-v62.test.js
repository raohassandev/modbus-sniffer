'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {PlatformRuntimeStateV62}=require('../src/platformRuntimeStateV62');
const {buildRtuChannel,buildTcpChannel,makeDeviceKey}=require('../src/transportIdentity');

function requestTx(channel,unitId,address=100){return{direction:'REQ',transport:channel.transport,channel,decoded:{transport:channel.transport,slaveId:unitId,unitId,functionCode:3,functionName:'Read Holding Registers',startAddress:address,quantity:1}};}
function responseTx(channel,unitId,value,address=100,requestTimestamp=Date.now()-20,{matched=true}={}){return{direction:'RSP',matched,transport:channel.transport,channel,decoded:{transport:channel.transport,slaveId:unitId,unitId,functionCode:3,functionName:'Read Holding Registers',registers:[{address,value}]},request:matched?{transport:channel.transport,slaveId:unitId,unitId,functionCode:3,functionName:'Read Holding Registers',startAddress:address,quantity:1,timestamp:requestTimestamp}:null,rttMs:matched?20:null};}

test('request-only Unit/Slave IDs are unconfirmed and are not counted as devices',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildRtuChannel({port:'COM7',identity:{serialNumber:'COUNT-A'},config:{baudRate:9600}}),now=Date.now();
  state.recordFrame(requestTx(channel,5),now,Buffer.from([5,3,0,100,0,1,0,0]));
  const status=state.getStatus(),device=state.getDevices()[0];
  assert.equal(status.totals.devices,0);
  assert.equal(status.totals.confirmedDevices,0);
  assert.equal(status.totals.observedUnitIds,1);
  assert.equal(status.totals.unconfirmedDevices,1);
  assert.equal(device.confirmed,false);
  assert.equal(device.status,'unconfirmed');
  assert.equal(state.getRegisters({limit:20}).length,0);
});

test('an unmatched response-like frame remains unconfirmed even when CRC/shape is valid',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildRtuChannel({port:'COM7',identity:{serialNumber:'NOISE-A'},config:{baudRate:9600}}),now=Date.now();
  state.recordFrame(responseTx(channel,31,999,100,now-20,{matched:false}),now,Buffer.from([31,3,2,3,231,0,0]));
  const status=state.getStatus(),device=state.getDevices()[0];
  assert.equal(status.totals.devices,0);
  assert.equal(status.totals.unconfirmedDevices,1);
  assert.equal(device.confirmed,false);
  assert.equal(device.matchedResponses,0);
  assert.equal(device.status,'unconfirmed');
});

test('a valid response promotes an addressed ID to a confirmed device',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildRtuChannel({port:'COM8',identity:{serialNumber:'COUNT-B'},config:{baudRate:9600}}),now=Date.now();
  state.recordFrame(requestTx(channel,2),now-25,Buffer.from([2,3,0,100,0,1,0,0]));
  state.recordFrame(responseTx(channel,2,123,100,now-25),now,Buffer.from([2,3,2,0,123,0,0]));
  const status=state.getStatus(),device=state.getDevices()[0];
  assert.equal(status.totals.devices,1);
  assert.equal(status.totals.confirmedDevices,1);
  assert.equal(status.totals.unconfirmedDevices,0);
  assert.equal(status.totals.onlineDevices,1);
  assert.equal(device.confirmed,true);
  assert.equal(device.status,'online');
  assert.equal(device.matchedResponses,1);
  const regs=state.getRegisters({deviceKey:device.deviceKey,limit:20});
  assert.equal(regs.length,1);
  assert.equal(regs[0].address,100);
  assert.equal(regs[0].lastValue,123);
});

test('device liveness follows last valid response, not continuing master requests',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildRtuChannel({port:'COM9',identity:{serialNumber:'COUNT-C'},config:{baudRate:9600}}),now=Date.now(),key=makeDeviceKey(channel.channelId,9);
  state.recordFrame(responseTx(channel,9,1,100,now-10020),now-10000,Buffer.from([9,3,2,0,1,0,0]));
  state.recordFrame(requestTx(channel,9),now,Buffer.from([9,3,0,100,0,1,0,0]));
  const device=state.getDevices().find(d=>d.deviceKey===key),status=state.getStatus();
  assert.equal(device.confirmed,true);
  assert.equal(device.status,'offline');
  assert.equal(status.totals.onlineDevices,0);
  assert.equal(status.totals.offlineDevices,1);
});

test('RTU broadcast address 0 never becomes a device or poll/register inventory entry',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildRtuChannel({port:'COM10',identity:{serialNumber:'COUNT-D'},config:{baudRate:9600}}),now=Date.now();
  state.recordFrame({direction:'REQ',transport:'RTU',channel,decoded:{transport:'RTU',slaveId:0,unitId:0,functionCode:6,functionName:'Write Single Register',address:10,value:1}},now,Buffer.from([0,6,0,10,0,1,0,0]));
  const status=state.getStatus();
  assert.equal(state.getDevices().length,0);
  assert.equal(status.totals.devices,0);
  assert.equal(status.totals.observedUnitIds,0);
  assert.equal(state.getPollGroups().length,0);
  assert.equal(state.getRegisters().length,0);
});

test('TCP Unit ID 0 can still be a confirmed device when it responds',()=>{
  const state=new PlatformRuntimeStateV62(),channel=buildTcpChannel({targetHost:'192.168.10.20',targetPort:502}),now=Date.now();
  state.recordFrame(responseTx(channel,0,77,100,now-10),now,Buffer.from([0,3,2,0,77]));
  const status=state.getStatus(),device=state.getDevices()[0];
  assert.equal(status.totals.devices,1);
  assert.equal(device.transport,'TCP');
  assert.equal(device.unitId,0);
  assert.equal(device.confirmed,true);
});
