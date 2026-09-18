'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');

const {StableLoggerTrendService}=require('../src/loggerTrend/loggerTrendService');

class FakeState extends EventEmitter{}
class FakeMaster extends EventEmitter{}

test('stable Logger/Trend logs passive Sniffer and Master register sources',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'modbus-logger-'));
  const state=new FakeState(),master=new FakeMaster();
  const service=new StableLoggerTrendService({state,masterRuntime:master,dataDir:dir});
  t.after(()=>{service.shutdown();fs.rmSync(dir,{recursive:true,force:true});});

  service.saveProfile({
    streamId:'sniffer-v',
    label:'Sniffer V',
    unit:'V',
    source:{mode:'sniffer',deviceKey:'RTU:COM5:1',unitId:1,functionCode:3,address:0},
    mode:'every',
  });
  service.saveProfile({
    streamId:'master-a',
    label:'Master A',
    unit:'A',
    source:{mode:'master',unitId:1,functionCode:4,address:10},
    mode:'every',
  });

  state.emit('transaction',{
    timestamp:1000,direction:'RSP',deviceKey:'RTU:COM5:1',channelId:'rtu:COM5',
    unitId:1,functionCode:3,decoded:{functionCode:3,registers:[{address:0,value:230},{address:1,value:231}]}
  });
  master.emit('point',{
    sourceType:'Master',connectionId:'stable-master-1',unitId:1,functionCode:4,address:10,
    rawValue:17,value:17,timestamp:1100,quality:'good'
  });

  const sniffer=service.querySeries('sniffer-v',{maxPoints:100});
  const masterSeries=service.querySeries('master-a',{maxPoints:100});
  assert.deepEqual(sniffer.map(x=>x.value),[230]);
  assert.deepEqual(masterSeries.map(x=>x.value),[17]);
  assert.match(service.exportCsv('sniffer-v'),/230/);
  assert.equal(service.status().logger.stats.written,2);
});

test('stable Logger/Trend persists profile definitions and logs protocol evidence',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'modbus-logger-persist-'));
  const state=new FakeState(),master=new FakeMaster();
  let service=new StableLoggerTrendService({state,masterRuntime:master,dataDir:dir});
  service.saveProfile({
    streamId:'persisted',
    label:'Persisted',
    source:{mode:'sniffer',unitId:2,functionCode:3,address:5},
    mode:'change-only',
    intervalMs:500,
  });
  service.ingestEvidence({timestamp:1234,sourceType:'Master',direction:'REQ',unitId:2,functionCode:3,connectionId:'c1',rawHex:'010300000001'});
  service.ingestPoint({timestamp:1300,sourceType:'Sniffer',unitId:2,functionCode:3,address:5,rawValue:55,value:55,quality:'good'});
  assert.equal(service.recentEvents({limit:10}).length,1);
  assert.equal(service.status().logger.stats.written,2);
  service.shutdown();

  const state2=new FakeState(),master2=new FakeMaster();
  service=new StableLoggerTrendService({state:state2,masterRuntime:master2,dataDir:dir});
  t.after(()=>{service.shutdown();fs.rmSync(dir,{recursive:true,force:true});});
  assert.equal(service.listProfiles().length,1);
  assert.equal(service.getProfile('persisted').label,'Persisted');
  assert.deepEqual(service.querySeries('persisted',{maxPoints:100}).map(x=>x.value),[55]);
  assert.equal(service.status().hydration.recordsLoaded,1);
});

test('stable Logger/Trend browser workspace loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/logger-trend-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/logger-trend-v7.css'),'utf8');
  new vm.Script(ui,{filename:'logger-trend-v7.js'});
  assert.match(loader,/logger-trend-v7\.css/);
  assert.match(loader,/loggerTrend\.src='\/logger-trend-v7\.js/);
  assert.match(ui,/Modbus Logger \/ Trend/);
  assert.match(ui,/\/api\/logger-trend\/profiles/);
  assert.match(ui,/openLoggerTrendFromMaster/);
  assert.match(css,/\.logger-workspace/);
});
