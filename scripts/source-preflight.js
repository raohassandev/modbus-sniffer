'use strict';

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
];

for (const [name,args] of steps) {
  console.log(`\n=== SOURCE PREFLIGHT: ${name} ===`);
  const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{stdio:'inherit',env:process.env});
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
