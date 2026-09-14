'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeRegisterIntelligence,
  reconstructPollingCycle,
  buildDeviceFingerprints,
  analyzeRelationships,
  detectAnomalies,
  compareCaptures
} = require('../src/intelligenceV7');

function req(id, slave, fc, start, quantity, timestamp) {
  const deviceKey=`rtu:test::${slave}`;
  return {id,timestamp,direction:'REQ',transport:'RTU',channelId:'rtu:test',deviceKey,unitId:slave,slaveId:slave,functionCode:fc,decoded:{transport:'RTU',channelId:'rtu:test',deviceKey,unitId:slave,slaveId:slave,functionCode:fc,startAddress:start,quantity}};
}
function rsp(id, slave, fc, start, values, timestamp, rttMs=10) {
  const deviceKey=`rtu:test::${slave}`;
  return {id,timestamp,direction:'RSP',transport:'RTU',channelId:'rtu:test',deviceKey,unitId:slave,slaveId:slave,functionCode:fc,rttMs,matched:true,request:{transport:'RTU',channelId:'rtu:test',deviceKey,unitId:slave,slaveId:slave,functionCode:fc,startAddress:start,quantity:values.length},decoded:{transport:'RTU',channelId:'rtu:test',deviceKey,unitId:slave,slaveId:slave,functionCode:fc,registers:values.map((value,i)=>({address:start+i,value}))}};
}
function fixture() {
  const transactions=[];let id=0;
  for(let cycle=0;cycle<10;cycle++){
    const t=cycle*1000;
    transactions.push(req(++id,1,3,0,4,t));
    transactions.push(rsp(++id,1,3,0,[100+cycle,200+cycle,300+cycle,600+cycle*3],t+10,10+cycle));
    transactions.push(req(++id,2,4,10,2,t+100));
    transactions.push(rsp(++id,2,4,10,[400+cycle,500+cycle],t+112,12+cycle));
  }
  const registers=new Map();
  for(const [slave,fc,start,base,count] of [[1,3,0,100,4],[2,4,10,400,2]]){
    for(let i=0;i<count;i++){
      const address=start+i,deviceKey=`rtu:test::${slave}`;
      registers.set(`${deviceKey}:${fc}:${address}`,{deviceKey,channelId:'rtu:test',transport:'RTU',unitId:slave,slaveId:slave,functionCode:fc,address,lastValue:base+i*100+9,lastHex:`0x${(base+i*100+9).toString(16).toUpperCase().padStart(4,'0')}`,history:Array.from({length:10},(_,n)=>({timestamp:n*1000,value:base+i*100+n}))});
    }
  }
  const polls=[
    {key:'p1',deviceKey:'rtu:test::1',channelId:'rtu:test',transport:'RTU',unitId:1,slaveId:1,functionCode:3,operation:'read',startAddress:0,quantity:4,requests:10,responses:10,timeouts:0,medianIntervalMs:1000,jitterPct:0},
    {key:'p2',deviceKey:'rtu:test::2',channelId:'rtu:test',transport:'RTU',unitId:2,slaveId:2,functionCode:4,operation:'read',startAddress:10,quantity:2,requests:10,responses:10,timeouts:0,medianIntervalMs:1000,jitterPct:0}
  ];
  const devices=[
    {deviceKey:'rtu:test::1',channelId:'rtu:test',channelName:'Test RTU',transport:'RTU',unitId:1,slaveId:1,status:'online',requests:10,responses:10,timeouts:0,timeoutRate:0,functions:[3],firstSeen:0,lastSeen:9010,lastResponseAt:9010},
    {deviceKey:'rtu:test::2',channelId:'rtu:test',channelName:'Test RTU',transport:'RTU',unitId:2,slaveId:2,status:'online',requests:10,responses:10,timeouts:0,timeoutRate:0,functions:[4],firstSeen:100,lastSeen:9112,lastResponseAt:9112}
  ];
  return {transactions,registers,pollPatterns:new Map(),timeline:new Map(),getDevices:()=>devices,getPollGroups:()=>polls,getRegisters:()=>[...registers.values()].map(r=>({...r,history:undefined})),getTransactions:()=>transactions};
}

test('reconstructs repeating master polling cycle',()=>{
  const out=reconstructPollingCycle(fixture());
  assert.equal(out.channels.length,1);
  assert.equal(out.channels[0].requestsPerCycle,2);
  assert.ok(out.channels[0].sequenceConfidence>=80);
  assert.equal(out.channels[0].deviceCount,2);
});

test('builds automatic register interpretations with confidence',()=>{
  const out=analyzeRegisterIntelligence(fixture());
  assert.ok(out.rows.length>=6);
  assert.ok(out.rows.every(row=>row.topCandidate));
  assert.ok(out.rows.some(row=>row.behaviors.some(b=>b.kind==='counter')));
});

test('builds device fingerprints and relationship findings',()=>{
  const state=fixture();
  const fp=buildDeviceFingerprints(state);
  const rel=analyzeRelationships(state);
  assert.equal(fp.devices.length,2);
  assert.ok(fp.devices.every(x=>x.fingerprint.length===20));
  assert.ok(rel.relationships.some(x=>x.kind==='sum-total'));
});

test('anomaly engine surfaces write traffic',()=>{
  const state=fixture();
  const write=req(999,1,6,20,1,10000);write.decoded={...write.decoded,address:20,value:123};state.transactions.push(write);
  const out=detectAnomalies(state);
  assert.ok(out.events.some(e=>e.type==='write-observed'));
});

test('compares captures for topology changes',()=>{
  const state=fixture();
  const before={transactions:state.transactions.slice(0,20)};
  const after={transactions:[...state.transactions,req(2000,3,3,100,2,11000),rsp(2001,3,3,100,[1,2],11010)]};
  const out=compareCaptures(before,after);
  assert.equal(out.summary.addedDevices,1);
  assert.ok(out.addedDevices.some(x=>x.includes('3')));
});
