'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {installActiveDiscoveryRoutes}=require('../src/activeDiscoveryRoutes');

async function withServer({demo=false,state={connection:{status:'idle'},config:{}}},fn){
  const app=express();app.use(express.json());const manager=installActiveDiscoveryRoutes({app,state,demo,broadcast:()=>{}});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  try{return await fn(base,manager);}finally{await manager.close();await new Promise(resolve=>server.close(resolve));}
}

test('active discovery status is idle before any scan starts',async()=>withServer({},async base=>{
  const r=await fetch(`${base}/api/discovery/active/status`);assert.equal(r.status,200);const j=await r.json();assert.equal(j.state,'idle');assert.equal(j.running,false);
}));

test('RTU active discovery is rejected while passive serial capture is open',async()=>withServer({state:{connection:{status:'open'},config:{port:'COM7',baudRate:9600,parity:'none',dataBits:8,stopBits:1}}},async base=>{
  const r=await fetch(`${base}/api/discovery/active/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transport:'RTU',port:'COM7',unitStart:1,unitEnd:1,maintenanceConfirmed:true,exclusiveBusConfirmed:true})});
  assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'RTU_DISCOVERY_PASSIVE_CAPTURE_ACTIVE');
}));

test('demo mode rejects active discovery before any network connection is attempted',async()=>withServer({demo:true},async base=>{
  const r=await fetch(`${base}/api/discovery/active/start`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transport:'TCP',host:'127.0.0.1',port:1,unitStart:1,unitEnd:1})});
  assert.equal(r.status,409);const j=await r.json();assert.equal(j.code,'DISCOVERY_DEMO_DISABLED');
}));
