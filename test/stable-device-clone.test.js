'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const { DeviceCloneService, pickRegisters }=require('../src/deviceClone/deviceCloneService');
const { SlaveRuntime }=require('../src/slave/slaveRuntime');

function fakeState(){
  const summary={
    deviceKey:'RTU:COM5:7',channelId:'rtu:COM5',channelName:'COM5',transport:'RTU',
    unitId:7,name:'Slave 7',status:'online',confirmed:true,registerCount:6,functions:[1,3,4,6],
    frames:50,firstSeen:1000,lastSeen:2000
  };
  const registers=[
    {deviceKey:summary.deviceKey,functionCode:3,address:0,lastValue:111,samples:10},
    {deviceKey:summary.deviceKey,functionCode:6,address:0,lastValue:999,samples:1},
    {deviceKey:summary.deviceKey,functionCode:3,address:1,lastValue:222,samples:10},
    {deviceKey:summary.deviceKey,functionCode:4,address:10,lastValue:333,samples:5},
    {deviceKey:summary.deviceKey,functionCode:1,address:5,lastValue:1,samples:7},
    {deviceKey:summary.deviceKey,functionCode:2,address:8,lastValue:0,samples:1},
  ];
  return {
    getDevices:()=>[{...summary}],
    getDevice:(ref,{channelId}={})=>{
      if(ref!==summary.deviceKey&&Number(ref)!==summary.unitId)return null;
      if(channelId&&channelId!==summary.channelId)return null;
      return {summary:{...summary},registers:registers.map(x=>({...x}))};
    },
  };
}

test('Device Clone prefers read evidence and defaults external writes off',async t=>{
  const slave=new SlaveRuntime();
  t.after(()=>slave.shutdown());
  const service=new DeviceCloneService({state:fakeState(),slaveRuntime:slave});
  const preview=service.preview({deviceKey:'RTU:COM5:7',targetUnitId:12,port:0});

  assert.equal(preview.source.unitId,7);
  assert.equal(preview.source.clonedPoints,5);
  assert.equal(preview.map.devices[0].unitId,12);
  assert.equal(preview.policy.writesEnabled,false);
  assert.deepEqual(preview.map.devices[0].writableAreas,{coils:false,holdingRegisters:false});
  assert.deepEqual(preview.map.devices[0].memory.holdingRegisters,[{address:0,values:[111,222]}]);
  assert.deepEqual(preview.map.devices[0].memory.inputRegisters,[{address:10,values:[333]}]);
  assert.deepEqual(preview.map.devices[0].memory.coils,[{address:5,values:[true]}]);
  assert.deepEqual(preview.map.devices[0].memory.discreteInputs,[{address:8,values:[false]}]);

  const applied=await service.apply({deviceKey:'RTU:COM5:7',targetUnitId:12,port:0});
  assert.equal(applied.status.running,false);
  assert.deepEqual(slave.readMemory({unitId:12,area:'holdingRegisters',address:0,quantity:2}).values,[111,222]);
  assert.equal(slave.listDevices()[0].writableAreas.coils,false);
  assert.equal(slave.listDevices()[0].writableAreas.holdingRegisters,false);
});

test('Device Clone requires explicit option before cloned writable areas are enabled',()=>{
  const service=new DeviceCloneService({state:fakeState(),slaveRuntime:{status:()=>({running:false}),importConfig:async()=>({})}});
  const preview=service.preview({deviceKey:'RTU:COM5:7',allowWrites:true});
  assert.equal(preview.policy.writesEnabled,true);
  assert.deepEqual(preview.map.devices[0].writableAreas,{coils:true,holdingRegisters:true});
});

test('Device Clone register selector prefers FC03 evidence over FC06 at same address',()=>{
  const rows=pickRegisters([
    {functionCode:6,address:10,lastValue:999,samples:100},
    {functionCode:3,address:10,lastValue:123,samples:1},
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].functionCode,3);
  assert.equal(rows[0].value,123);
});

test('Device Clone stable UI loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/device-clone-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/device-clone-v7.css'),'utf8');
  new vm.Script(ui,{filename:'device-clone-v7.js'});
  assert.match(loader,/device-clone-v7\.css/);
  assert.match(loader,/clone\.src='\/device-clone-v7\.js/);
  assert.match(ui,/Capture → Simulator/);
  assert.match(ui,/\/api\/device-clone\/sources/);
  assert.match(ui,/\/api\/device-clone\/preview/);
  assert.match(ui,/\/api\/device-clone\/apply/);
  assert.match(ui,/Make Coils\/Holding Registers externally writable/);
  assert.match(css,/\.clone-workspace/);
});
