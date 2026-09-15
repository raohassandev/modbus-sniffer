'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const express=require('express');
const {installActiveDiscoveryRoutes}=require('../src/activeDiscoveryRoutes');
const {ActiveDiscoveryManager}=require('../src/activeDiscoveryManager');
const {WorkspaceStore}=require('../src/workspaceStore');

async function withServer({demo=false,state={connection:{status:'idle'},config:{}},workspaces=null,manager=null},fn){
  const app=express();app.use(express.json());const installed=installActiveDiscoveryRoutes({app,state,demo,broadcast:()=>{},workspaces,getActiveProjectId:workspaces?()=>workspaces.getActiveProject().id:null,manager});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await fn(base,installed);}finally{await installed.close();await new Promise(resolve=>server.close(resolve));}
}

const post=(base,body)=>fetch(`${base}/api/discovery/active/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('active discovery status is idle before any scan starts',async()=>withServer({},async base=>{
  const r=await fetch(`${base}/api/discovery/active/status`);assert.equal(r.status,200);const j=await r.json();assert.equal(j.state,'idle');assert.equal(j.running,false);
}));

test('RTU active discovery is rejected while passive serial capture is open',async()=>withServer({state:{connection:{status:'open'},config:{port:'COM7',baudRate:9600,parity:'none',dataBits:8,stopBits:1}}},async base=>{
  const r=await post(base,{transport:'RTU',port:'COM7',unitStart:1,unitEnd:1,maintenanceConfirmed:true,exclusiveBusConfirmed:true});
  assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE');
}));

test('RTU active discovery requires both explicit safety confirmations before a job is created',async()=>withServer({state:{connection:{status:'idle'},config:{port:'COM7',baudRate:9600,parity:'none',dataBits:8,stopBits:1}}},async base=>{
  const r=await post(base,{transport:'RTU',port:'COM7',unitStart:1,unitEnd:1,maintenanceConfirmed:true,exclusiveBusConfirmed:false});
  assert.equal(r.status,400);const j=await r.json();assert.equal(j.code,'RTU_DISCOVERY_CONFIRMATION_REQUIRED');
  const status=await (await fetch(`${base}/api/discovery/active/status`)).json();assert.equal(status.state,'idle');assert.equal(status.running,false);
}));

test('non-idle serial error state is also blocked until the passive capture path is explicitly disconnected',async()=>withServer({state:{connection:{status:'error'},config:{port:'COM7'}}},async base=>{
  const r=await post(base,{transport:'RTU',port:'COM7',unitStart:1,unitEnd:1,maintenanceConfirmed:true,exclusiveBusConfirmed:true});
  assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE');
}));

test('demo mode rejects active discovery before any network connection is attempted',async()=>withServer({demo:true},async base=>{
  const r=await post(base,{transport:'TCP',host:'127.0.0.1',port:1,unitStart:1,unitEnd:1});
  assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'DISCOVERY_DEMO_DISABLED');
}));

test('completed scan evidence stays with the project that started it even if active project changes mid-scan',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mbdisc-route-')),workspaces=new WorkspaceStore({dataDir:dir});
  const projectA=workspaces.getActiveProject(),projectB=workspaces.createProject({name:'Project B'});workspaces.selectProject(projectA.id);
  let release;
  const scanTcp=({onProgress})=>new Promise(resolve=>{release=()=>{const result={unitId:7,responded:true,identificationSupported:true,objects:[{objectId:0,value:'ACME'}],identification:{vendorName:'ACME',modelName:'X7'},avgRttMs:12};onProgress({transport:'TCP',unitId:7,current:1,total:1,result});resolve({transport:'TCP',mode:'active-identification',transmit:true,readOnly:true,host:'192.168.10.50',port:502,unitStart:7,unitEnd:7,results:[result],responding:[result],identified:[result]});};});
  const manager=new ActiveDiscoveryManager({scanTcp,scanRtu:async()=>({transport:'RTU',results:[]})});
  await withServer({workspaces,manager},async(base,installed)=>{
    const started=await post(base,{transport:'TCP',host:'192.168.10.50',port:502,unitStart:7,unitEnd:7});assert.equal(started.status,202);await Promise.resolve();workspaces.selectProject(projectB.id);release();await installed.promise;
    assert.equal(workspaces.listDiscoveryRuns(projectA.id).length,1);assert.equal(workspaces.listDiscoveryRuns(projectB.id).length,0);
    const run=workspaces.listDiscoveryRuns(projectA.id)[0];assert.equal(run.target.host,'192.168.10.50');assert.equal(run.summary.identified,1);
  });
});

test('discovery evidence API lists, fetches, exports and deletes only the active project records',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mbdisc-api-')),workspaces=new WorkspaceStore({dataDir:dir}),p=workspaces.getActiveProject();
  const run=workspaces.saveDiscoveryRun(p.id,{transport:'TCP',result:{transport:'TCP',host:'10.0.0.5',port:502,unitStart:1,unitEnd:1,results:[{unitId:1,responded:true,identificationSupported:false,objects:[]}]}});
  await withServer({workspaces},async base=>{
    const list=await (await fetch(`${base}/api/discovery/runs`)).json();assert.equal(list.length,1);assert.equal(list[0].id,run.id);
    const full=await (await fetch(`${base}/api/discovery/runs/${run.id}`)).json();assert.equal(full.target.host,'10.0.0.5');
    const exported=await fetch(`${base}/api/discovery/runs/${run.id}/export.json`);assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition')||'',/modbus-discovery-/);
    const deleted=await fetch(`${base}/api/discovery/runs/${run.id}`,{method:'DELETE'});assert.equal(deleted.status,200);assert.equal((await deleted.json()).ok,true);assert.equal(workspaces.listDiscoveryRuns(p.id).length,0);
  });
});
