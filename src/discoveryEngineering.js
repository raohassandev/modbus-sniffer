'use strict';

const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {registerCodec}=require('./modbusCore');

class DiscoveryEngineeringError extends Error{
  constructor(code,message,details={}){super(message);this.name='DiscoveryEngineeringError';this.code=code;this.details={...details};}
}
function int(v,d,{min=0,max=65535,field='value'}={}){
  const n=Number(v);if(!Number.isInteger(n)){if(d!==undefined)return d;throw new DiscoveryEngineeringError('INVALID_ARGUMENT',field+' must be an integer',{field,value:v});}
  if(n<min||n>max)throw new DiscoveryEngineeringError('INVALID_ARGUMENT',field+' must be '+min+'..'+max,{field,value:n});return n;
}
function delay(ms){return ms>0?new Promise(r=>setTimeout(r,ms)):Promise.resolve();}
function safeError(error){return{code:error?.code||null,message:String(error?.message||error),details:error?.details||null};}
function clone(v){return JSON.parse(JSON.stringify(v));}
const DEFAULT_PROBE_FCS=Object.freeze([1,2,3,4,7,8,11,12,17,24,43]);

class DiscoveryEngineeringService extends EventEmitter{
  constructor({masterRuntime,maxRuns=20}={}){
    super();if(!masterRuntime)throw new TypeError('masterRuntime is required');this.master=masterRuntime;this.maxRuns=maxRuns;this.runs=new Map();
  }
  _assertMaster(){const s=this.master.status();if(!s.connected)throw new DiscoveryEngineeringError('MASTER_NOT_CONNECTED','Connect stable Master before engineering discovery.');return s;}
  _save(type,input,result){
    const run={runId:crypto.randomUUID(),type,createdAt:Date.now(),master:this.master.status().config||null,input:clone(input),result:clone(result)};
    this.runs.set(run.runId,run);while(this.runs.size>this.maxRuns)this.runs.delete(this.runs.keys().next().value);
    this.emit('result',Object.freeze(clone(run)));return Object.freeze(clone(run));
  }
  listRuns(){return Object.freeze([...this.runs.values()].map(clone).reverse());}
  getRun(id){const r=this.runs.get(String(id));if(!r)throw new DiscoveryEngineeringError('DISCOVERY_RUN_NOT_FOUND','Engineering discovery run not found',{runId:id});return Object.freeze(clone(r));}

  async scanUnits(input={}){
    const status=this._assertMaster(),framing=status.config?.type||'rtu';
    const maxUnit=framing==='tcp'?255:247,start=int(input.unitStart,1,{min:1,max:maxUnit,field:'unitStart'}),end=int(input.unitEnd,20,{min:start,max:maxUnit,field:'unitEnd'});
    const functionCode=int(input.functionCode,3,{min:1,max:4,field:'functionCode'}),address=int(input.address,0,{min:0,max:65535,field:'address'});
    const quantity=int(input.quantity,1,{min:1,max:functionCode<=2?2000:125,field:'quantity'}),timeoutMs=int(input.timeoutMs,500,{min:50,max:60000,field:'timeoutMs'}),interRequestMs=int(input.interRequestMs,40,{min:0,max:10000,field:'interRequestMs'});
    const results=[];
    for(let unitId=start;unitId<=end;unitId++){
      const started=Date.now();
      try{
        const out=await this.master.read({unitId,functionCode,address,quantity,timeoutMs});
        results.push({unitId,responded:true,rttMs:out.rttMs,values:out.rows.map(r=>r.value),raw:out.rows.map(r=>r.rawValue),error:null});
      }catch(error){
        results.push({unitId,responded:false,rttMs:Date.now()-started,values:[],raw:[],error:safeError(error)});
      }
      this.emit('progress',{type:'unit-scan',current:unitId-start+1,total:end-start+1,unitId,result:results.at(-1)});
      if(unitId<end)await delay(interRequestMs);
    }
    return this._save('unit-scan',input,{transport:framing.toUpperCase(),functionCode,address,quantity,results,responding:results.filter(x=>x.responded).length});
  }

