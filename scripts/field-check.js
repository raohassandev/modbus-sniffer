'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

function arg(name,fallback){
  const i=process.argv.indexOf(name);
  return i>=0&&i+1<process.argv.length?process.argv[i+1]:fallback;
}
function narg(name,fallback){
  const value=Number(arg(name,fallback));
  return Number.isFinite(value)?value:fallback;
}
function gitHead(){
  const result=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
  return result.status===0?String(result.stdout||'').trim():null;
}
const base=String(arg('--url','http://127.0.0.1:8080')).replace(/\/$/,'');
const minDevices=Math.max(1,narg('--min-devices',1));
const minFrames=Math.max(1,narg('--min-frames',50));
const maxNoisePct=Math.max(0,narg('--max-noise-pct',1));
const maxTimeoutPct=Math.max(0,narg('--max-timeout-pct',5));
const maxUnmatchedPct=Math.max(0,narg('--max-unmatched-pct',2));
const jsonOut=arg('--json-out',null);
const expectVersion=arg('--expect-version',null);
const expectHead=arg('--expect-head',null);

async function get(endpoint){
  const response=await fetch(base+endpoint,{headers:{accept:'application/json'}});
  if(!response.ok)throw new Error(endpoint+': HTTP '+response.status);
  return response.json();
}
function printRow(name,ok,value,note=''){
  const mark=ok?'PASS':'FAIL';
  console.log(mark.padEnd(5)+' '+name.padEnd(28)+' '+String(value).padEnd(14)+' '+note);
  return{check:name,ok,value,note};
}
async function main(){
  const startedAt=new Date().toISOString();
  const head=gitHead();
  if(expectHead&&head!==expectHead)throw new Error('Checked-out head '+head+' does not match expected '+expectHead);
  const [status,analysis,devices,polls,registers]=await Promise.all([
    get('/api/status'),get('/api/analysis'),get('/api/devices'),get('/api/polls'),get('/api/registers?limit=20000')
  ]);
  if(expectVersion&&status.productVersion!==expectVersion)throw new Error('Runtime version '+status.productVersion+' does not match expected '+expectVersion);

  const totals=status.totals||{};
  const rates=analysis.rates||{};
  const requestCount=Number(totals.requests||0);
  const timeoutRate=requestCount?Number(totals.timeouts||0)/requestCount*100:0;
  const noisePct=Number(rates.noiseRatio||0);
  const unmatchedPct=Number(rates.unmatchedResponseRate||0);
  const open=['open','demo','capture','replay'].includes(status.connection&&status.connection.status);
  const onlineDevices=devices.filter(device=>device.status==='online').length;
  const offlineDevices=devices.filter(device=>device.status==='offline').length;

  console.log('\n=== Modbus Engineering Tool Field Acceptance Check ===');
  console.log('Source: '+base);
  console.log('Commit: '+(head||'unknown'));
  console.log('Version: '+(status.productVersion||'unknown')+'\n');

  const checks=[];
  checks.push(printRow('Product identity',status.productName==='Modbus Engineering Tool',status.productName||'unknown'));
  checks.push(printRow('Capture source active',open,(status.connection&&status.connection.status)||'unknown'));
  checks.push(printRow('Valid Modbus frames',Number(totals.frames||0)>=minFrames,Number(totals.frames||0),'minimum '+minFrames));
  checks.push(printRow('Requests observed',requestCount>0,requestCount));
  checks.push(printRow('Responses observed',Number(totals.responses||0)>0,Number(totals.responses||0)));
  checks.push(printRow('Automatic devices',devices.length>=minDevices,devices.length,'minimum '+minDevices));
  checks.push(printRow('Polling groups learned',polls.length>0,polls.length));
  checks.push(printRow('Registers discovered',registers.length>0,registers.length));
  checks.push(printRow('Line noise',noisePct<=maxNoisePct,noisePct.toFixed(3)+'%','limit '+maxNoisePct+'%'));
  checks.push(printRow('Unmatched responses',unmatchedPct<=maxUnmatchedPct,unmatchedPct.toFixed(3)+'%','limit '+maxUnmatchedPct+'%'));
  checks.push(printRow('Timeout rate',timeoutRate<=maxTimeoutPct,timeoutRate.toFixed(3)+'%','limit '+maxTimeoutPct+'%'));

  console.log('\nINFO  Online devices              '+onlineDevices);
  console.log('INFO  Offline devices             '+offlineDevices);
  console.log('INFO  Exceptions                  '+Number(totals.exceptions||0));
  console.log('INFO  Avg RTT                     '+(totals.avgRttMs==null?'—':totals.avgRttMs+' ms'));
  console.log('INFO  P95 RTT                     '+(totals.p95RttMs==null?'—':totals.p95RttMs+' ms'));

  const passed=checks.every(item=>item.ok);
  const evidence={
    schemaVersion:1,
    kind:'modbus-field-acceptance',
    result:passed?'PASS':'FAIL',
    head,
    productName:status.productName||null,
    productVersion:status.productVersion||null,
    startedAt,
    completedAt:new Date().toISOString(),
    source:base,
    platform:process.platform,
    arch:process.arch,
    node:process.version,
    thresholds:{minDevices,minFrames,maxNoisePct,maxTimeoutPct,maxUnmatchedPct},
    metrics:{
      frames:Number(totals.frames||0),
      requests:requestCount,
      responses:Number(totals.responses||0),
      devices:devices.length,
      onlineDevices,
      offlineDevices,
      pollingGroups:polls.length,
      registers:registers.length,
      noisePct,
      unmatchedPct,
      timeoutPct:timeoutRate,
      exceptions:Number(totals.exceptions||0),
      avgRttMs:totals.avgRttMs??null,
      p95RttMs:totals.p95RttMs??null
    },
    checks
  };
  if(jsonOut){
    const target=path.resolve(jsonOut);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,JSON.stringify(evidence,null,2)+'\n');
    console.log('\nEvidence: '+target);
  }
  console.log(passed?'\nFIELD ACCEPTANCE CHECK: PASS\n':'\nFIELD ACCEPTANCE CHECK: FAIL — review failed lines above.\n');
  if(!passed)process.exitCode=2;
}
main().catch(error=>{
  console.error('\nFIELD ACCEPTANCE CHECK: ERROR');
  console.error(error.stack||error.message);
  console.error('Make sure the app is running at '+base+'.');
  process.exitCode=1;
});
