'use strict';

const fs = require('fs');
const path = require('path');

function safeId(id) { return String(id||'default').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,120); }
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function finite(v,fallback){const n=Number(v);return Number.isFinite(n)?n:fallback;}

class HistoryStore {
  constructor({
    dataDir = path.join(process.cwd(),'data','history'),
    maxFileBytes = 25 * 1024 * 1024,
    maxTotalBytes = 100 * 1024 * 1024,
    retentionMs = 30 * 24 * 60 * 60 * 1000,
    maxSegments = 4,
    readChunkBytes = 64 * 1024
  } = {}) {
    this.dataDir=dataDir;
    this.maxFileBytes=Math.max(64*1024,finite(maxFileBytes,25*1024*1024));
    this.maxTotalBytes=Math.max(this.maxFileBytes,finite(maxTotalBytes,100*1024*1024));
    this.retentionMs=Math.max(0,finite(retentionMs,30*24*60*60*1000));
    this.maxSegments=Math.max(1,Math.min(32,Math.trunc(finite(maxSegments,4))));
    this.readChunkBytes=Math.max(4096,Math.min(1024*1024,Math.trunc(finite(readChunkBytes,64*1024))));
    fs.mkdirSync(dataDir,{recursive:true});
  }

  _file(projectId){return path.join(this.dataDir,`${safeId(projectId)}.jsonl`);}
  _segment(file,n){return `${file}.${n}`;}
  _filesNewestFirst(projectId){
    const file=this._file(projectId),out=[];
    if(fs.existsSync(file))out.push(file);
    for(let i=1;i<=this.maxSegments;i++){const p=this._segment(file,i);if(fs.existsSync(p))out.push(p);}
    return out;
  }

  _repairPartialTail(file){
    if(!fs.existsSync(file))return null;
    const st=fs.statSync(file);if(!st.size)return null;
    const fd=fs.openSync(file,'r+');
    try{
      const n=Math.min(st.size,this.readChunkBytes),buf=Buffer.alloc(n),start=st.size-n;
      fs.readSync(fd,buf,0,n,start);
      if(buf[buf.length-1]===0x0A)return null;
      const lastLf=buf.lastIndexOf(0x0A),tail=buf.subarray(lastLf+1),tailText=tail.toString('utf8').replace(/\r$/,'').trim();
      if(!tailText)return null;
      try{
        JSON.parse(tailText);
        fs.writeSync(fd,Buffer.from('\n'),0,1,st.size);
        return {repaired:true,action:'newline-appended',bytes:tail.length};
      }catch{
        const cutoff=lastLf>=0?start+lastLf+1:start;
        const preserved=`${file}.partial-${stamp()}.txt`;
        fs.writeFileSync(preserved,tail);
        fs.ftruncateSync(fd,cutoff);
        return {repaired:true,action:'partial-truncated',bytes:tail.length,preserved};
      }
    }finally{fs.closeSync(fd);}
  }

  _rotate(file){
    try{
      if(!fs.existsSync(file)||fs.statSync(file).size<this.maxFileBytes)return;
      const oldest=this._segment(file,this.maxSegments);try{fs.unlinkSync(oldest);}catch{}
      for(let i=this.maxSegments-1;i>=1;i--){const from=this._segment(file,i),to=this._segment(file,i+1);if(fs.existsSync(from)){try{fs.renameSync(from,to);}catch{try{fs.copyFileSync(from,to);fs.unlinkSync(from);}catch{}}}}
      try{fs.renameSync(file,this._segment(file,1));}catch{fs.copyFileSync(file,this._segment(file,1));fs.truncateSync(file,0);}
    }catch{}
  }

  _enforceRetention(file){
    const candidates=[];
    for(let i=this.maxSegments;i>=1;i--){const p=this._segment(file,i);if(fs.existsSync(p))candidates.push(p);}
    if(fs.existsSync(file))candidates.push(file);
    const now=Date.now();
    if(this.retentionMs>0){
      for(const p of candidates.slice()){
        if(p===file)continue;
        try{if(now-fs.statSync(p).mtimeMs>this.retentionMs)fs.unlinkSync(p);}catch{}
      }
    }
    const existing=candidates.filter(p=>fs.existsSync(p));
    let total=existing.reduce((sum,p)=>{try{return sum+fs.statSync(p).size;}catch{return sum;}},0);
    for(const p of existing){
      if(total<=this.maxTotalBytes)break;
      if(p===file)continue;
      try{const n=fs.statSync(p).size;fs.unlinkSync(p);total-=n;}catch{}
    }
  }

  append(projectId, snapshot) {
    const file=this._file(projectId);
    this._repairPartialTail(file);
    this._rotate(file);
    fs.appendFileSync(file,`${JSON.stringify({...snapshot,recordedAt:snapshot.recordedAt||Date.now()})}\n`);
    this._enforceRetention(file);
    return true;
  }