  async scanRange(input={}){
    this._assertMaster();
    const unitId=int(input.unitId,1,{min:1,max:255,field:'unitId'}),functionCode=int(input.functionCode,3,{min:1,max:4,field:'functionCode'});
    const start=int(input.addressStart,0,{min:0,max:65535,field:'addressStart'}),end=int(input.addressEnd,start+31,{min:start,max:65535,field:'addressEnd'});
    const chunkMax=functionCode<=2?2000:125,chunk=int(input.chunk,Math.min(16,end-start+1),{min:1,max:chunkMax,field:'chunk'});
    if(end-start+1>4096)throw new DiscoveryEngineeringError('SCAN_TOO_LARGE','Address scan is limited to 4096 points per run.');
    const timeoutMs=int(input.timeoutMs,500,{min:50,max:60000,field:'timeoutMs'}),interRequestMs=int(input.interRequestMs,30,{min:0,max:10000,field:'interRequestMs'});
    const blocks=[],points=[];
    for(let address=start;address<=end;address+=chunk){
      const quantity=Math.min(chunk,end-address+1);
      try{
        const out=await this.master.read({unitId,functionCode,address,quantity,timeoutMs});
        const rows=out.rows.map(r=>({address:r.address,value:r.value,rawValue:r.rawValue,reference:r.reference}));
        blocks.push({address,quantity,ok:true,rttMs:out.rttMs,rows});points.push(...rows);
      }catch(error){blocks.push({address,quantity,ok:false,rttMs:null,rows:[],error:safeError(error)});}
      this.emit('progress',{type:'range-scan',current:Math.min(end,address+chunk-1)-start+1,total:end-start+1,address,result:blocks.at(-1)});
      if(address+chunk<=end)await delay(interRequestMs);
    }
    const words=points.filter(p=>Number.isInteger(Number(p.rawValue))).slice(0,8).map(p=>Number(p.rawValue)&0xFFFF);
    return this._save('range-scan',input,{unitId,functionCode,addressStart:start,addressEnd:end,chunk,blocks,points,interpretations:registerCodec.interpretationMatrix(words)});
  }

  async probeFunctions(input={}){
    const status=this._assertMaster(),framing=status.config?.type||'rtu';
    const unitId=int(input.unitId,1,{min:1,max:framing==='tcp'?255:247,field:'unitId'}),address=int(input.address,0,{min:0,max:65535,field:'address'}),timeoutMs=int(input.timeoutMs,500,{min:50,max:60000,field:'timeoutMs'});
    const requested=Array.isArray(input.functionCodes)&&input.functionCodes.length?input.functionCodes:DEFAULT_PROBE_FCS;
    const functionCodes=[...new Set(requested.map(x=>int(x,undefined,{min:1,max:255,field:'functionCode'})))].slice(0,32),results=[];
    for(const functionCode of functionCodes){
      try{
        let out;
        if([1,2,3,4].includes(functionCode))out=await this.master.read({unitId,functionCode,address,quantity:1,timeoutMs});
        else if(functionCode===8)out=await this.master.advanced({unitId,functionCode,subFunction:0,data:0,timeoutMs,labConfirmed:false});
        else if(functionCode===24)out=await this.master.advanced({unitId,functionCode,address,timeoutMs});
        else if(functionCode===43)out=await this.master.advanced({unitId,functionCode,readDeviceIdCode:1,objectId:0,timeoutMs});
        else out=await this.master.advanced({unitId,functionCode,timeoutMs});
        results.push({functionCode,supported:true,rttMs:out.rttMs??null,decoded:out.decoded??out.result?.decoded??null,error:null});
      }catch(error){
        const code=error?.code||null,exception=error?.details?.exceptionCode??null;
        results.push({functionCode,supported:code==='MODBUS_EXCEPTION'?exception!==1:false,rttMs:error?.details?.rttMs??null,exceptionCode:exception,error:safeError(error)});
      }
      this.emit('progress',{type:'function-probe',current:results.length,total:functionCodes.length,functionCode,result:results.at(-1)});
      if(results.length<functionCodes.length)await delay(int(input.interRequestMs,40,{min:0,max:10000,field:'interRequestMs'}));
    }
    return this._save('function-probe',input,{unitId,address,transport:framing.toUpperCase(),results});
  }

