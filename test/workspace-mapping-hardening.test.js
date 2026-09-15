'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {WorkspaceStore}=require('../src/workspaceStore');
const {buildRtuChannel,makeDeviceKey}=require('../src/transportIdentity');

function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mbmap-hard-')),s=new WorkspaceStore({dataDir:dir}),p=s.getActiveProject(),c=buildRtuChannel({port:'COM7',identity:{serialNumber:'A'},config:{baudRate:9600,parity:'none',dataBits:8,stopBits:1}});s.upsertChannel(p.id,c);return{dir,s,p:s.getActiveProject(),c,key:makeDeviceKey(c.channelId,1)};}

test('register mappings normalize byte order, store word span, and reject overlap',()=>{
  const {s,p,key}=setup();
  const a=s.setRegister(p.id,{deviceKey:key,functionCode:3,address:100,type:'float32',byteOrder:'CDAB',name:'Power'});
  assert.equal(a.wordCount,2);assert.equal(a.endAddress,101);assert.equal(a.byteOrder,'CDAB');
  assert.throws(()=>s.setRegister(p.id,{deviceKey:key,functionCode:3,address:101,type:'uint16',byteOrder:'AB'}),e=>e.code==='MAPPING_OVERLAP');
  assert.throws(()=>s.setRegister(p.id,{deviceKey:key,functionCode:3,address:200,type:'float32',byteOrder:'ABCDEFGH'}),e=>e.code==='INVALID_BYTE_ORDER');
  assert.throws(()=>s.setRegister(p.id,{deviceKey:key,functionCode:3,address:65535,type:'uint32',byteOrder:'ABCD'}),e=>e.code==='MAPPING_ADDRESS_OVERFLOW');
});

test('same address mapping can be edited without false self-overlap',()=>{
  const {s,p,key}=setup();
  s.setRegister(p.id,{deviceKey:key,functionCode:3,address:10,type:'uint32',byteOrder:'ABCD',name:'Old'});
  const edited=s.setRegister(p.id,{deviceKey:key,functionCode:3,address:10,type:'float32',byteOrder:'DCBA',name:'New'});
  assert.equal(edited.name,'New');assert.equal(edited.endAddress,11);
});

test('profile versions increment and applied device records exact profile provenance',()=>{
  const {s,p,key}=setup();
  s.setDevice(p.id,key,{name:'Meter'});
  let profile=s.saveProfile({name:'P',manufacturer:'ACME',model:'M1',source:{type:'manual'},registers:[{functionCode:3,address:20,type:'uint32',byteOrder:'ABCD',name:'Energy'}]});
  assert.equal(profile.version,1);
  profile=s.saveProfile({...profile,model:'M2'});assert.equal(profile.version,2);
  const applied=s.applyProfile(p.id,key,profile.id);assert.equal(applied.count,1);assert.equal(applied.profile.version,2);
  const device=s.getDevice(p.id,key);assert.equal(device.profileId,profile.id);assert.equal(device.profileVersion,2);assert.equal(device.profileSource.type,'manual');assert.equal(device.name,'Meter');
});

test('invalid profile application is preflighted and cannot partially mutate project',()=>{
  const {s,p,key}=setup();
  s.setDevice(p.id,key,{name:'Meter'});
  s.setRegister(p.id,{deviceKey:key,functionCode:3,address:100,type:'uint32',byteOrder:'ABCD',name:'Existing'});
  const before=JSON.stringify(s.getProject(p.id));
  assert.throws(()=>s.saveProfile({name:'Bad',registers:[{functionCode:3,address:200,type:'uint32',byteOrder:'ABCD'},{functionCode:3,address:201,type:'uint16',byteOrder:'AB'}]}),e=>e.code==='MAPPING_OVERLAP');
  assert.equal(JSON.stringify(s.getProject(p.id)),before);
});

test('workspace import rejects overlapping multiword mappings before replacing local data',()=>{
  const {s,p,key}=setup(),before=s.exportAll(),bad=s.exportAll();
  bad.projects[0].registers={
    [`${key}:3:10`]:{deviceKey:key,channelId:p.channels?Object.keys(p.channels)[0]:key.split('|')[0],unitId:1,slaveId:1,functionCode:3,address:10,type:'uint32',byteOrder:'ABCD'},
    [`${key}:3:11`]:{deviceKey:key,channelId:key.split('|')[0],unitId:1,slaveId:1,functionCode:3,address:11,type:'uint16',byteOrder:'AB'}
  };
  assert.throws(()=>s.importAll(bad),e=>e.code==='MAPPING_OVERLAP');
  assert.deepEqual(s.exportAll(),before);
});
