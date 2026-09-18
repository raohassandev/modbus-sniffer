'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {
  ConnectionBroker,SerialTransport,TcpClientTransport,RawFrameStudio
}=require('../modbusCore');

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
  return Object.freeze({ok:Boolean(result.ok),intent:result.intent||null,classification:result.classification||null,requestRawHex:result.requestRaw?Buffer.from(result.requestRaw).toString('hex').toUpperCase():null,responseRawHex:result.responseRaw?Buffer.from(result.responseRaw).toString('hex').toUpperCase():null,rttMs:result.rttMs??null});
}
class StableRawLabService extends EventEmitter{
  constructor({dataDir=path.join(process.cwd(),'data','raw-lab')}={}){
    super();this.dataDir=path.resolve(dataDir);fs.mkdirSync(this.dataDir,{recursive:true});this.casePath=path.join(this.dataDir,'cases.json');
    this.broker=null;this.studio=null;this.transport=null;this.connectionId=null;this.config=null;this._relay=null;this.cases=this._loadCases();
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
  status(){
    return Object.freeze({configured:Boolean(this.studio),config:this.config?Object.freeze({...this.config}):null,studio:this.studio?.status?.()||null,cases:this.cases.length});
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
