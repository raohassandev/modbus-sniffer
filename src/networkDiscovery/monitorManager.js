'use strict';

const {EventEmitter}=require('node:events');
const {connectProbe}=require('./serviceScanner');
const {pingHost}=require('./hostDiscovery');
const {verifyModbusEndpoint}=require('./modbusVerifier');

function bounded(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function uniqPorts(values=[]){return[...new Set(values.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=65535))].slice(0,32);}
class NetworkMonitorManager extends EventEmitter{
  constructor({store=null,getProjectId=()=>null,verifyModbus=verifyModbusEndpoint}={}){
    super();this.store=store;this.getProjectId=getProjectId;this.verifyModbus=verifyModbus;this.entries=new Map();this.closed=false;
  }
  list(){return[...this.entries.values()].map(x=>this._public(x));}
  _public(e){return{hostId:e.hostId,projectId:e.projectId||null,ip:e.ip,intervalMs:e.intervalMs,ports:[...e.ports],modbusPort:e.modbusPort,pingAlways:e.pingAlways!==false,running:e.running,lastCheck:e.lastCheck||null,nextCheck:e.nextCheck||null,state:e.state||'unknown',lastResult:e.lastResult?{...e.lastResult}:null,metrics:e.metrics?{...e.metrics}:null,failures:e.failures||0};}
  start({hostId,ip,ports=[],modbusPort=null,intervalMs=30000,projectId=null,pingAlways=true}={}){
    if(this.closed)throw new Error('Network monitor is closed.');
    if(!hostId||!ip)throw new Error('hostId and IP are required.');
    if(this.entries.size>=64&&!this.entries.has(String(hostId))){const e=new Error('Network monitor limit is 64 hosts.');e.code='NETWORK_MONITOR_LIMIT';throw e;}
    const id=String(hostId),entry=this.entries.get(id)||{hostId:id,ip:String(ip),failures:0,state:'unknown'};
    entry.projectId=String(projectId||entry.projectId||this.getProjectId?.()||'default');entry.ip=String(ip);entry.ports=uniqPorts(ports);entry.modbusPort=modbusPort==null?null:Number(modbusPort);entry.intervalMs=Math.round(bounded(intervalMs,5000,3600000,30000));entry.pingAlways=pingAlways!==false;entry.samples=Array.isArray(entry.samples)?entry.samples:[];entry.running=true;
    this.entries.set(id,entry);this._schedule(entry,0);return this._public(entry);
  }
  stop(hostId){const e=this.entries.get(String(hostId));if(!e)return false;e.running=false;clearTimeout(e.timer);e.timer=null;e.nextCheck=null;this.entries.delete(String(hostId));this.emit('status',this.list());return true;}
  async checkNow(hostId){const e=this.entries.get(String(hostId));if(!e){const err=new Error('Monitored host not found.');err.code='NETWORK_MONITOR_NOT_FOUND';throw err;}return this._check(e);}
  _schedule(entry,delay){
    clearTimeout(entry.timer);if(!entry.running||this.closed)return;entry.nextCheck=new Date(Date.now()+delay).toISOString();entry.timer=setTimeout(()=>this._check(entry).catch(()=>{}),delay);entry.timer.unref?.();
  }
  async _check(entry){
    if(!entry.running||this.closed)return null;clearTimeout(entry.timer);entry.timer=null;entry.nextCheck=null;
    const started=Date.now(),serviceRows=[];
    for(const port of entry.ports)serviceRows.push(await connectProbe(entry.ip,port,{timeoutMs:1000}));
    let ping={responded:false,rttMs:null,error:null};if(entry.pingAlways||!serviceRows.some(x=>x.open))ping=await pingHost(entry.ip,{timeoutMs:1000});
    let modbus=null;if(entry.modbusPort&&serviceRows.some(x=>x.port===entry.modbusPort&&x.open))modbus=await this.verifyModbus({host:entry.ip,port:entry.modbusPort,unitIds:[1,255],timeoutMs:900}).catch(e=>({verified:false,error:e.message}));
    const online=Boolean(serviceRows.some(x=>x.open)||ping.responded||modbus?.verified),prev=entry.state||'unknown',state=online?'online':'offline',rtts=[ping.rttMs,...serviceRows.map(x=>x.rttMs)].filter(Number.isFinite);
    const result={checkedAt:new Date().toISOString(),state,online,ping,services:serviceRows,modbus,avgRttMs:rtts.length?Math.round(rtts.reduce((a,b)=>a+b,0)/rtts.length*100)/100:null,durationMs:Date.now()-started};
    entry.samples.push({at:result.checkedAt,online,pingResponded:Boolean(ping.responded),pingRttMs:Number.isFinite(ping.rttMs)?ping.rttMs:null});if(entry.samples.length>120)entry.samples.splice(0,entry.samples.length-120);
    const pingSamples=entry.samples.filter(x=>x.pingResponded&&Number.isFinite(x.pingRttMs)),sent=entry.samples.length,received=entry.samples.filter(x=>x.pingResponded).length;
    const diffs=[];for(let i=1;i<pingSamples.length;i++)diffs.push(Math.abs(pingSamples[i].pingRttMs-pingSamples[i-1].pingRttMs));
    entry.metrics={sampleCount:sent,icmpSent:sent,icmpReceived:received,packetLossPct:sent?Math.round((1-received/sent)*10000)/100:0,avgPingRttMs:pingSamples.length?Math.round(pingSamples.reduce((n,x)=>n+x.pingRttMs,0)/pingSamples.length*100)/100:null,jitterMs:diffs.length?Math.round(diffs.reduce((a,b)=>a+b,0)/diffs.length*100)/100:null};
    result.metrics={...entry.metrics};
    entry.lastCheck=result.checkedAt;entry.lastResult=result;entry.state=state;entry.failures=online?0:(entry.failures||0)+1;
    const projectId=entry.projectId||'default';
    if(this.store){
      const host=this.store.getHost(projectId,entry.hostId);if(host)this.store.mergeHost(projectId,{...host,state,alive:online,lastSeen:online?result.checkedAt:host.lastSeen,monitor:{state,lastCheck:result.checkedAt,avgRttMs:result.avgRttMs,failures:entry.failures,metrics:entry.metrics}},'network-monitor');
      if(prev!=='unknown'&&prev!==state)this.store.addEvent(projectId,{type:state==='online'?'device-returned':'device-offline',hostId:entry.hostId,ip:entry.ip,source:'network-monitor',before:prev,after:state});
    }
    this.emit('result',{hostId:entry.hostId,result});this.emit('status',this.list());this._schedule(entry,entry.intervalMs);return result;
  }
  async close(){this.closed=true;for(const e of this.entries.values()){e.running=false;clearTimeout(e.timer);}this.entries.clear();}
}
module.exports={NetworkMonitorManager,uniqPorts};
