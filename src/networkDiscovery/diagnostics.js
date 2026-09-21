'use strict';

const os=require('node:os');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const {pingHost}=require('./hostDiscovery');

function requireIp(host){
  const ip=String(host||'').trim();
  if(!net.isIP(ip)){const e=new Error('Network diagnostics require a discovered IP literal.');e.code='NETWORK_DIAGNOSTIC_IP_REQUIRED';throw e;}
  return ip;
}
function tracerouteCommand(ip,{maxHops=24,perHopTimeoutMs=1000}={}){
  const hops=Math.max(1,Math.min(64,Number(maxHops)||24)),ms=Math.max(100,Math.min(5000,Number(perHopTimeoutMs)||1000)),platform=os.platform();
  if(platform==='win32')return{command:'tracert',args:['-d','-h',String(hops),'-w',String(ms),ip]};
  if(platform==='darwin')return{command:'traceroute',args:['-n','-m',String(hops),'-w',String(Math.max(1,Math.ceil(ms/1000))),ip]};
  return{command:'traceroute',args:['-n','-m',String(hops),'-w',String(Math.max(1,Math.ceil(ms/1000))),ip]};
}
function parseTraceroute(text){
  const hops=[];
  for(const line of String(text||'').split(/\r?\n/)){
    const m=/^\s*(\d+)\s+(.*)$/.exec(line);if(!m)continue;
    const hop=Number(m[1]),rest=m[2],ips=[...rest.matchAll(/(?:\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f:]{3,}\b)/gi)].map(x=>x[0]).filter(x=>net.isIP(x));
    const times=[...rest.matchAll(/<?\s*(\d+(?:\.\d+)?)\s*ms/gi)].map(x=>Number(x[1])).filter(Number.isFinite);
    hops.push({hop,ip:ips[0]||null,timesMs:times.slice(0,3),timeout:/\*/.test(rest)&&!ips.length,raw:rest.trim().slice(0,500)});
  }
  return hops.slice(0,64);
}
async function tracerouteHost(host,{maxHops=24,perHopTimeoutMs=1000,timeoutMs=30000}={}){
  const ip=requireIp(host),cmd=tracerouteCommand(ip,{maxHops,perHopTimeoutMs});
  try{
    const {stdout,stderr}=await execFileAsync(cmd.command,cmd.args,{windowsHide:true,timeout:Math.max(1000,Math.min(120000,Number(timeoutMs)||30000)),maxBuffer:512*1024});
    const raw=String(stdout||stderr||'').slice(0,512*1024);
    return{ok:true,ip,command:cmd.command,hops:parseTraceroute(raw),raw};
  }catch(error){
    const raw=String(error?.stdout||error?.stderr||'').slice(0,512*1024);
    if(raw)return{ok:false,ip,command:cmd.command,hops:parseTraceroute(raw),raw,error:String(error.code||error.message)};
    const e=new Error(`Traceroute failed: ${error?.code||error?.message||error}`);e.code='TRACEROUTE_FAILED';throw e;
  }
}
async function pingDiagnostic(host,{timeoutMs=1000}={}){
  const ip=requireIp(host),result=await pingHost(ip,{timeoutMs});
  return{ip,...result,ok:Boolean(result.responded),checkedAt:new Date().toISOString()};
}

module.exports={requireIp,tracerouteCommand,parseTraceroute,tracerouteHost,pingDiagnostic};
