'use strict';

const crypto=require('crypto');
const {EventEmitter}=require('events');
const {scanTcpDeviceIds,scanRtuDeviceIds}=require('./activeDiscovery');

function busyError(){const e=new Error('An active discovery scan is already running.');e.code='DISCOVERY_BUSY';return e;}
function normalizeTransport(value){const t=String(value||'').trim().toUpperCase();if(!['TCP','RTU'].includes(t)){const e=new Error('Discovery transport must be TCP or RTU.');e.code='DISCOVERY_TRANSPORT_REQUIRED';throw e;}return t;}
function resultSummary(results=[]){return{checked:results.length,responding:results.filter(r=>r?.responded).length,identified:results.filter(r=>r?.identificationSupported&&Array.isArray(r?.objects)&&r.objects.length).length,unsupported:results.filter(r=>r?.responded&&r?.identificationSupported===false).length,silent:results.filter(r=>!r?.responded).length};}

class ActiveDiscoveryManager extends EventEmitter{
  constructor({scanTcp=scanTcpDeviceIds,scanRtu=scanRtuDeviceIds}={}){
    super();this.scanTcp=scanTcp;this.scanRtu=scanRtu;this.job=null;this.controller=null;this.promise=null;
  }

  status(){
    if(!this.job)return{state:'idle',running:false,jobId:null,transport:null,startedAt:null,completedAt:null,progress:null,summary:resultSummary(),results:[],result:null,error:null,cancelRequested:false};
    const j=this.job,results=Array.isArray(j.results)?j.results:[];
    return{state:j.state,running:j.running,jobId:j.jobId,transport:j.transport,startedAt:j.startedAt,completedAt:j.completedAt||null,progress:j.progress?{...j.progress}:null,summary:resultSummary(results),results:results.map(x=>({...x})),result:j.result||null,error:j.error?{...j.error}:null,cancelRequested:Boolean(j.cancelRequested)};
  }

  _emit(){const s=this.status();this.emit('status',s);return s;}

  start(config={}){
    if(this.job?.running)throw busyError();
    const transport=normalizeTransport(config.transport),jobId=crypto.randomUUID(),controller=new AbortController();
    const job={jobId,transport,state:'running',running:true,startedAt:Date.now(),completedAt:null,progress:null,results:[],result:null,error:null,cancelRequested:false};
    this.job=job;this.controller=controller;
    const onProgress=p=>{
      if(this.job?.jobId!==jobId)return;
      const result=p?.result?{...p.result}:null;
      if(result){const idx=job.results.findIndex(x=>Number(x.unitId)===Number(result.unitId));if(idx>=0)job.results[idx]=result;else job.results.push(result);job.results.sort((a,b)=>Number(a.unitId)-Number(b.unitId));}
      job.progress={current:Number(p?.current)||0,total:Number(p?.total)||0,unitId:p?.unitId??null,transport:p?.transport||transport};this._emit();
    };
    const runner=transport==='TCP'?this.scanTcp:this.scanRtu;
    const scanConfig={...config,transport:undefined,signal:controller.signal,onProgress};delete scanConfig.transport;
    this.promise=Promise.resolve().then(()=>runner(scanConfig)).then(result=>{
      if(this.job?.jobId!==jobId)return result;
      job.result=result;job.results=Array.isArray(result?.results)?result.results.map(x=>({...x})):job.results;job.state='completed';job.running=false;job.completedAt=Date.now();job.error=null;this.controller=null;this._emit();return result;
    }).catch(error=>{
      if(this.job?.jobId!==jobId)throw error;
      const cancelled=error?.code==='DISCOVERY_CANCELLED'||controller.signal.aborted;
      job.state=cancelled?'cancelled':'error';job.running=false;job.completedAt=Date.now();job.error=cancelled?null:{message:error?.message||String(error),code:error?.code||null};this.controller=null;this._emit();if(!cancelled)this.emit('scan-error',error);return null;
    });
    this._emit();return this.status();
  }

  cancel(){
    if(!this.job?.running)return this.status();
    this.job.cancelRequested=true;this.job.state='cancelling';this.controller?.abort();return this._emit();
  }

  async close(){if(this.job?.running)this.cancel();try{await this.promise;}catch{}return this.status();}
}

module.exports={ActiveDiscoveryManager,normalizeTransport,resultSummary};
