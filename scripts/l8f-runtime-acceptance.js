'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const {version:PRODUCT_VERSION}=require('../package.json');

function arg(name,fallback=null){
  const index=process.argv.indexOf(name);
  return index>=0&&index+1<process.argv.length?process.argv[index+1]:fallback;
}
function gitHead(root){
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  return result.status===0?String(result.stdout||'').trim():null;
}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      const port=address&&typeof address==='object'?address.port:null;
      server.close(error=>error?reject(error):resolve(port));
    });
  });
}
async function api(base,pathname,{method='GET',body=null,accept='application/json'}={}){
  const response=await fetch(base+pathname,{
    method,
    headers:{accept,...(body==null?{}:{'content-type':'application/json'})},
    body:body==null?undefined:JSON.stringify(body),
  });
  const contentType=response.headers.get('content-type')||'';
  const parsed=contentType.includes('json')?await response.json():await response.text();
  return{status:response.status,ok:response.ok,body:parsed};
}
async function stop(child){
  if(!child||child.exitCode!=null)return;
  child.kill();
  for(let i=0;i<30&&child.exitCode==null;i++)await sleep(50);
  if(child.exitCode==null)child.kill('SIGKILL');
}
async function launch(root,dataDir,port){
  const child=spawn(process.execPath,['src/index-v7.js','--demo','--quiet','--web-host','127.0.0.1','--web-port',String(port),'--data-dir',dataDir],{
    cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'true'}
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk.toString()).slice(-20000);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-20000);});
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<80;i++){
    if(child.exitCode!=null)throw new Error('Unified runtime exited before ready: '+child.exitCode+'\n'+stderr);
    try{
      const status=await api(base,'/api/status');
      if(status.ok)return{child,base,status:status.body,logs:()=>({stdout,stderr})};
    }catch{}
    await sleep(150);
  }
  await stop(child);
  throw new Error('Unified runtime did not become ready\n'+stderr);
}
async function main(){
  const root=path.resolve(__dirname,'..');
  const head=gitHead(root);
  const expectedHead=arg('--expect-head',null);
  const jsonOut=arg('--json-out',null);
  if(expectedHead)assert.equal(head,expectedHead,'checked-out commit does not match --expect-head');
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'modbus-l8f-runtime-'));
  const checks=[];
  const record=(name,details={})=>{
    checks.push({name,ok:true,...details});
    console.log('PASS  '+name);
  };
  const startedAt=new Date().toISOString();
  let first=null,second=null;
  try{
    first=await launch(root,dataDir,await freePort());
    assert.equal(first.status.productName,'Modbus Engineering Tool');
    assert.equal(first.status.productVersion,PRODUCT_VERSION);
    record('unified health identity',{productVersion:PRODUCT_VERSION});

    const rootPage=await api(first.base,'/',{accept:'text/html'});
    assert.equal(rootPage.status,200);
    assert.ok(String(rootPage.body).includes('Modbus Engineering Tool'));
    assert.ok(String(rootPage.body).includes('platform-v6.js'));
    for(const asset of ['platform-v6.js','master-v7.js','slave-v7.js','help-v7.js']){
      const response=await api(first.base,'/'+asset,{accept:'text/javascript'});
      assert.equal(response.status,200,'asset missing: '+asset);
      assert.ok(String(response.body).length>50,'asset empty: '+asset);
    }
    assert.equal((await api(first.base,'/v8/')).status,404);
    record('unified UI assets and legacy-shell block');

    const portsResponse=await api(first.base,'/api/ports');
    assert.equal(portsResponse.status,200);
    assert.ok(Array.isArray(portsResponse.body));
    record('serial enumerator safe on current host',{ports:portsResponse.body.length});

    const slaveStart=await api(first.base,'/api/slave/start',{method:'POST',body:{type:'tcp',host:'127.0.0.1',port:0,maxClients:4}});
    assert.equal(slaveStart.status,200);
    assert.equal(slaveStart.body.running,true);
    const slavePort=Number(slaveStart.body.listenAddress&&slaveStart.body.listenAddress.port);
    assert.ok(slavePort>0);
    record('built-in TCP Slave start',{port:slavePort});

    const seed=await api(first.base,'/api/slave/memory',{method:'POST',body:{unitId:1,area:'holdingRegisters',address:10,values:[1234,5678]}});
    assert.equal(seed.status,200);
    const connected=await api(first.base,'/api/master/connect',{method:'POST',body:{type:'tcp',host:'127.0.0.1',port:slavePort,timeoutMs:1000}});
    assert.equal(connected.status,200);
    assert.equal(connected.body.connected,true);
    assert.equal(connected.body.writeState,'LOCKED');
    const read=await api(first.base,'/api/master/read',{method:'POST',body:{unitId:1,functionCode:3,address:10,quantity:2}});
    assert.equal(read.status,200);
    assert.deepEqual(read.body.rows.map(row=>row.value),[1234,5678]);
    record('Master to Slave TCP loopback read');

    const rejected=await api(first.base,'/api/master/write',{method:'POST',body:{
      unitId:1,functionCode:16,address:0,values:[11,22],confirmation:{confirmed:true},readBack:true
    }});
    assert.equal(rejected.status,400);
    assert.equal(rejected.body.code,'BULK_CONFIRMATION_REQUIRED');
    const audit=await api(first.base,'/api/master/write-audit?limit=20');
    assert.equal(audit.status,200);
    assert.ok(audit.body.some(row=>row.functionCode===16&&row.result==='failed'&&row.preflightRejected===true&&row.transmitted===false));
    const masterStatus=await api(first.base,'/api/master/status');
    assert.equal(masterStatus.body.writeState,'LOCKED');
    record('unsafe bulk write rejected before transmit');

    const monitorSessionPayload={
      version:1,
      activeId:'acceptance-monitor',
      sessions:[{
        id:'acceptance-monitor',
        name:'Acceptance Monitor',
        connection:{type:'tcp',host:'127.0.0.1',port:slavePort,timeoutMs:1000},
        definition:{unitId:1,functionCode:3,address:10,quantity:2,pollIntervalMs:1000,timeoutMs:1000},
        format:{type:'uint16',scale:1,offset:0,precision:0,byteOrder:'ABCD'},
        snapshot:{rowsHtml:'<b>must-not-persist</b>',gridSummary:'acceptance'}
      }]
    };
    const savedMonitors=await api(first.base,'/api/master/monitor-sessions',{method:'PUT',body:monitorSessionPayload});
    assert.equal(savedMonitors.status,200);
    assert.equal(savedMonitors.body.activeId,'acceptance-monitor');
    assert.equal(savedMonitors.body.sessions[0].snapshot.rowsHtml,'');
    record('Monitor Session durable save sanitizes rendered HTML');

    const rawLab=await api(first.base,'/api/raw-lab/status');
    const slaveLab=await api(first.base,'/api/slave/lab/status');
    assert.equal(rawLab.status,200);
    assert.equal(slaveLab.status,200);
    assert.notEqual(rawLab.body&&rawLab.body.studio&&rawLab.body.studio.labArmed,true);
    assert.notEqual(slaveLab.body&&slaveLab.body.enabled,true);
    record('LAB surfaces default fail-safe');

    await stop(first.child);
    first=null;

    second=await launch(root,dataDir,await freePort());
    const restartedMonitors=await api(second.base,'/api/master/monitor-sessions');
    assert.equal(restartedMonitors.status,200);
    assert.equal(restartedMonitors.body.activeId,'acceptance-monitor');
    assert.equal(restartedMonitors.body.sessions[0].definition.address,10);
    assert.equal(restartedMonitors.body.sessions[0].snapshot.rowsHtml,'');
    record('Monitor Sessions persist across runtime restart');

    const restartedMaster=await api(second.base,'/api/master/status');
    const restartedSlave=await api(second.base,'/api/slave/status');
    const restartedRaw=await api(second.base,'/api/raw-lab/status');
    assert.equal(restartedMaster.body.connected,false);
    assert.equal(restartedMaster.body.writeState,'LOCKED');
    assert.equal(restartedSlave.body.running,false);
    assert.notEqual(restartedSlave.body&&restartedSlave.body.lab&&restartedSlave.body.lab.enabled,true);
    assert.notEqual(restartedRaw.body&&restartedRaw.body.studio&&restartedRaw.body.studio.labArmed,true);
    record('restart does not restore live write or LAB state');

    const evidence={
      schemaVersion:1,
      kind:'modbus-l8f-runtime-acceptance',
      result:'PASS',
      head,
      productVersion:PRODUCT_VERSION,
      startedAt,
      completedAt:new Date().toISOString(),
      platform:process.platform,
      arch:process.arch,
      node:process.version,
      checks
    };
    if(jsonOut){
      const target=path.resolve(jsonOut);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,JSON.stringify(evidence,null,2)+'\n');
      console.log('Evidence: '+target);
    }
    console.log('\nL8-F RUNTIME ACCEPTANCE: PASS head='+(head||'unknown')+' checks='+checks.length+'\n');
  }finally{
    await stop(first&&first.child);
    await stop(second&&second.child);
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
}
main().catch(error=>{
  console.error('\nL8-F RUNTIME ACCEPTANCE: FAIL');
  console.error(error.stack||error.message);
  process.exitCode=1;
});
