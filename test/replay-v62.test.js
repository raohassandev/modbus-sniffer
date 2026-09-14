'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {ReplayController}=require('../src/replayController');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fakeState(){
  const seen=[];
  return {
    seen,
    channels:[],
    clearCapture(){seen.length=0;},
    registerChannel(c){this.channels.push(c);},
    setCaptureSource(v){this.source=v;},
    setConnection(status,details){this.connection={status,...details};},
    ingestImportedEvent(event,timestamp){seen.push({kind:'event',timestamp,event});return event;},
    recordTimeout(request,timestamp,timeoutMs,transport){seen.push({kind:'timeout',timestamp,request,timeoutMs,transport});return seen.at(-1);}
  };
}

test('accelerated replay preserves original analysis interval while shortening wall-clock delay',async()=>{
  const state=fakeState(),replay=new ReplayController(state);
  replay.load({schemaVersion:2,channels:[{channelId:'rtu:test',transport:'RTU',mode:'replay'}],transactions:[
    {timestamp:1000,direction:'REQ',transport:'RTU',slaveId:1,decoded:{slaveId:1,functionCode:3}},
    {timestamp:2000,direction:'REQ',transport:'RTU',slaveId:1,decoded:{slaveId:1,functionCode:3}}
  ]});
  replay.start({speed:20});
  await sleep(140);
  assert.equal(state.seen.length,2);
  assert.equal(state.seen[1].timestamp-state.seen[0].timestamp,1000);
  assert.equal(state.seen[0].event.sourceTimestamp,1000);
  assert.equal(state.seen[1].event.sourceTimestamp,2000);
  assert.equal(replay.status().timingMode,'source-preserved');
  replay.stop();
});

test('replay timeouts use timeout ingestion path and keep source timestamp',async()=>{
  const state=fakeState(),replay=new ReplayController(state);
  replay.load({transactions:[{timestamp:5000,direction:'TIMEOUT',timeout:true,timeoutMs:750,transport:'TCP',request:{transport:'TCP',unitId:2,slaveId:2,functionCode:3}}]});
  replay.start({speed:20});
  await sleep(30);
  assert.equal(state.seen.length,1);
  assert.equal(state.seen[0].kind,'timeout');
  assert.equal(state.seen[0].request.sourceTimestamp,5000);
  assert.equal(state.seen[0].timeoutMs,750);
  assert.equal(state.seen[0].transport,'TCP');
});