  async probeQuantities(input={}){
    this._assertMaster();
    const unitId=int(input.unitId,1,{min:1,max:255,field:'unitId'}),functionCode=int(input.functionCode,3,{min:1,max:4,field:'functionCode'}),address=int(input.address,0,{min:0,max:65535,field:'address'}),timeoutMs=int(input.timeoutMs,500,{min:50,max:60000,field:'timeoutMs'});
    const max=functionCode<=2?2000:125,defaultQ=functionCode<=2?[1,8,32,64,128,256,512,1000,2000]:[1,2,4,8,16,32,64,100,125];
    const quantities=[...new Set((Array.isArray(input.quantities)&&input.quantities.length?input.quantities:defaultQ).map(x=>int(x,undefined,{min:1,max,field:'quantity'})))].sort((a,b)=>a-b),results=[];
    for(const quantity of quantities){
      try{const out=await this.master.read({unitId,functionCode,address,quantity,timeoutMs});results.push({quantity,ok:true,rttMs:out.rttMs,count:out.rows.length,error:null});}
      catch(error){results.push({quantity,ok:false,rttMs:error?.details?.rttMs??null,error:safeError(error)});if(input.stopOnFailure!==false)break;}
      this.emit('progress',{type:'quantity-probe',current:results.length,total:quantities.length,quantity,result:results.at(-1)});
      await delay(int(input.interRequestMs,40,{min:0,max:10000,field:'interRequestMs'}));
    }
    const lastOk=[...results].reverse().find(x=>x.ok);
    return this._save('quantity-probe',input,{unitId,functionCode,address,results,maxWorkingQuantity:lastOk?.quantity??null});
  }

  monitorDefinition(runId){
    const run=this.getRun(runId);
    if(run.type==='range-scan')return Object.freeze({unitId:run.result.unitId,functionCode:run.result.functionCode,address:run.result.addressStart,quantity:Math.min(125,run.result.addressEnd-run.result.addressStart+1),name:`Discovery Unit ${run.result.unitId} FC${run.result.functionCode} ${run.result.addressStart}-${run.result.addressEnd}`});
    if(run.type==='unit-scan'){const unit=run.result.results.find(x=>x.responded);if(!unit)throw new DiscoveryEngineeringError('NO_RESPONDING_UNIT','Unit scan has no responding device.');return Object.freeze({unitId:unit.unitId,functionCode:run.result.functionCode,address:run.result.address,quantity:run.result.quantity,name:`Discovery Unit ${unit.unitId}`});}
    throw new DiscoveryEngineeringError('RUN_NOT_ADOPTABLE','Only unit/range scans can be adopted into a Monitor.');
  }

  simulatorDefinition(runId){
    const run=this.getRun(runId);if(run.type!=='range-scan')throw new DiscoveryEngineeringError('RUN_NOT_ADOPTABLE','Only range scans can seed a simulator map.');
    const area={1:'coils',2:'discreteInputs',3:'holdingRegisters',4:'inputRegisters'}[run.result.functionCode];
    return Object.freeze({unitId:run.result.unitId,area,address:run.result.addressStart,values:run.result.points.sort((a,b)=>a.address-b.address).map(p=>p.value),readOnly:['discreteInputs','inputRegisters'].includes(area)});
  }
}
module.exports={DEFAULT_PROBE_FCS,DiscoveryEngineeringError,DiscoveryEngineeringService};