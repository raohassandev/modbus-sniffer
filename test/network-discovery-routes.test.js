'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const net=require('node:net');
const {EventEmitter}=require('node:events');
const {installNetworkDiscoveryRoutes}=require('../src/networkDiscovery/networkDiscoveryRoutes');
const {NetworkStore}=require('../src/networkDiscovery/networkStore');

function fakeManager(){
  const e=new EventEmitter();
  let status={state:'idle',running:false,paused:false,jobId:null,profile:null,target:null,progress:{total:0,scanned:0,current:null},summary:{targets:0,scanned:0,online:0,industrial:0,modbus:0,unknown:0,warnings:0,errors:0},hosts:[],findings:[]};
  return Object.assign(e,{
    status:()=>status,
    start:input=>{status={...status,state:'running',running:true,jobId:'job-1',profile:input.profile||'standard',target:String(input.target||input.targets||''),progress:{total:1,scanned:0,current:null},summary:{...status.summary,targets:1}};return status;},
    pause:()=>{status={...status,state:'paused',paused:true};return status;},
    resume:()=>{status={...status,state:'running',paused:false};return status;},
    cancel:()=>{status={...status,state:'cancelled',running:false,paused:false};return status;},
    close:async()=>{}
  });
}

async function withServer({demo=false}={},fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mb-network-routes-'));
  const store=new NetworkStore({dataDir:dir});
  const manager=fakeManager();
  const app=express();app.use(express.json({limit:'2mb'}));
  const projectId='p1';
  const installed=installNetworkDiscoveryRoutes({
    app,options:{dataDir:dir},store,manager,demo,broadcast:()=>{},getActiveProjectId:()=>projectId,
    workspaces:{getProject:()=>({id:projectId,channels:{},devices:{},discoveryRuns:[]})}
  });
  const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await fn({base,store,manager,projectId});}
  finally{await installed.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
}

test('network route preview supports requested compact range and reports safe target count',async()=>withServer({},async({base})=>{
  const r=await fetch(`${base}/api/network/targets/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targets:'192.168.1-2.1-3'})});
  assert.equal(r.status,200);const body=await r.json();assert.equal(body.count,6);assert.equal(body.hasPublicTargets,false);assert.equal(body.samples[0],'192.168.1.1');
}));

test('network capability route exposes bounded IPv6, read-only enrichments and local scanner identity',async()=>withServer({},async({base})=>{
  const r=await fetch(`${base}/api/network/capabilities`);assert.equal(r.status,200);const body=await r.json();
  assert.equal(body.scannerId,'local');assert.equal(body.ipv4,true);assert.equal(body.ipv6,true);assert.equal(body.modbusVerification,true);assert.equal(body.snmp,true);assert.equal(body.lldp,true);
}));

test('network inventory routes keep Master handoff prepared-only and never auto-connect/transmit',async()=>withServer({},async({base,store,projectId})=>{
  const host=store.mergeHost(projectId,{ip:'192.168.10.20',mac:'00:11:22:33:44:55',hostname:'PLC-1',state:'online',alive:true,services:[{port:502,protocol:'tcp',name:'Modbus TCP',status:'verified'}],modbus:{verified:true,port:502,unitId:7}},'test');
  let r=await fetch(`${base}/api/network/hosts/${encodeURIComponent(host.id)}`);assert.equal(r.status,200);const full=await r.json();assert.equal(full.ip,'192.168.10.20');
  r=await fetch(`${base}/api/network/hosts/${encodeURIComponent(host.id)}/open-master`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({unitId:7})});
  assert.equal(r.status,200);const body=await r.json();assert.deepEqual(body.prepared,{type:'tcp',host:'192.168.10.20',port:502,unitId:7,connect:false,transmit:false,source:'network-discovery'});
}));

test('native deep scan works without Nmap and preserves discovered open ports',async()=>{
  const probe=net.createServer(socket=>socket.end());
  await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const port=probe.address().port;
  try{
    await withServer({},async({base,store,projectId})=>{
      const host=store.mergeHost(projectId,{ip:'127.0.0.1',state:'online',alive:true},'test');
      const r=await fetch(`${base}/api/network/hosts/${encodeURIComponent(host.id)}/deep-scan`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ports:[port],timeoutMs:120,concurrency:24})});
      assert.equal(r.status,200);const body=await r.json();
      assert.equal(body.summary.openPorts>=1,true);
      assert.equal(body.host.services.some(s=>s.port===port),true);
    });
  }finally{await new Promise(resolve=>probe.close(resolve));}
});

test('SNMP enrichment route requires explicit community before any query is attempted',async()=>withServer({},async({base,store,projectId})=>{
  const host=store.mergeHost(projectId,{ip:'192.168.1.50',state:'online',alive:true},'test');
  const r=await fetch(`${base}/api/network/hosts/${encodeURIComponent(host.id)}/snmp`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,400);const body=await r.json();assert.equal(body.code,'SNMP_COMMUNITY_REQUIRED');
}));

test('inventory export is CSV-safe and classification updates persist',async()=>withServer({},async({base,store,projectId})=>{
  const host=store.mergeHost(projectId,{ip:'192.168.1.12',hostname:'=FORMULA()',state:'online',alive:true,classification:'unknown'},'test');
  let r=await fetch(`${base}/api/network/hosts/${encodeURIComponent(host.id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({classification:'trusted',notes:'Commissioned'})});
  assert.equal(r.status,200);assert.equal((await r.json()).classification,'trusted');
  r=await fetch(`${base}/api/network/hosts.csv`);assert.equal(r.status,200);const csv=await r.text();assert.match(csv,/192\.168\.1\.12/);assert.match(csv,/trusted/);
}));

test('demo mode blocks active network scan start before a scan manager is invoked',async()=>withServer({demo:true},async({base,manager})=>{
  const before=manager.status();
  const r=await fetch(`${base}/api/network/scan/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target:'192.168.1.10'})});
  assert.equal(r.status,409);const body=await r.json();assert.equal(body.code,'NETWORK_SCAN_DEMO_DISABLED');assert.deepEqual(manager.status(),before);
}));