  _readNewest(file,maxRows,accept){
    if(!fs.existsSync(file)||maxRows<=0)return[];
    const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size,out=[];
    let pos=size,carry=Buffer.alloc(0);
    const parse=lineBuf=>{
      let b=lineBuf;
      if(b.length&&b[b.length-1]===0x0D)b=b.subarray(0,b.length-1);
      if(!b.length)return;
      try{const x=JSON.parse(b.toString('utf8'));if(accept(x))out.push(x);}catch{}
    };
    try{
      while(pos>0&&out.length<maxRows){
        const start=Math.max(0,pos-this.readChunkBytes),len=pos-start,chunk=Buffer.alloc(len);fs.readSync(fd,chunk,0,len,start);
        const combined=carry.length?Buffer.concat([chunk,carry]):chunk;
        let end=combined.length;
        for(let i=combined.length-1;i>=0&&out.length<maxRows;i--){
          if(combined[i]===0x0A){parse(combined.subarray(i+1,end));end=i;}
        }
        carry=Buffer.from(combined.subarray(0,end));pos=start;
      }
      if(pos===0&&carry.length&&out.length<maxRows)parse(carry);
    }finally{fs.closeSync(fd);}
    return out;
  }

  query(projectId,{limit=500,since=null,channelId=null,deviceKey=null}={}) {
    const max=Math.max(1,Math.min(10000,Number(limit)||500)),file=this._file(projectId);
    this._repairPartialTail(file);
    const accept=x=>{
      if(since!=null&&Number(x.recordedAt)<Number(since))return false;
      if(!channelId&&!deviceKey)return true;
      const selectedDevice=deviceKey?(x.devices||[]).find(d=>d.deviceKey===deviceKey):null;
      const selectedChannelId=channelId||selectedDevice?.channelId||null;
      if(deviceKey&&!selectedDevice)return false;
      if(selectedChannelId&&!(x.channels||[]).some(c=>c.channelId===selectedChannelId)&&!(x.devices||[]).some(d=>d.channelId===selectedChannelId))return false;
      x.channels=(x.channels||[]).filter(c=>!selectedChannelId||c.channelId===selectedChannelId);
      x.devices=(x.devices||[]).filter(d=>(!selectedChannelId||d.channelId===selectedChannelId)&&(!deviceKey||d.deviceKey===deviceKey));
      x.historyFilter={channelId:selectedChannelId,deviceKey:deviceKey||null};
      return true;
    };
    const newest=[];
    for(const p of this._filesNewestFirst(projectId)){
      if(newest.length>=max)break;
      newest.push(...this._readNewest(p,max-newest.length,accept));
    }
    return newest.slice(0,max).reverse();
  }

  clear(projectId){
    const file=this._file(projectId);
    for(const p of [file,...Array.from({length:this.maxSegments},(_,i)=>this._segment(file,i+1))]){try{fs.unlinkSync(p);}catch{}}
    try{for(const name of fs.readdirSync(this.dataDir))if(name.startsWith(`${path.basename(file)}.partial-`))fs.unlinkSync(path.join(this.dataDir,name));}catch{}
    return true;
  }
}

class HistoryRecorder {
  constructor({ state, workspaces, history, intervalMs=10000 }={}){this.state=state;this.workspaces=workspaces;this.history=history;this.intervalMs=Math.max(1000,intervalMs);this.timer=null;}
  snapshot(){
    const p=this.workspaces.getActiveProject();if(!p)return null;
    const s=this.state.getStatus(),a=this.state.getAnalysis(),devices=this.state.getDevices();
    const snap={
      schemaVersion:2,recordedAt:Date.now(),totals:s.totals,rates:a.rates,healthScore:a.healthScore,healthAggregation:a.healthAggregation||null,connection:s.connection,
      channels:(s.channels||[]).map(c=>({channelId:c.channelId,transport:c.transport,mode:c.mode,name:c.name,endpoint:c.endpoint||null,deviceCount:c.deviceCount||0,healthScore:c.healthScore??null,health:c.health||null})),
      devices:devices.map(d=>({deviceKey:d.deviceKey,channelId:d.channelId,transport:d.transport,unitId:d.unitId,slaveId:d.slaveId,status:d.status,healthScore:d.healthScore,requests:d.requests,responses:d.responses,timeouts:d.timeouts,avgRttMs:d.avgRttMs,p95RttMs:d.p95RttMs,registerCount:d.registerCount,pollGroupCount:d.pollGroupCount}))
    };
    this.history.append(p.id,snap);return snap;
  }
  start(){if(this.timer)return;this.timer=setInterval(()=>{try{this.snapshot();}catch{}},this.intervalMs);this.timer.unref?.();}
  stop(){clearInterval(this.timer);this.timer=null;}
}

module.exports={HistoryStore,HistoryRecorder};
