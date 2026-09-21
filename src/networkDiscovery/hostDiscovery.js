'use strict';

const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const {scanTcpServices,reverseDns,profilePorts,classifyServices,ensureNotAborted}=require('./serviceScanner');
const {normalizeMac,buildHostFingerprint}=require('./deviceFingerprint');

function parseNeighborText(text){
  const out=new Map();
  for(const line of String(text||'').split(/\r?\n/)){
    let ip=null,mac=null;
    let m=/\((\d{1,3}(?:\.\d{1,3}){3})\)\s+at\s+([0-9a-f:-]{11,})/i.exec(line);
    if(m){ip=m[1];mac=m[2];}
    if(!m){
      m=/^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f:-]{11,})\s+/i.exec(line);
      if(m){ip=m[1];mac=m[2];}
    }
    if(!m){
      m=/^(\d{1,3}(?:\.\d{1,3}){3})\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})/i.exec(line.trim());
      if(m){ip=m[1];mac=m[2];}
    }
    const n=normalizeMac(mac);if(ip&&n)out.set(ip,{ip,mac:n,source:'neighbor-table'});
  }
  return out;
}
async function readNeighborTable(){
  const platform=os.platform(),attempts=platform==='linux'?[['ip',['neigh']],['arp',['-an']]]:[['arp',['-a']]];
  for(const [cmd,args] of attempts){
    try{
      const {stdout}=await execFileAsync(cmd,args,{windowsHide:true,timeout:3000,maxBuffer:2*1024*1024});
      const parsed=parseNeighborText(stdout);if(parsed.size)return parsed;
    }catch{}
  }
  return new Map();
}
function pingArgs(host,timeoutMs){
  const platform=os.platform(),ms=Math.max(100,Math.min(5000,Number(timeoutMs)||700));
  if(platform==='win32')return['-n','1','-w',String(ms),host];
  if(platform==='darwin')return['-c','1','-W',String(ms),host];
  return['-c','1','-W',String(Math.max(1,Math.ceil(ms/1000))),host];
}
async function pingHost(host,{timeoutMs=700,signal=null}={}){
  ensureNotAborted(signal);
  const started=Date.now();
  try{
    const child=execFile('ping',pingArgs(host,timeoutMs),{windowsHide:true,timeout:Math.max(500,Number(timeoutMs)||700)+500,maxBuffer:256*1024});
    const abort=()=>{try{child.kill();}catch{}};signal?.addEventListener?.('abort',abort,{once:true});
    const result=await new Promise(resolve=>{
      child.once('exit',code=>resolve({responded:code===0,error:code===0?null:`exit-${code}`}));
      child.once('error',e=>resolve({responded:false,error:String(e.code||e.message)}));
    });
    signal?.removeEventListener?.('abort',abort);
    return{...result,rttMs:result.responded?Date.now()-started:null};
  }catch(e){return{responded:false,rttMs:null,error:String(e.code||e.message)};}
}
async function discoverHost(ip,{profile='standard',customPorts=[],timeoutMs=350,serviceConcurrency=8,useIcmp=true,signal=null,neighborMap=null,verifyModbus=null}={}){
  ensureNotAborted(signal);
  const ports=profilePorts(profile,customPorts);
  const services=await scanTcpServices(ip,{ports,timeoutMs,concurrency:serviceConcurrency,signal});
  const classes=classifyServices(services),open=classes.open;
  let ping={responded:false,rttMs:null,error:null};
  if(useIcmp&&open.length===0)ping=await pingHost(ip,{timeoutMs:Math.max(500,timeoutMs),signal});
  const neighbor=neighborMap?.get?.(ip)||null;
  const alive=Boolean(open.length||ping.responded||neighbor);
  if(!alive)return{ip,alive:false,state:'unknown',services:[],ping,mac:neighbor?.mac||null,hostname:null,hostnames:[],evidence:[...(ping.responded?[{type:'icmp',status:'observed'}]:[])]};
  const hostnames=await reverseDns(ip,{timeoutMs:Math.max(400,timeoutMs*2)});
  let modbus=null;
  if(typeof verifyModbus==='function'&&classes.modbusCandidates.length){
    for(const candidate of classes.modbusCandidates){
      const result=await verifyModbus({host:ip,port:candidate.port,signal});
      if(result?.verified){modbus=result;break;}
      if(!modbus)modbus=result;
    }
  }
  const fingerprint=buildHostFingerprint({ip,hostname:hostnames[0]||null,hostnames,mac:neighbor?.mac||null,macSource:neighbor?.source,services,modbus});
  const rtts=[...open.map(x=>x.rttMs).filter(Number.isFinite),ping.rttMs].filter(Number.isFinite);
  return{
    ...fingerprint,alive:true,state:'online',ping,rawServices:services,
    avgRttMs:rtts.length?Math.round(rtts.reduce((a,b)=>a+b,0)/rtts.length*100)/100:null,
    discoveryMethods:[...(neighbor?['neighbor-table']:[]),...(ping.responded?['icmp']:[]),...(open.length?['tcp-connect']:[]),...(hostnames.length?['reverse-dns']:[])],
    firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString()
  };
}

module.exports={parseNeighborText,readNeighborTable,pingHost,discoverHost,pingArgs};
