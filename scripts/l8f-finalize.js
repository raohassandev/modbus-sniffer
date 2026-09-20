'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {version:PRODUCT_VERSION}=require('../package.json');

function arg(name){
  const index=process.argv.indexOf(name);
  return index>=0&&index+1<process.argv.length?process.argv[index+1]:null;
}
function readJson(label,file){
  if(!file)throw new Error(label+' evidence path is required');
  const absolute=path.resolve(file);
  if(!fs.existsSync(absolute))throw new Error(label+' evidence not found: '+absolute);
  const value=JSON.parse(fs.readFileSync(absolute,'utf8'));
  if(value.result!=='PASS')throw new Error(label+' evidence is not PASS');
  return{absolute,value};
}
function main(){
  const runtime=readJson('runtime',arg('--runtime'));
  const windows=readJson('windows',arg('--windows'));
  const field=readJson('field',arg('--field'));
  const physical=readJson('physical',arg('--physical'));
  const out=arg('--json-out');
  const evidences=[runtime,windows,field,physical];

  const heads=evidences.map(item=>item.value.head||item.value.commit).filter(Boolean);
  if(heads.length!==evidences.length)throw new Error('Every L8-F evidence file must contain head/commit');
  if(new Set(heads).size!==1)throw new Error('L8-F evidence files do not share the same exact commit: '+heads.join(', '));

  const versions=evidences.map(item=>item.value.productVersion).filter(Boolean);
  if(versions.length!==evidences.length)throw new Error('Every L8-F evidence file must contain productVersion');
  if(new Set(versions).size!==1||versions[0]!==PRODUCT_VERSION)throw new Error('L8-F evidence version mismatch: '+versions.join(', '));

  const requiredPhysical=['passive-rtu','master-rtu','master-tcp','external-master-slave','tls-mtls','windows-production'];
  const physicalChecks=Array.isArray(physical.value.checks)?physical.value.checks:[];
  for(const name of requiredPhysical){
    const check=physicalChecks.find(item=>item&&item.name===name);
    if(!check||check.result!=='PASS')throw new Error('Physical acceptance missing PASS check: '+name);
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
