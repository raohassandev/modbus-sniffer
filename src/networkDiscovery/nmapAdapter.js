'use strict';

const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const net=require('node:net');
const execFileAsync=promisify(execFile);

function candidates(){
  return [...new Set([process.env.NMAP_PATH,'nmap'].filter(Boolean).map(String))];
}
async function detectNmap(){
  for(const command of candidates()){
    try{
      const {stdout,stderr}=await execFileAsync(command,['--version'],{windowsHide:true,timeout:3000,maxBuffer:512*1024});
      const text=String(stdout||stderr||''),version=/Nmap version\s+([^\s]+)/i.exec(text)?.[1]||null;
      return{available:true,command,version,raw:text.split(/\r?\n/)[0]?.slice(0,200)||null};
    }catch{}
  }
  return{available:false,command:null,version:null,raw:null};
}
function decodeXmlText(v){
  return String(v||'').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
function attr(block,name){
  return decodeXmlText(new RegExp(`\\b${name}="([^"]*)"`,'i').exec(block)?.[1]||'');
}
function parseNmapXml(xml){
  const text=String(xml||''),hosts=[];
  for(const m of text.matchAll(/<host\b[\s\S]*?<\/host>/gi)){
    const block=m[0],statusBlock=/<status\b[^>]*\/>/i.exec(block)?.[0]||'',state=attr(statusBlock,'state')||'unknown';
    const addresses=[...block.matchAll(/<address\b[^>]*\/>/gi)].map(x=>({addr:attr(x[0],'addr'),addrtype:attr(x[0],'addrtype'),vendor:attr(x[0],'vendor')||null}));
    const ipv4=addresses.find(x=>x.addrtype==='ipv4')?.addr||null,ipv6=addresses.find(x=>x.addrtype==='ipv6')?.addr||null,macRow=addresses.find(x=>x.addrtype==='mac');
    const hostnames=[...block.matchAll(/<hostname\b[^>]*\/>/gi)].map(x=>attr(x[0],'name')).filter(Boolean);
    const ports=[...block.matchAll(/<port\b[^>]*>[\s\S]*?<\/port>/gi)].map(x=>{
      const p=x[0],service=/<service\b[^>]*\/>/i.exec(p)?.[0]||'',stateTag=/<state\b[^>]*\/>/i.exec(p)?.[0]||'';
      return{port:Number(attr(p,'portid')),protocol:attr(p,'protocol')||'tcp',state:attr(stateTag,'state')||'unknown',name:attr(service,'name')||'',product:attr(service,'product')||'',version:attr(service,'version')||'',extraInfo:attr(service,'extrainfo')||'',tunnel:attr(service,'tunnel')||'',method:attr(service,'method')||'',confidence:Number(attr(service,'conf')||0)};
    }).filter(x=>Number.isInteger(x.port));
    const osMatches=[...block.matchAll(/<osmatch\b[^>]*>/gi)].map(x=>({name:attr(x[0],'name'),accuracy:Number(attr(x[0],'accuracy')||0),line:attr(x[0],'line')})).filter(x=>x.name).sort((a,b)=>b.accuracy-a.accuracy);
    hosts.push({state,ip:ipv4||ipv6,ipv4,ipv6,mac:macRow?.addr||null,macVendor:macRow?.vendor||null,hostnames,ports,os:osMatches[0]||null,osMatches:osMatches.slice(0,8)});
  }
  return hosts;
}
async function runNmap(args,{timeoutMs=120000,maxBuffer=10*1024*1024}={}){
  const found=await detectNmap();if(!found.available){const e=new Error('Nmap is not installed or not available in PATH.');e.code='NMAP_NOT_AVAILABLE';throw e;}
  const {stdout,stderr}=await execFileAsync(found.command,args,{windowsHide:true,timeout:Math.max(1000,Math.min(10*60*1000,Number(timeoutMs)||120000)),maxBuffer});
  return{nmap:found,stdout:String(stdout||''),stderr:String(stderr||'')};
}
async function discoverWithNmap({targets=[],exclude=[],timeoutMs=120000}={}){
  const targetArgs=(Array.isArray(targets)?targets:[targets]).flatMap(v=>String(v||'').split(/[\n,;]+/)).map(x=>x.trim()).filter(Boolean);
  if(!targetArgs.length)throw new Error('At least one target is required.');
  const excludeArgs=(Array.isArray(exclude)?exclude:[exclude]).flatMap(v=>String(v||'').split(/[\n,;]+/)).map(x=>x.trim()).filter(Boolean);
  const args=['-sn','-n','--max-retries','1','-oX','-'];
  if(excludeArgs.length)args.push('--exclude',excludeArgs.join(','));
  args.push(...targetArgs);
  const out=await runNmap(args,{timeoutMs});
  return{nmap:out.nmap,mode:'host-discovery',hosts:parseNmapXml(out.stdout),stderr:out.stderr.slice(0,2000)};
}
async function fingerprintWithNmap({host,ports=[],allowOsDetect=false,timeoutMs=60000}={}){
  if(net.isIP(String(host))===0){const e=new Error('Nmap fingerprint host must be an IP literal from the discovered inventory.');e.code='INVALID_NMAP_HOST';throw e;}
  const safePorts=[...new Set((ports||[]).map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=65535))].slice(0,256);
  const args=['-n','-sT','-sV','--version-light','--max-retries','1'];
  if(safePorts.length)args.push('-p',safePorts.join(','));
  else args.push('-p','22,23,80,102,443,502,802,1883,4840,8883,44818');
  if(allowOsDetect)args.push('-O','--osscan-limit');
  args.push('-oX','-',String(host));
  const out=await runNmap(args,{timeoutMs});
  return{nmap:out.nmap,mode:'service-fingerprint',host:parseNmapXml(out.stdout)[0]||null,stderr:out.stderr.slice(0,2000),osRequested:Boolean(allowOsDetect)};
}

module.exports={detectNmap,parseNmapXml,discoverWithNmap,fingerprintWithNmap,runNmap};
