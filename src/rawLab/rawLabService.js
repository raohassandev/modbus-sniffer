'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {
  ConnectionBroker,SerialTransport,TcpClientTransport,RawFrameStudio
}=require('../modbusCore');
const {buildConformanceCases}=require('./conformanceCases');

class RawLabError extends Error{
  constructor(code,message,details={}){super(message);this.name='RawLabError';this.code=code;this.details={...details};}
}
function integer(v,fallback,{min=0,max=65535,field='value'}={}){
  const n=Number(v);if(!Number.isInteger(n)){if(fallback!==undefined)return fallback;throw new RawLabError('INVALID_ARGUMENT',`${field} must be an integer`,{field,value:v});}
  if(n<min||n>max)throw new RawLabError('INVALID_ARGUMENT',`${field} must be ${min}..${max}`,{field,value:n});return n;
}
function normalizeConfig(input={}){
  const type=String(input.type||'tcp').toLowerCase();
  if(!['rtu','ascii','tcp'].includes(type))throw new RawLabError('INVALID_TRANSPORT','Raw Lab supports RTU, ASCII or TCP',{type});
  if(type==='tcp'){
    const host=String(input.host||'').trim();if(!host)throw new RawLabError('INVALID_ARGUMENT','TCP host is required');
    return Object.freeze({type,host,port:integer(input.port,502,{min:1,max:65535,field:'port'}),localAddress:String(input.localAddress||'').trim()||null,timeoutMs:integer(input.timeoutMs,1000,{min:50,max:60000,field:'timeoutMs'})});
  }
  const serialPath=String(input.path||'').trim();if(!serialPath)throw new RawLabError('INVALID_ARGUMENT','Serial port is required');
  const parity=String(input.parity||'none').toLowerCase();
  if(!['none','even','odd','mark','space'].includes(parity))throw new RawLabError('INVALID_ARGUMENT','Unsupported parity');
  return Object.freeze({
    type,path:serialPath,baudRate:integer(input.baudRate,9600,{min:50,max:4000000,field:'baudRate'}),
    dataBits:integer(input.dataBits,8,{min:5,max:8,field:'dataBits'}),stopBits:Number(input.stopBits??1),parity,
    echoSuppression:input.echoSuppression===true,rtsTxMode:String(input.rtsTxMode||'none'),rtsSettleMs:integer(input.rtsSettleMs,0,{min:0,max:60000,field:'rtsSettleMs'}),
    timeoutMs:integer(input.timeoutMs,1000,{min:50,max:60000,field:'timeoutMs'})
  });
}
function resultView(result){
  if(!result)return null;
  return Object.freeze({ok:Boolean(result.ok),intent:result.intent||null,classification:result.classification||null,responseValidation:result.responseValidation||null,requestRawHex:result.requestRaw?Buffer.from(result.requestRaw).toString('hex').toUpperCase():null,responseRawHex:result.responseRaw?Buffer.from(result.responseRaw).toString('hex').toUpperCase():null,rttMs:result.rttMs??null});
}
class StableRawLabService extends EventEmitter{
  constructor({dataDir=path.join(process.cwd(),'data','raw-lab')}={}){
    super();this.dataDir=path.resolve(dataDir);fs.mkdirSync(this.dataDir,{recursive:true});this.casePath=path.join(this.dataDir,'cases.json');
    this.broker=null;this.studio=null;this.transport=null;this.connectionId=null;this.config=null;this._relay=null;this.cases=this._loadCases();this.runs=[];this.maxRuns=50;
  }
  _loadCases(){try{const rows=JSON.parse(fs.readFileSync(this.casePath,'utf8'));return Array.isArray(rows)?rows:[];}catch{return[];}}
  _saveCases(){fs.writeFileSync(this.casePath,JSON.stringify(this.cases,null,2));}
  listCases(){return Object.freeze(this.cases.map(x=>Object.freeze(JSON.parse(JSON.stringify(x)))));}
  saveCase(input={}){
    const id=String(input.id||input.name||'').trim().toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,100);
    if(!id)throw new RawLabError('INVALID_CASE','Case id/name is required');
    const row={id,name:String(input.name||id).slice(0,160),framing:String(input.framing||this.config?.type||'rtu'),hex:String(input.hex||''),autoChecksum:input.autoChecksum!==false,expectResponse:input.expectResponse!==false,timeoutMs:integer(input.timeoutMs,this.config?.timeoutMs||1000,{min:50,max:60000,field:'timeoutMs'}),expectedHex:input.expectedHex==null?null:String(input.expectedHex),expectedMaskHex:input.expectedMaskHex==null?null:String(input.expectedMaskHex),updatedAt:new Date().toISOString()};
    const index=this.cases.findIndex(x=>x.id===id);if(index>=0)this.cases[index]=row;else this.cases.push(row);this._saveCases();return Object.freeze({...row});
  }
  removeCase(id){const index=this.cases.findIndex(x=>x.id===String(id));if(index<0)return false;this.cases.splice(index,1);this._saveCases();return true;}
  exportCases(){
    return Object.freeze({schemaVersion:1,kind:'modbus-raw-lab-cases',exportedAt:new Date().toISOString(),cases:this.listCases()});
  }
  importCases(payload={}, {replace=false}={}){
    if(!payload||typeof payload!=='object'||Number(payload.schemaVersion)!==1||payload.kind!=='modbus-raw-lab-cases'||!Array.isArray(payload.cases))throw new RawLabError('INVALID_CASE_BUNDLE','Raw Lab case bundle is invalid');
    if(payload.cases.length>500)throw new RawLabError('CASE_LIMIT','A case bundle may contain at most 500 cases');
    if(replace)this.cases=[];
    const imported=[];
    for(const row of payload.cases)imported.push(this.saveCase(row));
    return Object.freeze({imported:imported.length,total:this.cases.length,cases:this.listCases()});
  }
  presets({unitId=1,timeoutMs=null}={}){
    if(!this.config)throw new RawLabError('SESSION_NOT_OPEN','Open a Raw Lab connection before generating framing-specific presets');
    return buildConformanceCases({framing:this.config.type,unitId:integer(unitId,1,{min:1,max:this.config.type==='tcp'?255:247,field:'unitId'}),timeoutMs:integer(timeoutMs,this.config.timeoutMs||1000,{min:50,max:60000,field:'timeoutMs'})});
  }
  listRuns(){return Object.freeze(this.runs.map(x=>Object.freeze(JSON.parse(JSON.stringify(x)))).reverse());}
  getRun(runId){const run=this.runs.find(x=>x.runId===String(runId));if(!run)throw new RawLabError('RUN_NOT_FOUND','Raw Lab conformance run not found',{runId});return Object.freeze(JSON.parse(JSON.stringify(run)));}
  async runConformanceSuite({presetIds=null,unitId=1,timeoutMs=null,interCaseMs=50,confirmation=null}={}){
    if(!this.studio||!this.config)throw new RawLabError('SESSION_NOT_OPEN','Open a Raw Lab connection before running conformance presets');
    const all=this.presets({unitId,timeoutMs}),wanted=Array.isArray(presetIds)&&presetIds.length?new Set(presetIds.map(String)):null;
    const cases=wanted?all.filter(x=>wanted.has(x.id)):all;
    if(!cases.length)throw new RawLabError('NO_CASES','No matching conformance presets were selected');
    const startedAt=Date.now(),results=[];
    for(let index=0;index<cases.length;index++){
      const item=cases[index];
      if(item.labRequired&&(!this.studio.status().labArmed||confirmation?.raw!==true)){
        results.push({id:item.id,name:item.name,status:'skipped',reason:'LAB arming and raw confirmation required',labRequired:true});
      }else{
        const start=Date.now();
        try{
          const result=await this.send({hex:item.hex,autoChecksum:false,expectResponse:item.expectResponse,timeoutMs:item.timeoutMs,expectedHex:item.expectedHex,expectedMaskHex:item.expectedMaskHex,responsePolicy:item.labRequired?'matching':'success',confirmation:{raw:confirmation?.raw===true,write:false}});
          results.push({id:item.id,name:item.name,status:'passed',labRequired:item.labRequired,elapsedMs:Date.now()-start,result});
        }catch(error){
          results.push({id:item.id,name:item.name,status:'failed',labRequired:item.labRequired,elapsedMs:Date.now()-start,error:{code:error?.code||null,message:String(error?.message||error),details:error?.details||null}});
        }
      }
      if(index+1<cases.length&&Number(interCaseMs)>0)await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(0,Number(interCaseMs)||0))));
    }
    const run={runId:crypto.randomUUID(),schemaVersion:1,kind:'modbus-conformance-run',startedAt,completedAt:Date.now(),config:{...this.config},unitId:Number(unitId),results,summary:{total:results.length,passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,skipped:results.filter(x=>x.status==='skipped').length},audit:this.audit(5000)};
    this.runs.push(run);if(this.runs.length>this.maxRuns)this.runs.splice(0,this.runs.length-this.maxRuns);
    this.emit('suite',Object.freeze(JSON.parse(JSON.stringify(run))));
    return this.getRun(run.runId);
  }
  status(){
    return Object.freeze({configured:Boolean(this.studio),config:this.config?Object.freeze({...this.config}):null,studio:this.studio?.status?.()||null,cases:this.cases.length,runs:this.runs.length});
  }
  async open(input={}){
    const config=normalizeConfig(input);await this.close();
    const transport=config.type==='tcp'
      ?new TcpClientTransport({host:config.host,port:config.port,localAddress:config.localAddress,connectTimeoutMs:3000})
      :new SerialTransport({path:config.path,baudRate:config.baudRate,dataBits:config.dataBits,stopBits:config.stopBits,parity:config.parity,framing:config.type,echoSuppression:config.echoSuppression,rtsTxMode:config.rtsTxMode,rtsSettleMs:config.rtsSettleMs});
    const broker=new ConnectionBroker(),connectionId=`stable-raw-lab-${Date.now().toString(36)}`;
    broker.defineConnection({connectionId,resourceKey:config.type==='tcp'?`tcp:${config.host}:${config.port}`:`serial:${config.path.toLowerCase()}`,transportKind:config.type==='tcp'?'tcp-client':`serial-${config.type}`,transport,metadata:{productMode:'raw-lab'},exclusive:true});
    const studio=new RawFrameStudio({broker,connectionId,ownerId:'stable-raw-lab',framing:config.type});
    const relay=e=>this.emit('event',e);studio.on('event',relay);
    this.broker=broker;this.transport=transport;this.connectionId=connectionId;this.config=config;this.studio=studio;this._relay=relay;
    try{await studio.open();return this.status();}catch(error){await this.close();throw error;}
  }
  preview(input={}){
    if(!this.studio)throw new RawLabError('SESSION_NOT_OPEN','Open a Raw Lab connection first');
    const raw=this.studio.prepare(input);return Object.freeze({rawHex:raw.toString('hex').toUpperCase(),classification:this.studio.classify(raw)});
  }
  armLab(input={}){if(!this.studio)throw new RawLabError('SESSION_NOT_OPEN','Open a Raw Lab connection first');return this.studio.armLab(input);}
  disarmLab(reason='manual'){if(!this.studio)return this.status();this.studio.disarmLab(reason);return this.status();}
  async send(input={}){
    if(!this.studio)throw new RawLabError('SESSION_NOT_OPEN','Open a Raw Lab connection first');
    const preview=this.preview(input),isWrite=preview.classification.category==='write';
    let writeArmed=false;
    try{
      if(isWrite){
        if(input.confirmation?.write!==true)throw new RawLabError('WRITE_CONFIRMATION_REQUIRED','Validated write frames require explicit write confirmation');
        this.studio.setWriteEnabled(true);writeArmed=true;
      }
      return resultView(await this.studio.send(input));
    }finally{
      if(writeArmed){try{this.studio.setWriteEnabled(false);}catch{}}
    }
  }
  async repeat(input={}){
    const count=integer(input.count,1,{min:1,max:1000,field:'count'}),intervalMs=integer(input.intervalMs,0,{min:0,max:600000,field:'intervalMs'}),results=[];
    for(let i=0;i<count;i++){results.push(await this.send(input));if(i+1<count&&intervalMs>0)await new Promise(resolve=>setTimeout(resolve,intervalMs));}
    return Object.freeze(results);
  }
  audit(limit=200){return this.studio?this.studio.listAudit({limit:Math.max(1,Math.min(5000,Number(limit)||200))}):Object.freeze([]);}
  async close(){
    const studio=this.studio;
    if(studio&&this._relay)studio.off('event',this._relay);
    this.studio=null;this._relay=null;this.transport=null;this.connectionId=null;this.config=null;
    if(studio){try{await studio.close({release:true});}catch{}}
    this.broker=null;return this.status();
  }
}
module.exports={RawLabError,StableRawLabService,normalizeConfig,resultView};
