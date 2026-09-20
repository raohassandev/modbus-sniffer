'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  MasterMonitorSessionStore,
  normalizeMonitorStore,
}=require('../src/master/masterMonitorSessionStore');

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'modbus-monitor-store-'));}

function sampleStore(){
  return{
    version:1,
    activeId:'monitor-1',
    sessions:[{
      id:'monitor-1',
      name:'Main Meter',
      createdAt:1000,
      updatedAt:2000,
      connection:{type:'tcp',host:'192.168.1.10',port:502,timeoutMs:1000,retries:1,retryDelayMs:100,interRequestDelayMs:20},
      definition:{unitId:1,functionCode:3,address:100,quantity:2,addressMode:'raw',pollIntervalMs:1000,timeoutMs:1000,retries:1,retryDelayMs:100,interRequestDelayMs:20},
      format:{type:'float32',scale:1,offset:0,precision:2,byteOrder:'ABCD'},
      snapshot:{rowsHtml:'<img src=x onerror=alert(1)>',gridSummary:'2 rows',counters:{tx:'10',rx:'10',errors:'0',timeouts:'0',avgRtt:'4 ms'},capturedAt:2000},
      counterBaseline:{connectedAt:123,txRequests:5,rxResponses:5,errors:0,timeouts:0,retryAttempts:0}
    }]
  };
}

test('Monitor Session store persists sanitized definitions atomically',()=>{
  const dir=temp();
  const store=new MasterMonitorSessionStore({dataDir:dir});
  const saved=store.save(sampleStore());
  assert.equal(saved.activeId,'monitor-1');
  assert.equal(saved.sessions[0].connection.host,'192.168.1.10');
  assert.equal(saved.sessions[0].definition.address,100);
  assert.equal(saved.sessions[0].snapshot.rowsHtml,'');
  assert.equal(fs.existsSync(path.join(dir,'master-monitor-sessions.json')),true);
  assert.deepEqual(store.load(),saved);
  assert.equal(fs.readdirSync(dir).some(name=>name.includes('.partial-')),false);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Monitor Session store refuses duplicate ids and excessive session counts',()=>{
  const duplicate=sampleStore();
  duplicate.sessions.push({...duplicate.sessions[0]});
  assert.throws(()=>normalizeMonitorStore(duplicate),error=>error.code==='DUPLICATE_SESSION_ID');

  const excessive={version:1,sessions:Array.from({length:101},(_,index)=>({
    id:'m'+index,name:'M'+index,connection:{},definition:{},format:{},snapshot:{}
  }))};
  assert.throws(()=>normalizeMonitorStore(excessive),error=>error.code==='SESSION_LIMIT');
});

test('Monitor Session store rejects oversized durable files before parsing',()=>{
  const dir=temp();
  const file=path.join(dir,'master-monitor-sessions.json');
  fs.writeFileSync(file,'x'.repeat(2*1024*1024+1));
  const store=new MasterMonitorSessionStore({dataDir:dir});
  assert.throws(()=>store.load(),error=>error.code==='STORE_READ_FAILED'&&/2 MB safety limit/.test(error.details?.cause||''));
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Monitor Session store keeps a recoverable backup and loads it when the primary file is missing',()=>{
  const dir=temp();
  const store=new MasterMonitorSessionStore({dataDir:dir});
  const first=store.save(sampleStore());
  const secondInput=sampleStore();
  secondInput.sessions[0].name='Updated Meter';
  store.save(secondInput);
  const backup=path.join(dir,'master-monitor-sessions.json.bak');
  assert.equal(fs.existsSync(backup),true);
  assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).sessions[0].name,first.sessions[0].name);
  fs.unlinkSync(path.join(dir,'master-monitor-sessions.json'));
  const recovered=store.load();
  assert.equal(recovered.sessions[0].name,first.sessions[0].name);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Monitor Session store refuses to overwrite a corrupt durable file',()=>{
  const dir=temp();
  const file=path.join(dir,'master-monitor-sessions.json');
  fs.writeFileSync(file,'{not valid json');
  const store=new MasterMonitorSessionStore({dataDir:dir});
  assert.throws(()=>store.load(),error=>error.code==='STORE_READ_FAILED');
  assert.throws(()=>store.save(sampleStore()),error=>error.code==='STORE_READ_FAILED');
  assert.equal(fs.readFileSync(file,'utf8'),'{not valid json');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('Monitor Session store repairs a missing active id without changing session identity',()=>{
  const normalized=normalizeMonitorStore({...sampleStore(),activeId:'missing'});
  assert.equal(normalized.activeId,'monitor-1');
  assert.equal(normalized.sessions[0].id,'monitor-1');
});
