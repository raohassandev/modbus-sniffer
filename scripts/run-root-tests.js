'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const testDir=path.join(root,'test');
const files=fs.readdirSync(testDir)
  .filter(name=>/\.(?:test|spec)\.(?:js|cjs|mjs)$/.test(name))
  .sort()
  .map(name=>path.join('test',name));

if(!files.length){
  console.error('No root Modbus test files found.');
  process.exit(1);
}

console.log(`Running ${files.length} root Modbus test file(s); nested unrelated projects and browser assets are excluded.`);
const result=spawnSync(process.execPath,['--test',...files],{
  cwd:root,
  stdio:'inherit',
  env:process.env,
});
if(result.error){
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status==null?1:result.status);
