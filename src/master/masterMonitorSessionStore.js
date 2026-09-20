'use strict';

const fs=require('node:fs');
const path=require('node:path');

class MasterMonitorSessionStoreError extends Error{
  constructor(code,message,details={}){
    super(message);
    this.name='MasterMonitorSessionStoreError';
    this.code=code;
    this.details={...details};
  }
}

function text(value,max=200){
  return String(value??'').slice(0,max);
}
function finite(value,fallback=0,{min=-Number.MAX_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER}={}){
  const n=Number(value);
  return Number.isFinite(n)&&n>=min&&n<=max?n:fallback;
}
function integer(value,fallback=0,{min=Number.MIN_SAFE_INTEGER,max=Number.MAX_SAFE_INTEGER}={}){
  const n=Number(value);
  return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;
}
function bool(value){return value===true;}

function normalizeConnection(input={}){
  const type=['rtu','ascii','tcp'].includes(String(input.type||'').toLowerCase())?String(input.type).toLowerCase():'rtu';
  return Object.freeze({
    type,
    path:text(input.path,512),
    baudRate:integer(input.baudRate,9600,{min:50,max:4000000}),
    parity:['none','even','odd','mark','space'].includes(String(input.parity||'').toLowerCase())?String(input.parity).toLowerCase():'none',
    dataBits:integer(input.dataBits,8,{min:5,max:8}),
    stopBits:[1,1.5,2].includes(Number(input.stopBits))?Number(input.stopBits):1,
    echoSuppression:bool(input.echoSuppression),
    rtsTxMode:['none','high-during-tx','low-during-tx'].includes(String(input.rtsTxMode||''))?String(input.rtsTxMode):'none',
    rtsSettleMs:integer(input.rtsSettleMs,0,{min:0,max:60000}),
    host:text(input.host,512),
    port:integer(input.port,502,{min:1,max:65535}),
    timeoutMs:integer(input.timeoutMs,1000,{min:50,max:60000}),
    retries:integer(input.retries,0,{min:0,max:10}),
    retryDelayMs:integer(input.retryDelayMs,100,{min:0,max:60000}),
    interRequestDelayMs:integer(input.interRequestDelayMs,0,{min:0,max:60000}),
  });
}
function normalizeDefinition(input={}){
  return Object.freeze({
    unitId:integer(input.unitId,1,{min:0,max:255}),
    functionCode:integer(input.functionCode,3,{min:1,max:255}),
    address:integer(input.address,0,{min:0,max:65535}),
    addressMode:['raw','reference'].includes(String(input.addressMode||''))?String(input.addressMode):'raw',
    quantity:integer(input.quantity,1,{min:1,max:2000}),
    pollIntervalMs:integer(input.pollIntervalMs,1000,{min:10,max:86400000}),
    timeoutMs:integer(input.timeoutMs,1000,{min:50,max:60000}),
    retries:integer(input.retries,0,{min:0,max:10}),
    retryDelayMs:integer(input.retryDelayMs,100,{min:0,max:60000}),
    interRequestDelayMs:integer(input.interRequestDelayMs,0,{min:0,max:60000}),
  });
}
function normalizeFormat(input={}){
  return Object.freeze({
    type:text(input.type||'uint16',40),
    scale:finite(input.scale,1,{min:-1e12,max:1e12}),
    offset:finite(input.offset,0,{min:-1e12,max:1e12}),
    precision:integer(input.precision,3,{min:0,max:12}),
    byteOrder:text(input.byteOrder||'ABCD',16),
  });
}
function normalizeSnapshot(input={}){
  const counters=input.counters&&typeof input.counters==='object'?input.counters:{};
  return Object.freeze({
    // Never persist rendered HTML from field-derived values. Definitions are
    // durable; live table rows are intentionally reconstructed by a fresh read.
    rowsHtml:'',
    gridSummary:text(input.gridSummary||'No data',200),
    counters:Object.freeze({
      tx:text(counters.tx||'0',32),
      rx:text(counters.rx||'0',32),
      errors:text(counters.errors||'0',32),
      timeouts:text(counters.timeouts||'0',32),
      avgRtt:text(counters.avgRtt||'—',32),
    }),
    capturedAt:finite(input.capturedAt,Date.now(),{min:0,max:Number.MAX_SAFE_INTEGER}),
  });
}
function normalizeBaseline(input){
  if(!input||typeof input!=='object')return null;
  return Object.freeze({
    connectedAt:finite(input.connectedAt,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    txRequests:integer(input.txRequests,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    rxResponses:integer(input.rxResponses,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    errors:integer(input.errors,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    timeouts:integer(input.timeouts,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
    retryAttempts:integer(input.retryAttempts,0,{min:0,max:Number.MAX_SAFE_INTEGER}),
  });
}
function normalizeSession(input,index){
  if(!input||typeof input!=='object'||Array.isArray(input)){
    throw new MasterMonitorSessionStoreError('INVALID_SESSION','Monitor session must be an object',{index});
  }
  const id=text(input.id,120).trim();
  if(!id||!/^[A-Za-z0-9._:-]+$/.test(id)){
    throw new MasterMonitorSessionStoreError('INVALID_SESSION_ID','Monitor session id is invalid',{index});
  }
  return Object.freeze({
    id,
    name:text(input.name||`Monitor ${index+1}`,80).trim()||`Monitor ${index+1}`,
    createdAt:finite(input.createdAt,Date.now(),{min:0,max:Number.MAX_SAFE_INTEGER}),
    updatedAt:finite(input.updatedAt,Date.now(),{min:0,max:Number.MAX_SAFE_INTEGER}),
    connection:normalizeConnection(input.connection),
    definition:normalizeDefinition(input.definition),
    format:normalizeFormat(input.format),
    snapshot:normalizeSnapshot(input.snapshot),
    counterBaseline:normalizeBaseline(input.counterBaseline),
  });
}
function normalizeMonitorStore(input={}){
  if(input&&input.version!=null&&Number(input.version)!==1){
    throw new MasterMonitorSessionStoreError('UNSUPPORTED_STORE_VERSION','Monitor session store version must be 1',{version:input.version});
  }
  const raw=Array.isArray(input?.sessions)?input.sessions:[];
  if(raw.length>100)throw new MasterMonitorSessionStoreError('SESSION_LIMIT','At most 100 Monitor Sessions may be stored',{count:raw.length});
  const sessions=raw.map(normalizeSession);
  const ids=new Set();
  for(const session of sessions){
    if(ids.has(session.id))throw new MasterMonitorSessionStoreError('DUPLICATE_SESSION_ID','Monitor session ids must be unique',{id:session.id});
    ids.add(session.id);
  }
  const requested=text(input?.activeId,120).trim();
  const activeId=requested&&ids.has(requested)?requested:(sessions[0]?.id||null);
  return Object.freeze({version:1,activeId,sessions:Object.freeze(sessions)});
}

class MasterMonitorSessionStore{
  constructor({dataDir,file=null}={}){
    if(!dataDir&&!file)throw new MasterMonitorSessionStoreError('DATA_DIR_REQUIRED','A data directory or file is required');
    this.file=path.resolve(file||path.join(dataDir,'master-monitor-sessions.json'));
  }
  load(){
    if(!fs.existsSync(this.file))return normalizeMonitorStore();
    let parsed;
    try{parsed=JSON.parse(fs.readFileSync(this.file,'utf8'));}
    catch(error){
      throw new MasterMonitorSessionStoreError('STORE_READ_FAILED','Saved Monitor Sessions could not be read safely',{file:this.file,cause:error.message});
    }
    try{return normalizeMonitorStore(parsed);}
    catch(error){
      if(error instanceof MasterMonitorSessionStoreError)throw error;
      throw new MasterMonitorSessionStoreError('STORE_INVALID','Saved Monitor Sessions are invalid',{file:this.file,cause:error.message});
    }
  }
  save(input){
    // Refuse to overwrite an unreadable existing store. This keeps recovery
    // possible instead of silently replacing the user's only durable copy.
    if(fs.existsSync(this.file))this.load();
    const normalized=normalizeMonitorStore(input);
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temp=`${this.file}.partial-${process.pid}-${Date.now()}`;
    try{
      fs.writeFileSync(temp,JSON.stringify(normalized,null,2)+'\n',{encoding:'utf8',flag:'wx'});
      fs.renameSync(temp,this.file);
    }catch(error){
      try{fs.rmSync(temp,{force:true});}catch{}
      throw new MasterMonitorSessionStoreError('STORE_WRITE_FAILED','Saved Monitor Sessions could not be written safely',{file:this.file,cause:error.message});
    }
    return normalized;
  }
}

module.exports={
  MasterMonitorSessionStore,
  MasterMonitorSessionStoreError,
  normalizeMonitorStore,
};
