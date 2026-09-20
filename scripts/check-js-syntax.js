'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const roots=['src','public','scripts','desktop','test','e2e'];
const files=[];
function walk(dir){
  if(!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){
      if(['node_modules','dist','test-results','playwright-report'].includes(entry.name))continue;
      walk(full);
    }else if(entry.isFile()&&entry.name.endsWith('.js'))files.push(full);
  }
}
for(const name of roots)walk(path.join(root,name));
for(const file of ['playwright.config.js','playwright.unified.config.js','playwright.compat.config.js']){
  const full=path.join(root,file);if(fs.existsSync(full))files.push(full);
}
files.sort();
if(!files.length){console.error('No JavaScript files found for syntax validation.');process.exit(1);}
let failures=0;
for(const file of files){
  const out=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(out.status!==0){
    failures++;
    console.error('Syntax check failed: '+path.relative(root,file));
    if(out.stderr)console.error(out.stderr.trim());
  }
}
if(failures){console.error(`PROJECT SYNTAX FAIL: ${failures}/${files.length} file(s) failed.`);process.exit(1);}
console.log(`PROJECT SYNTAX PASS: ${files.length} JavaScript file(s) checked.`);
