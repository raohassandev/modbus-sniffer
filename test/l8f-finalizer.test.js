'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const finalizer=path.join(root,'scripts','l8f-finalize.js');
const version=require('../package.json').version;

function gitHead(){
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||'git rev-parse failed');
  return String(result.stdout||'').trim();
}
function baseEvidence(head){
  const completedAt=new Date().toISOString();
  return{
    runtime:{
      schemaVersion:1,kind:'modbus-l8f-runtime-acceptance',result:'PASS',head,productVersion:version,completedAt,
      checks:[
        {name:'unified health identity',ok:true},
        {name:'Master to Slave TCP loopback read',ok:true},
        {name:'unsafe bulk write rejected before transmit',ok:true},
        {name:'Monitor Session durable save sanitizes rendered HTML',ok:true},
        {name:'Monitor Sessions persist across runtime restart',ok:true},
        {name:'restart does not restore live write or LAB state',ok:true},
      ]
    },
    windows:{
      schemaVersion:1,kind:'modbus-windows-package-acceptance',result:'PASS',commit:head,productVersion:version,completedAt,
      checks:[
        {name:'NSIS clean install',ok:true},
        {name:'Installed health identity',ok:true},
        {name:'Installed unified UI assets',ok:true},
        {name:'Installed serial enumerator',ok:true},
        {name:'NSIS clean uninstall',ok:true},
      ]
    },
    field:{
      schemaVersion:1,kind:'modbus-field-acceptance',result:'PASS',head,productVersion:version,completedAt,
      checks:[
        'Product identity','Capture source active','Valid Modbus frames','Requests observed','Responses observed',
        'Automatic devices','Polling groups learned','Registers discovered','Line noise','Unmatched responses','Timeout rate'
      ].map(check=>({check,ok:true}))
    },
    physical:{
      schemaVersion:1,kind:'modbus-l8f-physical-acceptance',result:'PASS',head,productVersion:version,completedAt,
      checks:['passive-rtu','master-rtu','master-tcp','external-master-slave','tls-mtls','windows-production']
        .map(name=>({name,result:'PASS',evidence:'evidence/'+name+'.txt'}))
    }
  };
}
function runFinalizer(evidence){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'modbus-l8f-finalizer-'));
  try{
    const args=[];
    for(const label of ['runtime','windows','field','physical']){
      const file=path.join(dir,label+'.json');
      fs.writeFileSync(file,JSON.stringify(evidence[label],null,2));
      args.push('--'+label,file);
    }
    args.push('--json-out',path.join(dir,'final.json'));
    return spawnSync(process.execPath,[finalizer,...args],{cwd:root,encoding:'utf8'});
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
}

test('L8-F finalizer accepts complete evidence bound to the current exact checkout',()=>{
  const result=runFinalizer(baseEvidence(gitHead()));
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/L8-F FINAL ACCEPTANCE: PASS/);
});

test('L8-F finalizer rejects stale evidence even when every evidence file agrees with the stale head',()=>{
  const evidence=baseEvidence('0000000000000000000000000000000000000000');
  const result=runFinalizer(evidence);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/evidence is stale for this checkout/);
});

test('L8-F finalizer rejects evidence type substitution',()=>{
  const evidence=baseEvidence(gitHead());
  evidence.windows.kind='modbus-l8f-runtime-acceptance';
  const result=runFinalizer(evidence);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/windows evidence kind mismatch/);
});

test('L8-F finalizer rejects physical PASS labels without an evidence reference',()=>{
  const evidence=baseEvidence(gitHead());
  evidence.physical.checks[0].evidence=null;
  const result=runFinalizer(evidence);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Physical acceptance missing evidence reference: passive-rtu/);
});
