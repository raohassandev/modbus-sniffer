'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {ChartService}=require('../v8/history/chartService');
const {RotatingJsonlLogger}=require('../v8/history/loggerService');

const RESERVED_EVENT_STREAM='protocol-events';

class LoggerTrendError extends Error{
  constructor(code,message,details={}){super(message);this.name='LoggerTrendError';this.code=code;this.details={...details};}
}

function safeId(value){
  const text=String(value||'').trim();
  if(!text||text.length>120||!/^[A-Za-z0-9._:-]+$/.test(text))throw new LoggerTrendError('INVALID_ID','ID must contain letters, digits, dot, underscore, colon or dash');
  return text;
}
function finite(value,fallback=null){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function normalizeSource(input={}){
  const mode=String(input.mode||input.sourceType||'sniffer').toLowerCase();
  if(!['sniffer','master'].includes(mode))throw new LoggerTrendError('INVALID_SOURCE','source.mode must be sniffer or master');
  const out={mode};
  if(input.deviceKey!=null)out.deviceKey=String(input.deviceKey);
  if(input.channelId!=null)out.channelId=String(input.channelId);
  if(input.connectionId!=null)out.connectionId=String(input.connectionId);
  if(input.unitId!=null)out.unitId=Number(input.unitId);
  if(input.functionCode!=null)out.functionCode=Number(input.functionCode);
  if(input.address!=null)out.address=Number(input.address);
  if(!Number.isInteger(out.unitId)||out.unitId<0||out.unitId>255)throw new LoggerTrendError('INVALID_SOURCE','source.unitId must be 0..255');
  if(!Number.isInteger(out.functionCode)||out.functionCode<1||out.functionCode>255)throw new LoggerTrendError('INVALID_SOURCE','source.functionCode must be 1..255');
  if(!Number.isInteger(out.address)||out.address<0||out.address>65535)throw new LoggerTrendError('INVALID_SOURCE','source.address must be 0..65535');
  return Object.freeze(out);
}
function normalizeProfile(input={},existing=null){
  const streamId=safeId(input.streamId||existing?.streamId);
  const source=normalizeSource(input.source||existing?.source||{});
  const mode=['every','fixed','change-only'].includes(input.mode)?input.mode:(existing?.mode||'fixed');
  const intervalMs=Math.max(1,Math.min(86400000,Number(input.intervalMs??existing?.intervalMs??1000)||1000));
  const maxPoints=Math.max(100,Math.min(100000,Number(input.maxPoints??existing?.maxPoints??10000)||10000));
  return Object.freeze({
    streamId,
    label:String(input.label??existing?.label??streamId).slice(0,200),
    unit:String(input.unit??existing?.unit??'').slice(0,80),
    source,
    mode,
    intervalMs,
    enabled:input.enabled==null?(existing?.enabled!==false):Boolean(input.enabled),
    maxPoints,
    createdAt:existing?.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString(),
  });
}
function pointMatches(profile,point){
  const s=profile.source;
  if(s.mode==='master'&&String(point.sourceType||'').toLowerCase()!=='master')return false;
  if(s.mode==='sniffer'&&String(point.sourceType||'').toLowerCase()!=='sniffer')return false;
  if(s.deviceKey&&point.deviceKey!==s.deviceKey)return false;
  if(s.channelId&&point.channelId!==s.channelId)return false;
  if(s.connectionId&&point.connectionId!==s.connectionId)return false;
  if(Number(point.unitId)!==s.unitId)return false;
  if(Number(point.functionCode)!==s.functionCode)return false;
  if(Number(point.address)!==s.address)return false;
  return true;
}
function passivePoints(tx){
  if(!tx||tx.direction!=='RSP')return[];
  const d=tx.decoded||{};
  const identity={
    sourceType:'Sniffer',
    deviceKey:tx.deviceKey||d.deviceKey||null,
    channelId:tx.channelId||d.channelId||null,
    connectionId:tx.channelId||d.channelId||null,
    unitId:tx.unitId??tx.slaveId??d.unitId??d.slaveId,
    functionCode:tx.functionCode??d.functionCode,
    timestamp:Number(tx.timestamp||Date.now()),
    quality:tx.exception?'exception':'good',
  };
  const out=[];
  if(Array.isArray(d.registers)){
    for(const reg of d.registers)out.push({...identity,address:Number(reg.address),rawValue:Number(reg.value),value:Number(reg.value)});
  }
  if(Array.isArray(d.points)){
    for(const point of d.points)out.push({...identity,address:Number(point.address),rawValue:point.value?1:0,value:Boolean(point.value)});
  }
  return out;
}

class StableLoggerTrendService extends EventEmitter{
  constructor({state,masterRuntime,dataDir=path.join(process.cwd(),'data','logger-trend'),clock=()=>Date.now(),maxEvents=5000}={}){
    super();
    if(!state||typeof state.on!=='function')throw new TypeError('state is required');
    if(!masterRuntime||typeof masterRuntime.on!=='function')throw new TypeError('masterRuntime is required');
    this.state=state;this.masterRuntime=masterRuntime;this.dataDir=path.resolve(dataDir);this.clock=clock;this.maxEvents=maxEvents;
    fs.mkdirSync(this.dataDir,{recursive:true});
    this.profilePath=path.join(this.dataDir,'profiles.json');
    this.profiles=new Map();
    this.chart=new ChartService({maxDocuments:128,defaultMaxPoints:10000});
    this.logger=new RotatingJsonlLogger({directory:path.join(this.dataDir,'samples'),prefix:'modbus',retentionFiles:50,maxBytes:25*1024*1024,immediateFlush:false});
    this.logger.addStream({streamId:RESERVED_EVENT_STREAM,source:{kind:'protocol-evidence'},mode:'every',intervalMs:1});
    this.events=[];
    this._onTransaction=tx=>{for(const point of passivePoints(tx))this.ingestPoint(point);this.ingestEvidence({...tx,sourceType:'Sniffer',connectionId:tx.connectionId||tx.channelId||null});};
    this._onMasterPoint=point=>this.ingestPoint(point);
    state.on('transaction',this._onTransaction);
    masterRuntime.on('point',this._onMasterPoint);
    this._loadProfiles();
  }

  _loadProfiles(){
    let rows=[];
    try{rows=JSON.parse(fs.readFileSync(this.profilePath,'utf8'));}catch{/* no saved profiles */}
    if(!Array.isArray(rows))return;
    for(const row of rows){
      try{this._installProfile(normalizeProfile(row),false);}catch{/* skip invalid persisted entry */}
    }
  }
  _persistProfiles(){
    const tmp=this.profilePath+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.listProfiles(),null,2));
    try{fs.rmSync(this.profilePath,{force:true});}catch{}
    fs.renameSync(tmp,this.profilePath);
  }
  _installProfile(profile,persist=true){
    const existing=this.profiles.get(profile.streamId);
    if(existing){
      try{this.logger.removeStream(profile.streamId);}catch{}
      try{this.chart.removeDocument(profile.streamId);}catch{}
    }
    this.profiles.set(profile.streamId,profile);
    this.logger.addStream({streamId:profile.streamId,source:profile.source,mode:profile.mode,intervalMs:profile.intervalMs});
    if(!profile.enabled)this.logger.updateStream(profile.streamId,{enabled:false});
    this.chart.createDocument({documentId:profile.streamId,title:profile.label,maxPoints:profile.maxPoints});
    this.chart.addSeries(profile.streamId,{seriesId:'value',label:profile.label,unit:profile.unit,source:profile.source});
    if(persist)this._persistProfiles();
    return this.getProfile(profile.streamId);
  }
  saveProfile(input){
    const existing=input?.streamId?this.profiles.get(String(input.streamId)):null;
    return this._installProfile(normalizeProfile(input,existing||null),true);
  }
  removeProfile(streamId){
    const id=safeId(streamId);
    if(!this.profiles.has(id))throw new LoggerTrendError('PROFILE_NOT_FOUND',`Unknown logger profile ${id}`);
    this.profiles.delete(id);
    try{this.logger.removeStream(id);}catch{}
    try{this.chart.removeDocument(id);}catch{}
    this._persistProfiles();
    return true;
  }
  listProfiles(){return Object.freeze([...this.profiles.values()].map(profile=>Object.freeze(clone(profile))));}
  getProfile(streamId){
    const profile=this.profiles.get(String(streamId));
    if(!profile)throw new LoggerTrendError('PROFILE_NOT_FOUND',`Unknown logger profile ${streamId}`);
    return Object.freeze(clone(profile));
  }

  ingestPoint(point){
    if(!point||!Number.isFinite(Number(point.address)))return 0;
    let written=0;
    for(const profile of this.profiles.values()){
      if(!profile.enabled||!pointMatches(profile,point))continue;
      const numeric=typeof point.value==='boolean'?(point.value?1:0):Number(point.value??point.rawValue);
      if(!Number.isFinite(numeric))continue;
      const timestamp=Number(point.timestamp||this.clock());
      try{
        const accepted=this.logger.ingest(profile.streamId,{timestamp,value:numeric,quality:point.quality||'good',metadata:{...point,sourceKey:profile.streamId}});
        if(accepted){
          this.chart.appendSample(profile.streamId,'value',{timestamp,value:numeric,quality:point.quality||'good',raw:point.rawValue});
          written++;
          this.emit('sample',Object.freeze({streamId:profile.streamId,timestamp,value:numeric,quality:point.quality||'good'}));
        }
      }catch(error){this.emit('error',error);}
    }
    return written;
  }

  ingestEvidence(row){
    if(!row||typeof row!=='object')return false;
    const event={timestamp:Number(row.timestamp||this.clock()),sourceType:row.sourceType||'Sniffer',direction:row.direction||null,unitId:row.unitId??row.slaveId??null,functionCode:row.functionCode??null,connectionId:row.connectionId||row.channelId||null,rttMs:finite(row.rttMs),timeoutMs:finite(row.timeoutMs),exception:Boolean(row.exception),rawHex:row.rawHex||'',eventType:row.eventType||null};
    this.events.push(Object.freeze(event));
    if(this.events.length>this.maxEvents)this.events.splice(0,this.events.length-this.maxEvents);
    try{this.logger.ingest(RESERVED_EVENT_STREAM,{timestamp:event.timestamp,value:event,quality:event.exception?'exception':'good',metadata:{kind:'protocol-event'}});}catch(error){this.emit('error',error);return false;}
    return true;
  }

  recentEvents({limit=500,sourceType=null}={}){
    const max=Math.max(1,Math.min(this.maxEvents,Number(limit)||500));
    const rows=sourceType?this.events.filter(e=>e.sourceType===sourceType):this.events;
    return Object.freeze(rows.slice(-max));
  }
  querySeries(streamId,{from=-Infinity,to=Infinity,maxPoints=1000}={}){
    this.getProfile(streamId);
    return this.chart.querySeries(streamId,'value',{from:finite(from,-Infinity),to:finite(to,Infinity),maxPoints:Math.max(2,Math.min(10000,Number(maxPoints)||1000))});
  }
  exportCsv(streamId){this.getProfile(streamId);return this.chart.exportCsv(streamId);}
  status(){
    return Object.freeze({profiles:this.listProfiles(),logger:this.logger.status(),eventCount:this.events.length,dataDir:this.dataDir});
  }
  shutdown(){
    this.state.off('transaction',this._onTransaction);
    this.masterRuntime.off('point',this._onMasterPoint);
    try{this.logger.close();}catch{}
  }
}

module.exports={
  LoggerTrendError,
  RESERVED_EVENT_STREAM,
  StableLoggerTrendService,
  normalizeProfile,
  normalizeSource,
  passivePoints,
  pointMatches,
};
