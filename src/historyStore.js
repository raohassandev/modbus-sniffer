'use strict';

const fs = require('fs');
const path = require('path');

function safeId(id) { return String(id||'default').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,120); }

class HistoryStore {
  constructor({ dataDir = path.join(process.cwd(),'data','history'), maxFileBytes = 25 * 1024 * 1024 } = {}) { this.dataDir=dataDir; this.maxFileBytes=maxFileBytes; fs.mkdirSync(dataDir,{recursive:true}); }
  _file(projectId){return path.join(this.dataDir,`${safeId(projectId)}.jsonl`);}
  append(projectId, snapshot) {
    const file=this._file(projectId); this._rotate(file); fs.appendFileSync(file,`${JSON.stringify({...snapshot,recordedAt:snapshot.recordedAt||Date.now()})}\n`); return true;
  }
  query(projectId,{limit=500,since=null}={}) {
    const file=this._file(projectId); if(!fs.existsSync(file))return[]; const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean); const out=[];
    for(let i=lines.length-1;i>=0&&out.length<Math.max(1,Math.min(10000,Number(limit)||500));i--){try{const x=JSON.parse(lines[i]);if(since==null||Number(x.recordedAt)>=Number(since))out.push(x);}catch{}}
    return out.reverse();
  }
  clear(projectId){const file=this._file(projectId);if(fs.existsSync(file))fs.unlinkSync(file);return true;}
  _rotate(file){try{if(fs.statSync(file).size<this.maxFileBytes)return;const old=`${file}.1`;try{fs.unlinkSync(old);}catch{}fs.renameSync(file,old);}catch{}}
}

class HistoryRecorder {
  constructor({ state, workspaces, history, intervalMs=10000 }={}){this.state=state;this.workspaces=workspaces;this.history=history;this.intervalMs=Math.max(1000,intervalMs);this.timer=null;}
  snapshot(){const p=this.workspaces.getActiveProject();if(!p)return null;const s=this.state.getStatus();const a=this.state.getAnalysis();const devices=this.state.getDevices();const snap={recordedAt:Date.now(),totals:s.totals,rates:a.rates,healthScore:a.healthScore,connection:s.connection,devices:devices.map(d=>({slaveId:d.slaveId,status:d.status,healthScore:d.healthScore,requests:d.requests,responses:d.responses,timeouts:d.timeouts,avgRttMs:d.avgRttMs,p95RttMs:d.p95RttMs,registerCount:d.registerCount,pollGroupCount:d.pollGroupCount}))};this.history.append(p.id,snap);return snap;}
  start(){if(this.timer)return;this.timer=setInterval(()=>{try{this.snapshot();}catch{}},this.intervalMs);this.timer.unref?.();}
  stop(){clearInterval(this.timer);this.timer=null;}
}

module.exports={HistoryStore,HistoryRecorder};
