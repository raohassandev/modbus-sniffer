'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=__dirname;
const dist=path.join(root,'dist');

function stopStalePackagedApp(){
  if(process.platform!=='win32')return;
  const image='Modbus Engineering Tool.exe';
  const result=spawnSync('taskkill',['/IM',image,'/T','/F'],{windowsHide:true,stdio:'ignore'});
  if(result.error && result.error.code!=='ENOENT')console.warn(`Could not query/stop stale packaged process: ${result.error.message}`);
}

function sleep(ms){
  if(typeof Atomics?.wait==='function'){
    const sab=new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab),0,0,ms);
    return;
  }
  const until=Date.now()+ms;while(Date.now()<until){}
}

function removeDist(){
  if(!fs.existsSync(dist))return;
  let lastError=null;
  for(let attempt=1;attempt<=12;attempt++){
    try{
      fs.rmSync(dist,{recursive:true,force:true,maxRetries:3,retryDelay:150});
      if(!fs.existsSync(dist))return;
    }catch(error){lastError=error;}
    if(attempt===1)stopStalePackagedApp();
    sleep(Math.min(1200,150*attempt));
  }
  const suffix=`stale-${Date.now()}`;
  const renamed=path.join(root,`dist-${suffix}`);
  try{
    fs.renameSync(dist,renamed);
    console.warn(`Locked previous dist directory was moved aside: ${path.basename(renamed)}`);
    return;
  }catch(error){lastError=error;}
  const e=new Error(`Unable to clean desktop/dist before packaging. Close any running "Modbus Engineering Tool.exe" instance and retry. Last error: ${lastError?.message||'unknown'}`);
  e.code='DESKTOP_DIST_LOCKED';
  throw e;
}

stopStalePackagedApp();
removeDist();
console.log('Desktop packaging preclean PASS');
