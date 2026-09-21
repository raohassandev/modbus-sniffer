'use strict';

const {EventEmitter}=require('node:events');
const crypto=require('node:crypto');
const {parseTargets,iterateTargets,targetContains}=require('./targetParser');
const {readNeighborTable,discoverHost}=require('./hostDiscovery');
const {scanTcpServices,reverseDns,profilePorts,classifyServices,fetchHttpMetadata,fetchTlsCertificate}=require('./serviceScanner');
const {buildHostFingerprint,duplicateFindings}=require('./deviceFingerprint');
const {verifyModbusEndpoint}=require('./modbusVerifier');
const {buildLogicalTopology}=require('./topology');
const {hostKey}=require('./networkStore');

const PROFILE_DEFAULTS=Object.freeze({
  quick:{hostConcurrency:128,serviceConcurrency:4,timeoutMs:250,useIcmp:true,verifyModbus:false,enrichWeb:false},
  standard:{hostConcurrency:72,serviceConcurrency:8,timeoutMs:350,useIcmp:true,verifyModbus:true,enrichWeb:true},
  modbus:{hostConcurrency:64,serviceConcurrency:4,timeoutMs:400,useIcmp:true,verifyModbus:true,enrichWeb:false},
  deep:{hostConcurrency:32,serviceConcurrency:10,timeoutMs:500,useIcmp:true,verifyModbus:true,enrichWeb:true},
  custom:{hostConcurrency:64,serviceConcurrency:8,timeoutMs:350,useIcmp:true,verifyModbus:false,enrichWeb:false},
});
function bounded(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
function normalizeProfile(value){const key=String(value||'standard').toLowerCase();return PROFILE_DEFAULTS[key]?key:'standard';}
function summary(hosts=[],progress={}){
  return{
    targets:Number(progress.total||0),scanned:Number(progress.scanned||0),online:hosts.filter(h=>h.alive).length,
    industrial:hosts.filter(h=>h.industrial).length,modbus:hosts.filter(h=>h.modbus?.verified).length,
    unknown:hosts.filter(h=>!h.type||h.type==='Unknown').length,withMac:hosts.filter(h=>h.mac).length,
    warnings:Number(progress.warnings||0),errors:Number(progress.errors||0),truncated:Boolean(progress.truncated)
  };
}
function publicStatus(job){
  if(!job)return{state:'idle',running:false,paused:false,jobId:null,profile:null,target:null,startedAt:null,completedAt:null,progress:{total:0,scanned:0,current:null},summary:summary([],{}),hosts:[],findings:[],error:null};
  return{
    state:job.state,running:job.running,paused:job.paused,jobId:job.jobId,profile:job.profile,target:job.target,
    startedAt:job.startedAt,completedAt:job.completedAt||null,progress:{...job.progress},summary:summary(job.hosts,job.progress),
    hosts:job.hosts.map(x=>({...x})),findings:job.findings.map(x=>({...x})),savedScanId:job.savedScanId||null,error:job.error?{...job.error}:null,
    settings:{hostConcurrency:job.settings.hostConcurrency,serviceConcurrency:job.settings.serviceConcurrency,timeoutMs:job.settings.timeoutMs,useIcmp:job.settings.useIcmp,verifyModbus:job.settings.verifyModbus}
  };
}
async function enrichAliveHost(host,{profile,customPorts,timeoutMs,serviceConcurrency,verifyModbus,enrichWeb,signal,neighborMap,verifyEndpoint=verifyModbusEndpoint}={}){
  if(profile==='quick')return host;
  const services=await scanTcpServices(host.ip,{ports:profilePorts(profile,customPorts),timeoutMs,concurrency:serviceConcurrency,signal});
  const hostnames=host.hostnames?.length?host.hostnames:await reverseDns(host.ip,{timeoutMs:Math.max(500,timeoutMs*2)});
  const classes=classifyServices(services);let modbus=null;
  if(verifyModbus&&classes.modbusCandidates.length){
    for(const candidate of classes.modbusCandidates){
      const result=await verifyEndpoint({host:host.ip,port:candidate.port,unitIds:[1,255],timeoutMs:Math.max(350,timeoutMs*2),signal});
      if(result.verified){modbus={...result,port:candidate.port};break;}
      if(!modbus)modbus={...result,port:candidate.port};
    }
  }
  const metadata={};
  if(enrichWeb){
    const web=classes.web.slice(0,4);
    for(const svc of web){
      if(svc.port===443||svc.name==='HTTPS'){
        metadata[`https:${svc.port}`]=await fetchHttpMetadata(host.ip,svc.port,{httpsMode:true,timeoutMs:Math.max(700,timeoutMs*2),signal});
        metadata[`tls:${svc.port}`]=await fetchTlsCertificate(host.ip,svc.port,{timeoutMs:Math.max(800,timeoutMs*3),signal});
      }else metadata[`http:${svc.port}`]=await fetchHttpMetadata(host.ip,svc.port,{httpsMode:false,timeoutMs:Math.max(700,timeoutMs*2),signal});
    }
  }
  const neighbor=neighborMap?.get?.(host.ip),fp=buildHostFingerprint({ip:host.ip,hostname:hostnames[0]||host.hostname,hostnames,mac:neighbor?.mac||host.mac,macSource:neighbor?.source,services,modbus});
  const rtts=services.filter(x=>x.open&&Number.isFinite(x.rttMs)).map(x=>x.rttMs);
  return{...host,...fp,rawServices:services,metadata,avgRttMs:rtts.length?Math.round(rtts.reduce((a,b)=>a+b,0)/rtts.length*100)/100:host.avgRttMs,lastSeen:new Date().toISOString()};
}
class NetworkScanManager extends EventEmitter{
  constructor({store=null,getProjectId=()=>null,verifyModbus=verifyModbusEndpoint,discover=discoverHost,enrich=enrichAliveHost,neighbors=readNeighborTable}={}){
    super();this.store=store;this.getProjectId=getProjectId;this.verifyModbus=verifyModbus;this.discover=discover;this.enrich=enrich;this.neighbors=neighbors;this.job=null;this.controller=null;this._pauseWaiters=[];
  }
  status(){return publicStatus(this.job);}
  _emit(){const s=this.status();this.emit('status',s);return s;}
  _settings(input,profile,targetCount){
    const defaults=PROFILE_DEFAULTS[profile];
    const useIcmp=input.useIcmp===undefined?defaults.useIcmp:Boolean(input.useIcmp);
    return{
      hostConcurrency:Math.round(bounded(input.hostConcurrency,1,256,defaults.hostConcurrency)),
      serviceConcurrency:Math.round(bounded(input.serviceConcurrency,1,32,defaults.serviceConcurrency)),
      timeoutMs:Math.round(bounded(input.timeoutMs,80,5000,defaults.timeoutMs)),
      useIcmp,
      verifyModbus:input.verifyModbus===undefined?defaults.verifyModbus:Boolean(input.verifyModbus),
      enrichWeb:input.enrichWeb===undefined?defaults.enrichWeb:Boolean(input.enrichWeb),
      customPorts:Array.isArray(input.customPorts)?input.customPorts.slice(0,128):[],
      maxResults:Math.round(bounded(input.maxResults,128,10000,4096)),
      targetCount,
    };
  }
  start(input={}){
    if(this.job?.running){const e=new Error('A network scan is already running.');e.code='NETWORK_SCAN_BUSY';throw e;}
    const profile=normalizeProfile(input.profile),parsed=parseTargets({targets:input.targets??input.target,exclude:input.exclude,maxTargets:input.maxTargets??262144});
    if(parsed.hasPublicTargets&&input.confirmPublicTargets!==true){const e=new Error('Target includes public/non-local IPv4 addresses. Explicitly confirm public target scanning before starting.');e.code='PUBLIC_TARGET_CONFIRMATION_REQUIRED';e.publicCount=parsed.publicCount;throw e;}
    const jobId=crypto.randomUUID(),settings=this._settings(input,profile,parsed.count),controller=new AbortController(),target=Array.isArray(input.targets)?input.targets.join(', '):String(input.targets??input.target||'');
    const projectId=this.getProjectId?.()||'default';
    this.controller=controller;this.job={jobId,projectId,profile,target,parsed,settings,state:'running',running:true,paused:false,startedAt:Date.now(),completedAt:null,hosts:[],findings:[],error:null,progress:{total:parsed.count,scanned:0,current:null,stage:'host-discovery',warnings:0,errors:0,truncated:false}};
    this._run(this.job,controller).catch(()=>{});return this._emit();
  }
  pause(){if(!this.job?.running||this.job.paused)return this.status();this.job.paused=true;this.job.state='paused';return this._emit();}
  resume(){if(!this.job?.running||!this.job.paused)return this.status();this.job.paused=false;this.job.state='running';for(const resolve of this._pauseWaiters.splice(0))resolve();return this._emit();}
  cancel(){if(!this.job?.running)return this.status();this.job.state='cancelling';this.job.paused=false;for(const resolve of this._pauseWaiters.splice(0))resolve();this.controller?.abort();return this._emit();}
  async _waitIfPaused(job,signal){
    while(job.paused&&!signal.aborted)await new Promise(resolve=>this._pauseWaiters.push(resolve));
    if(signal.aborted){const e=new Error('Network scan cancelled.');e.code='NETWORK_SCAN_CANCELLED';throw e;}
  }
  async _scanIp(job,ip,neighborMap,signal){
    await this._waitIfPaused(job,signal);job.progress.current=ip;job.progress.stage='host-discovery';
    const base=await this.discover(ip,{profile:'quick',timeoutMs:job.settings.timeoutMs,serviceConcurrency:4,useIcmp:job.settings.useIcmp,signal,neighborMap,verifyModbus:null});
    job.progress.scanned++;
    if(!base.alive)return null;
    await this._waitIfPaused(job,signal);job.progress.stage='enrichment';
    return this.enrich(base,{profile:job.profile,customPorts:job.settings.customPorts,timeoutMs:job.settings.timeoutMs,serviceConcurrency:job.settings.serviceConcurrency,verifyModbus:job.settings.verifyModbus,enrichWeb:job.settings.enrichWeb,signal,neighborMap,verifyEndpoint:this.verifyModbus});
  }
  async _run(job,controller){
    const signal=controller.signal,neighborMap=await this.neighbors(),iterator=iterateTargets(job.parsed);let exhausted=false;
    const nextIp=()=>{if(exhausted)return null;const n=iterator.next();if(n.done){exhausted=true;return null;}return n.value;};
    const worker=async()=>{
      while(true){
        await this._waitIfPaused(job,signal);const ip=nextIp();if(!ip)return;
        try{
          const discovered=await this._scanIp(job,ip,neighborMap,signal);
          if(discovered){
            const host={...discovered,id:discovered.id||hostKey(discovered)};
            if(job.hosts.length<job.settings.maxResults){job.hosts.push(host);this.emit('host',{jobId:job.jobId,host:{...host}});}
            else job.progress.truncated=true;
          }
        }catch(error){
          if(error?.code==='NETWORK_SCAN_CANCELLED'||signal.aborted)throw error;
          job.progress.errors++;this.emit('scan-error',{jobId:job.jobId,ip,error});
        }
        if(job.progress.scanned%25===0||job.hosts.length&&job.progress.scanned%10===0)this._emit();
      }
    };
    try{
      const count=Math.min(job.settings.hostConcurrency,job.parsed.count||1);await Promise.all(Array.from({length:count},worker));
      job.progress.stage='neighbor-refresh';
      const refreshedNeighbors=await this.neighbors().catch(()=>new Map());
      const knownIps=new Set(job.hosts.map(h=>h.ip));
      for(const neighbor of refreshedNeighbors.values()){
        if(job.hosts.length>=job.settings.maxResults){job.progress.truncated=true;break;}
        if(!neighbor?.ip||knownIps.has(neighbor.ip)||!targetContains(job.parsed,neighbor.ip))continue;
        const base={id:null,ip:neighbor.ip,alive:true,state:'online',mac:neighbor.mac||null,macObservations:neighbor.macs||[neighbor.mac].filter(Boolean),hostname:null,hostnames:[],services:[],rawServices:[],industrial:false,modbus:null,type:'Unknown',typeConfidence:0,confidence:75,avgRttMs:null,firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString(),discoveryMethods:['neighbor-table'],evidence:[{field:'ip',value:neighbor.ip,source:'neighbor-refresh',confidence:100,status:'observed'},{field:'mac',value:neighbor.mac,source:'neighbor-table',confidence:95,status:'observed'}]};
        const host={...base,id:hostKey(base)};job.hosts.push(host);knownIps.add(host.ip);this.emit('host',{jobId:job.jobId,host:{...host}});
      }
      job.findings=duplicateFindings(job.hosts);job.progress.warnings=job.findings.length;job.progress.stage='complete';job.state='completed';job.running=false;job.completedAt=Date.now();
      const projectId=job.projectId;
      if(this.store){
        const merged=this.store.replaceScanHosts(projectId,job.hosts,'network-scan');job.hosts=merged;
        const saved=this.store.saveScan(projectId,{id:job.jobId,startedAt:new Date(job.startedAt).toISOString(),completedAt:new Date(job.completedAt).toISOString(),state:job.state,profile:job.profile,target:job.target,settings:job.settings,summary:summary(job.hosts,job.progress),findings:job.findings,hosts:job.hosts});
        this.store.setTopology?.(projectId,buildLogicalTopology(job.hosts));
        job.savedScanId=saved.id;
      }
      this._emit();this.emit('complete',this.status());
    }catch(error){
      const cancelled=error?.code==='NETWORK_SCAN_CANCELLED'||signal.aborted;job.state=cancelled?'cancelled':'error';job.running=false;job.paused=false;job.completedAt=Date.now();job.progress.stage=job.state;job.error=cancelled?null:{message:error?.message||String(error),code:error?.code||null};this._emit();
      if(cancelled&&this.store&&job.hosts.length){
        const projectId=job.projectId,merged=this.store.replaceScanHosts(projectId,job.hosts,'network-scan-partial');job.hosts=merged;this.store.saveScan(projectId,{id:job.jobId,startedAt:new Date(job.startedAt).toISOString(),completedAt:new Date(job.completedAt).toISOString(),state:'cancelled',profile:job.profile,target:job.target,settings:job.settings,summary:summary(job.hosts,job.progress),findings:duplicateFindings(job.hosts),hosts:job.hosts});
      }
      if(!cancelled)this.emit('error-state',error);
    }finally{if(this.controller===controller)this.controller=null;}
  }
  async close(){if(this.job?.running){this.cancel();for(let i=0;i<100&&this.job?.running;i++)await new Promise(r=>setTimeout(r,20));}}
}

module.exports={NetworkScanManager,PROFILE_DEFAULTS,normalizeProfile,summary,enrichAliveHost};
