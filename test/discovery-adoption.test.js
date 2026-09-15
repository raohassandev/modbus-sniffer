'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {WorkspaceStore}=require('../src/workspaceStore');
const {buildRtuChannel,buildTcpChannel,makeDeviceKey}=require('../src/transportIdentity');
const {previewDiscoveryAdoption,adoptDiscoveryIdentification}=require('../src/discoveryAdoption');

function store(prefix='mb-adopt-'){const dir=fs.mkdtempSync(path.join(os.tmpdir(),prefix));return new WorkspaceStore({dataDir:dir});}
function evidence(s,p,{transport='TCP',unitId=7,identity={vendorName:'ACME',productCode:'X7',productName:'Drive X7',modelName:'X7-125',revision:'R2',vendorUrl:'https://example.test',userApplicationName:'Plant Drive'}}={}){
  return s.saveDiscoveryRun(p.id,{jobId:'job-adopt',transport,result:transport==='TCP'?{transport:'TCP',host:'192.168.50.10',port:502,unitStart:unitId,unitEnd:unitId,results:[{unitId,responded:true,identificationSupported:true,objects:[{objectId:0,name:'VendorName',value:identity.vendorName},{objectId:1,name:'ProductCode',value:identity.productCode},{objectId:2,name:'MajorMinorRevision',value:identity.revision}],identification:identity}]}:{transport:'RTU',port:'COM9',serial:{baudRate:9600,parity:'none',dataBits:8,stopBits:1},unitStart:unitId,unitEnd:unitId,results:[{unitId,responded:true,identificationSupported:true,objects:[{objectId:0,name:'VendorName',value:identity.vendorName}],identification:identity}]}});
}

test('adoption preview requires an explicit exact project channel and does not mutate engineering data',()=>{
  const s=store(),p=s.getActiveProject(),c1=buildTcpChannel({targetHost:'192.168.50.10'}),c2=buildTcpChannel({targetHost:'192.168.50.11'});s.upsertChannel(p.id,c1);s.upsertChannel(p.id,c2);const run=evidence(s,p);
  assert.throws(()=>previewDiscoveryAdoption({workspaces:s,projectId:p.id,runId:run.id,unitId:7}),e=>e.code==='DISCOVERY_CHANNEL_REQUIRED');
  const preview=previewDiscoveryAdoption({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:c2.channelId});
  assert.equal(preview.deviceKey,makeDeviceKey(c2.channelId,7));assert.equal(preview.newDevice,true);assert.equal(preview.identity.manufacturer,'ACME');assert.equal(preview.identity.revision,'R2');assert.equal(Object.keys(s.getProject(p.id).devices).length,0);
});

test('adoption refuses conflicting engineering identity unless overwrite is explicitly approved',()=>{
  const s=store(),p=s.getActiveProject(),c=buildTcpChannel({targetHost:'192.168.50.10'});s.upsertChannel(p.id,c);const key=makeDeviceKey(c.channelId,7);s.setDevice(p.id,key,{name:'Main Inverter',manufacturer:'Existing Vendor',model:'Field Model',notes:'Keep this note',profileId:'profile-keep'});s.setRegister(p.id,{deviceKey:key,functionCode:3,address:100,name:'Power',type:'uint16'});const run=evidence(s,p);
  const preview=previewDiscoveryAdoption({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:c.channelId});assert.equal(preview.requiresOverwrite,true);assert.deepEqual(preview.conflicts.map(x=>x.key).sort(),['manufacturer','model']);
  assert.throws(()=>adoptDiscoveryIdentification({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:c.channelId}),e=>e.code==='DISCOVERY_ADOPTION_CONFLICT');
  const unchanged=s.getDevice(p.id,key);assert.equal(unchanged.manufacturer,'Existing Vendor');assert.equal(unchanged.model,'Field Model');assert.equal(unchanged.name,'Main Inverter');
  const out=adoptDiscoveryIdentification({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:c.channelId,overwriteExisting:true});
  assert.equal(out.device.manufacturer,'ACME');assert.equal(out.device.model,'X7-125');assert.equal(out.device.name,'Main Inverter');assert.equal(out.device.notes,'Keep this note');assert.equal(out.device.profileId,'profile-keep');assert.equal(s.listRegisters(p.id,key).length,1);
});

test('adopted FC43 product and revision metadata persist on the exact device with auditable source evidence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-adopt-persist-')),file=path.join(dir,'workspaces.json');let s=new WorkspaceStore({dataDir:dir,file}),p=s.getActiveProject(),c=buildTcpChannel({targetHost:'192.168.50.10'});s.upsertChannel(p.id,c);const run=evidence(s,p);const out=adoptDiscoveryIdentification({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:c.channelId});
  assert.equal(out.device.productCode,'X7');assert.equal(out.device.productName,'Drive X7');assert.equal(out.device.revision,'R2');assert.equal(out.device.vendorUrl,'https://example.test');assert.equal(out.device.userApplicationName,'Plant Drive');assert.equal(out.device.identification.sourceRunId,run.id);assert.equal(out.device.identification.channelId,c.channelId);
  s=new WorkspaceStore({dataDir:dir,file});p=s.getActiveProject();const key=makeDeviceKey(c.channelId,7),saved=s.getDevice(p.id,key);assert.equal(saved.productCode,'X7');assert.equal(saved.revision,'R2');const storedRun=s.getDiscoveryRun(p.id,run.id);assert.equal(storedRun.adoptions.length,1);assert.equal(storedRun.adoptions[0].deviceKey,key);
});

test('discovery identification cannot be adopted across RTU and TCP transport boundaries',()=>{
  const s=store(),p=s.getActiveProject(),rtu=buildRtuChannel({port:'COM9',identity:{serialNumber:'ADAPTER-9'},config:{baudRate:9600,parity:'none',dataBits:8,stopBits:1}});s.upsertChannel(p.id,rtu);const run=evidence(s,p,{transport:'TCP'});
  assert.throws(()=>previewDiscoveryAdoption({workspaces:s,projectId:p.id,runId:run.id,unitId:7,channelId:rtu.channelId}),e=>e.code==='DISCOVERY_TRANSPORT_MISMATCH');
});
