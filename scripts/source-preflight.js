'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const steps = [
  ['version:check', ['run','version:check']],
  ['source-audit', ['run','audit:source']],
  ['lint', ['run','lint']],
  ['syntax-all', ['run','check:syntax']],
  ['syntax-v8-compat', ['run','check:v8']],
  ['runtime-audit', ['run','audit:runtime']],
  ['tests', ['test']],
  ['smoke', ['run','smoke']],
  ['acceptance', ['run','acceptance']],
  ['l8f-runtime', ['run','acceptance:l8f']],
];

function runNpm(args){
  const npmExecPath=String(process.env.npm_execpath||'').trim();
  if(npmExecPath && fs.existsSync(npmExecPath)){
    return spawnSync(process.execPath,[npmExecPath,...args],{stdio:'inherit',env:process.env});
  }
  if(process.platform==='win32'){
    const comspec=process.env.ComSpec||process.env.COMSPEC||'cmd.exe';
    return spawnSync(comspec,['/d','/s','/c','npm',...args],{stdio:'inherit',env:process.env,windowsHide:true});
  }
  return spawnSync('npm',args,{stdio:'inherit',env:process.env});
}

for (const [name,args] of steps) {
  console.log(`\n=== SOURCE PREFLIGHT: ${name} ===`);
  const result=runNpm(args);
  if(result.error){
    console.error(result.error);
    process.exit(1);
  }
  if(result.status!==0){
    console.error(`SOURCE PREFLIGHT FAIL at ${name}`);
    process.exit(result.status||1);
  }
}
console.log('\nSOURCE PREFLIGHT PASS');
