'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {version:PRODUCT_VERSION}=require('../package.json');

function arg(name){
  const index=process.argv.indexOf(name);
  return index>=0&&index+1<process.argv.length?process.argv[index+1]:null;
}
function gitHead(){
  const root=path.resolve(__dirname,'..');
  const result=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
  if(result.status!==0)throw new Error('Unable to resolve current git HEAD for exact-head acceptance');
  const head=String(result.stdout||'').trim();
  if(!/^[0-9a-f]{40}$/i.test(head))throw new Error('Current git HEAD is invalid: '+head);
  return head;
}
function readJson(label,file,expectedKind){
  if(!file)throw new Error(label+' evidence path is required');
  const absolute=path.resolve(file);
  if(!fs.existsSync(absolute))throw new Error(label+' evidence not found: '+absolute);
  const value=JSON.parse(fs.readFileSync(absolute,'utf8'));
  if(value.schemaVersion!==1)throw new Error(label+' evidence schemaVersion must be 1');
  if(value.kind!==expectedKind)throw new Error(label+' evidence kind mismatch: '+String(value.kind||'missing'));
  if(value.result!=='PASS')throw new Error(label+' evidence is not PASS');
  if(!value.completedAt||Number.isNaN(Date.parse(value.completedAt)))throw new Error(label+' evidence completedAt is missing or invalid');
  return{absolute,value};
}
function requireChecks(label,value,names,key='name'){
  const checks=Array.isArray(value.checks)?value.checks:[];
  for(const name of names){
    const check=checks.find(item=>item&&item[key]===name);
    if(!check)throw new Error(label+' evidence missing check: '+name);
    if(check.ok===false||check.result==='FAIL'||check.result==='PENDING')throw new Error(label+' evidence check is not PASS: '+name);
    if(check.ok!==true&&check.result!=='PASS')throw new Error(label+' evidence check has no PASS result: '+name);
  }
}
function main(){
  const currentHead=gitHead();
  const expectedHead=arg('--expect-head');
  if(expectedHead&&expectedHead!==currentHead)throw new Error('Checked-out head '+currentHead+' does not match expected '+expectedHead);
  const runtime=readJson('runtime',arg('--runtime'),'modbus-l8f-runtime-acceptance');
  const windows=readJson('windows',arg('--windows'),'modbus-windows-package-acceptance');
  const field=readJson('field',arg('--field'),'modbus-field-acceptance');
  const physical=readJson('physical',arg('--physical'),'modbus-l8f-physical-acceptance');
  const out=arg('--json-out');
  const evidences=[runtime,windows,field,physical];

  const heads=evidences.map(item=>item.value.head||item.value.commit).filter(Boolean);
  if(heads.length!==evidences.length)throw new Error('Every L8-F evidence file must contain head/commit');
  if(new Set(heads).size!==1)throw new Error('L8-F evidence files do not share the same exact commit: '+heads.join(', '));
  if(heads[0]!==currentHead)throw new Error('L8-F evidence is stale for this checkout: evidence='+heads[0]+' current='+currentHead);

  const versions=evidences.map(item=>item.value.productVersion).filter(Boolean);
  if(versions.length!==evidences.length)throw new Error('Every L8-F evidence file must contain productVersion');
  if(new Set(versions).size!==1||versions[0]!==PRODUCT_VERSION)throw new Error('L8-F evidence version mismatch: '+versions.join(', '));

  requireChecks('runtime',runtime.value,[
    'unified health identity',
    'Master to Slave TCP loopback read',
    'unsafe bulk write rejected before transmit',
    'Monitor Session durable save sanitizes rendered HTML',
    'Monitor Sessions persist across runtime restart',
    'restart does not restore live write or LAB state'
  ]);
  requireChecks('windows',windows.value,[
    'NSIS clean install',
    'Installed health identity',
    'Installed unified UI assets',
    'Installed serial enumerator',
    'NSIS clean uninstall'
  ]);
  requireChecks('field',field.value,[
    'Product identity',
    'Capture source active',
    'Valid Modbus frames',
    'Requests observed',
    'Responses observed',
    'Automatic devices',
    'Polling groups learned',
    'Registers discovered',
    'Line noise',
    'Unmatched responses',
    'Timeout rate'
  ],'check');

  const requiredPhysical=['passive-rtu','master-rtu','master-tcp','external-master-slave','tls-mtls','windows-production'];
  const physicalChecks=Array.isArray(physical.value.checks)?physical.value.checks:[];
  for(const name of requiredPhysical){
    const check=physicalChecks.find(item=>item&&item.name===name);
    if(!check||check.result!=='PASS')throw new Error('Physical acceptance missing PASS check: '+name);
    if(check.evidence==null||(typeof check.evidence==='string'&&!check.evidence.trim()))throw new Error('Physical acceptance missing evidence reference: '+name);
  }

  const result={
    schemaVersion:1,
    kind:'modbus-l8f-final-acceptance',
    result:'PASS',
    head:heads[0],
    productVersion:PRODUCT_VERSION,
    completedAt:new Date().toISOString(),
    sources:{
      runtime:runtime.absolute,
      windows:windows.absolute,
      field:field.absolute,
      physical:physical.absolute
    },
    requiredPhysicalChecks:requiredPhysical
  };
  if(out){
    const absolute=path.resolve(out);
    fs.mkdirSync(path.dirname(absolute),{recursive:true});
    fs.writeFileSync(absolute,JSON.stringify(result,null,2)+'\n');
    console.log('Evidence: '+absolute);
  }
  console.log('L8-F FINAL ACCEPTANCE: PASS head='+result.head+' version='+PRODUCT_VERSION);
}
try{main();}catch(error){
  console.error('L8-F FINAL ACCEPTANCE: FAIL');
  console.error(error.stack||error.message);
  process.exitCode=1;
}
