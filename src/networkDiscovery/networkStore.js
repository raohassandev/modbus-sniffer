'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {normalizeMac}=require('./deviceFingerprint');

const MAX_STORE_BYTES=64*1024*1024;
const MAX_HOSTS=10000;
const MAX_SCANS=24;
const MAX_BASELINES=8;
const MAX_EVENTS=10000;

function clone(v){return JSON.parse(JSON.stringify(v));}
function now(){return new Date().toISOString();}
function safeId(prefix='network'){return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;}
function projectKey(v){return String(v||'default').slice(0,180);}
function cleanText(v,max=1000){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);}
function hostKey(host={}){
  const mac=normalizeMac(host.mac);if(mac)return`mac:${mac}`;
  const ip=cleanText(host.ip,80);return ip?`ip:${ip}`:safeId('host');
}
function serviceKey(s){return`${String(s.protocol||'tcp').toLowerCase()}:${Number(s.port)}`;}
function normalizedServices(list=[]){
  const map=new Map();for(const s of list||[]){const port=Number(s.port);if(!Number.isInteger(port)||port<1||port>65535)continue;map.set(serviceKey(s),{port,protocol:String(s.protocol||'tcp').toLowerCase().slice(0,12),name:cleanText(s.name,120),category:cleanText(s.category,80),rttMs:Number.isFinite(Number(s.rttMs))?Number(s.rttMs):null,source:cleanText(s.source,80),confidence:Math.max(0,Math.min(100,Number(s.confidence)||0)),status:cleanText(s.status||'observed',40)});}return[...map.values()].sort((a,b)=>a.port-b.port);
}
function signature(host={}){
  return JSON.stringify({ip:host.ip||null,mac:normalizeMac(host.mac),hostname:host.hostname||null,type:host.type||null,services:normalizedServices(host.services).map(s=>[s.protocol,s.port,s.name]),modbus:Boolean(host.modbus?.verified),modbusPort:host.modbus?.port||null});
}
function compactHostSnapshot(input={}){
  const units=(input.modbusUnits||[]).slice(0,256).map(row=>{
    const i=row.identification||{};
    return{unitId:Number(row.unitId),identificationSupported:row.identificationSupported??null,identification:{vendorName:cleanText(i.vendorName,160)||null,productCode:cleanText(i.productCode,160)||null,productName:cleanText(i.productName,160)||null,modelName:cleanText(i.modelName,160)||null,revision:cleanText(i.revision,160)||null,userApplicationName:cleanText(i.userApplicationName,160)||null}};
  }).filter(row=>Number.isInteger(row.unitId)&&row.unitId>=0&&row.unitId<=255);
  return{
    id:cleanText(input.id||hostKey(input),180),scannerId:cleanText(input.scannerId||'local',120)||'local',
    ip:cleanText(input.ip,80),mac:normalizeMac(input.mac),macVendor:cleanText(input.macVendor,200)||null,
    hostname:cleanText(input.hostname,255)||null,type:cleanText(input.type||'Unknown',160)||'Unknown',
    classification:['trusted','unknown','unexpected','ignored','decommissioned'].includes(input.classification)?input.classification:'unknown',
    state:cleanText(input.state||'unknown',40),industrial:Boolean(input.industrial),
    services:normalizedServices(input.services),
    modbus:{verified:Boolean(input.modbus?.verified),port:Number(input.modbus?.port)||null,unitId:Number.isInteger(Number(input.modbus?.unitId))?Number(input.modbus.unitId):null},
    modbusUnits:units,firstSeen:input.firstSeen||null,lastSeen:input.lastSeen||null,lastChanged:input.lastChanged||null
  };
}
function normalizeHost(input={},existing=null){
  const stamp=now(),mac=normalizeMac(input.mac),ip=cleanText(input.ip,80),id=existing?.id||hostKey({mac,ip});
  return{
    ...(existing||{}),...clone(input),id,scannerId:cleanText(input.scannerId??existing?.scannerId??'local',120)||'local',ip,mac,hostname:cleanText(input.hostname??existing?.hostname,255)||null,
    hostnames:Array.isArray(input.hostnames)?input.hostnames.map(x=>cleanText(x,255)).filter(Boolean).slice(0,16):(existing?.hostnames||[]),
    services:normalizedServices(input.services??existing?.services??[]),
    classification:['trusted','unknown','unexpected','ignored','decommissioned'].includes(input.classification)?input.classification:(existing?.classification||'unknown'),
    notes:cleanText(input.notes??existing?.notes,4000),tags:Array.isArray(input.tags)?[...new Set(input.tags.map(x=>cleanText(x,80)).filter(Boolean))].slice(0,64):(existing?.tags||[]),
    firstSeen:existing?.firstSeen||input.firstSeen||stamp,lastSeen:input.lastSeen||stamp,lastChanged:existing?.lastChanged||input.lastChanged||stamp,
    updatedAt:stamp
  };
}
function unitIdentity(row={}){
  const i=row.identification||{};
  return JSON.stringify({
    unitId:Number(row.unitId),supported:row.identificationSupported??null,
    vendor:i.vendorName||null,productCode:i.productCode||null,product:i.productName||null,
    model:i.modelName||null,revision:i.revision||null,application:i.userApplicationName||null
  });
}
function diffHost(before,after){
  if(!before)return[{field:'host',before:null,after:'added'}];
  const changes=[];
  for(const field of ['ip','mac','macVendor','hostname','type','classification'])if((before[field]??null)!==(after[field]??null))changes.push({field,before:before[field]??null,after:after[field]??null});
  const b=new Set(normalizedServices(before.services).map(serviceKey)),a=new Set(normalizedServices(after.services).map(serviceKey));
  for(const x of a)if(!b.has(x))changes.push({field:'service-opened',before:null,after:x});
  for(const x of b)if(!a.has(x))changes.push({field:'service-closed',before:x,after:null});
  if(Boolean(before.modbus?.verified)!==Boolean(after.modbus?.verified))changes.push({field:'modbus-verification',before:Boolean(before.modbus?.verified),after:Boolean(after.modbus?.verified)});
  const bu=new Map((before.modbusUnits||[]).filter(x=>Number.isInteger(Number(x.unitId))).map(x=>[Number(x.unitId),unitIdentity(x)]));
  const au=new Map((after.modbusUnits||[]).filter(x=>Number.isInteger(Number(x.unitId))).map(x=>[Number(x.unitId),unitIdentity(x)]));
  for(const [unitId,sig] of au){
    if(!bu.has(unitId))changes.push({field:'modbus-unit-added',before:null,after:unitId});
    else if(bu.get(unitId)!==sig)changes.push({field:'modbus-identity-changed',unitId,before:bu.get(unitId),after:sig});
  }
  for(const unitId of bu.keys())if(!au.has(unitId))changes.push({field:'modbus-unit-removed',before:unitId,after:null});
  return changes;
}
class NetworkStore{
  constructor({dataDir=path.join(process.cwd(),'data'),file=null}={}){
    this.file=file||path.join(dataDir,'network-discovery.json');this.backup=`${this.file}.bak`;fs.mkdirSync(path.dirname(this.file),{recursive:true});this.db=this._load();
  }
  _empty(){return{version:1,projects:{}};}
  _load(){
    const tryRead=file=>{const raw=fs.readFileSync(file,'utf8');if(Buffer.byteLength(raw)>MAX_STORE_BYTES)throw new Error('Network discovery store exceeds the 64 MB safety limit.');const x=JSON.parse(raw);if(Number(x?.version)!==1||!x.projects||typeof x.projects!=='object')throw new Error('Unsupported network discovery store schema.');return x;};
    if(!fs.existsSync(this.file)){if(fs.existsSync(this.backup)){const x=tryRead(this.backup);fs.copyFileSync(this.backup,this.file);return x;}return this._empty();}
    try{return tryRead(this.file);}catch(error){
      if(fs.existsSync(this.backup)){
        const recovered=tryRead(this.backup);
        try{fs.copyFileSync(this.file,`${this.file}.corrupt-${Date.now()}`);}catch{}
        fs.copyFileSync(this.backup,this.file);
        return recovered;
      }
      throw error;
    }
  }
  _atomic(){
    let json=JSON.stringify(this.db),passes=0;
    while(Buffer.byteLength(json)>MAX_STORE_BYTES&&passes++<100){
      let changed=false;
      for(const p of Object.values(this.db.projects||{})){
        if((p.scans||[]).length>4){p.scans.shift();changed=true;}
        else if((p.events||[]).length>2000){p.events.splice(0,Math.min(500,p.events.length-2000));changed=true;}
        else if((p.baselines||[]).length>2){p.baselines.shift();changed=true;}
      }
      if(!changed)break;
      json=JSON.stringify(this.db);
    }
    if(Buffer.byteLength(json)>MAX_STORE_BYTES)throw new Error('Network discovery store exceeds the 64 MB safety limit after bounded history pruning.');
    const tmp=`${this.file}.tmp-${process.pid}-${crypto.randomUUID()}`;
    fs.writeFileSync(tmp,json,{encoding:'utf8',mode:0o600});try{const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{}
    const existed=fs.existsSync(this.file);
    if(existed)fs.copyFileSync(this.file,this.backup);
    try{fs.renameSync(tmp,this.file);}
    catch(error){
      if(!existed||!['EPERM','EEXIST','ENOTEMPTY','EACCES'].includes(error?.code)){try{fs.unlinkSync(tmp);}catch{}throw error;}
      try{
        fs.unlinkSync(this.file);
        fs.renameSync(tmp,this.file);
      }catch(second){
        try{if(!fs.existsSync(this.file)&&fs.existsSync(this.backup))fs.copyFileSync(this.backup,this.file);}catch{}
        try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
        throw second;
      }
    }
  }
  _project(projectId){
    const key=projectKey(projectId);if(!this.db.projects[key])this.db.projects[key]={hosts:{},scans:[],baselines:[],events:[],topology:{nodes:[],edges:[]}};return this.db.projects[key];
  }
  mergeHost(projectId,input={},source='scan'){
    const p=this._project(projectId),mac=normalizeMac(input.mac),ip=cleanText(input.ip,80);
    let existing=Object.values(p.hosts).find(h=>(mac&&normalizeMac(h.mac)===mac)||(ip&&h.ip===ip))||null;
    const before=existing?clone(existing):null,merged=normalizeHost(input,existing);
    const changes=diffHost(before,merged);if(changes.length)merged.lastChanged=now();
    if(existing&&existing.id!==merged.id)delete p.hosts[existing.id];p.hosts[merged.id]=merged;
    if(changes.length)this.addEvent(projectId,{type:before?'host-changed':'host-discovered',hostId:merged.id,ip:merged.ip,source,changes},{persist:false});
    this._trimProject(p);this._atomic();return clone(merged);
  }
  replaceScanHosts(projectId,hosts=[],source='scan'){
    const out=[];for(const h of hosts.slice(0,4096)){const p=this._project(projectId),mac=normalizeMac(h.mac),ip=cleanText(h.ip,80),existing=Object.values(p.hosts).find(x=>(mac&&normalizeMac(x.mac)===mac)||(ip&&x.ip===ip))||null,before=existing?clone(existing):null,merged=normalizeHost(h,existing),changes=diffHost(before,merged);if(changes.length)merged.lastChanged=now();if(existing&&existing.id!==merged.id)delete p.hosts[existing.id];p.hosts[merged.id]=merged;if(changes.length)p.events.push({id:safeId('event'),at:now(),type:before?'host-changed':'host-discovered',hostId:merged.id,ip:merged.ip,source,changes});out.push(clone(merged));}
    const p=this._project(projectId);this._trimProject(p);this._atomic();return out;
  }
  listHosts(projectId,{state=null,search=null,modbus=null,classification=null,limit=4096}={}){
    let rows=Object.values(this._project(projectId).hosts);if(state)rows=rows.filter(x=>x.state===state);if(modbus!=null)rows=rows.filter(x=>Boolean(x.modbus?.verified)===Boolean(modbus));if(classification)rows=rows.filter(x=>x.classification===classification);
    const q=cleanText(search,200).toLowerCase();if(q)rows=rows.filter(x=>[x.ip,x.mac,x.hostname,x.type,...(x.hostnames||[]),...(x.services||[]).map(s=>s.name)].some(v=>String(v||'').toLowerCase().includes(q)));
    return rows.sort((a,b)=>String(a.ip).localeCompare(String(b.ip),undefined,{numeric:true})).slice(0,Math.max(1,Math.min(4096,Number(limit)||4096))).map(clone);
  }
  getHost(projectId,id){const x=this._project(projectId).hosts[String(id)];return x?clone(x):null;}
  updateHost(projectId,id,patch={}){
    const p=this._project(projectId),prev=p.hosts[String(id)];if(!prev)return null;const allowed={classification:patch.classification,notes:patch.notes,tags:patch.tags};const next=normalizeHost({...prev,...allowed},prev);const changes=diffHost(prev,next);if(changes.length){next.lastChanged=now();p.events.push({id:safeId('event'),at:now(),type:'host-user-update',hostId:next.id,ip:next.ip,source:'user',changes});}p.hosts[next.id]=next;this._trimProject(p);this._atomic();return clone(next);
  }
  saveScan(projectId,input={}){
    const p=this._project(projectId),scan={id:cleanText(input.id,180)||safeId('scan'),startedAt:input.startedAt||now(),completedAt:input.completedAt||now(),state:cleanText(input.state||'completed',40),profile:cleanText(input.profile||'standard',40),target:cleanText(input.target,2000),settings:clone(input.settings||{}),summary:clone(input.summary||{}),findings:clone((input.findings||[]).slice(0,1024)),hosts:(input.hosts||[]).slice(0,MAX_HOSTS).map(compactHostSnapshot)};
    p.scans=[...p.scans.filter(x=>x.id!==scan.id),scan].slice(-100);this._trimProject(p);this._atomic();return clone(scan);
  }
  listScans(projectId){return this._project(projectId).scans.slice().reverse().map(s=>({id:s.id,startedAt:s.startedAt,completedAt:s.completedAt,state:s.state,profile:s.profile,target:s.target,summary:clone(s.summary),hostCount:s.hosts.length,findingsCount:s.findings.length}));}
  getScan(projectId,id){const x=this._project(projectId).scans.find(s=>s.id===String(id));return x?clone(x):null;}
  saveBaseline(projectId,scanId,name='Reference Network'){
    const p=this._project(projectId),scan=p.scans.find(s=>s.id===String(scanId));if(!scan)throw Object.assign(new Error('Network scan not found.'),{code:'NETWORK_SCAN_NOT_FOUND'});
    const b={id:safeId('baseline'),scanId:scan.id,name:cleanText(name,160)||'Reference Network',createdAt:now(),hosts:clone(scan.hosts),summary:clone(scan.summary)};
    p.baselines=[...p.baselines,b].slice(-10);this._atomic();return clone(b);
  }
  listBaselines(projectId){return this._project(projectId).baselines.slice().reverse().map(b=>({id:b.id,scanId:b.scanId,name:b.name,createdAt:b.createdAt,hostCount:b.hosts.length,summary:clone(b.summary)}));}
  compare(projectId,{leftScanId=null,rightScanId=null,baselineId=null}={}){
    const p=this._project(projectId),left=baselineId?p.baselines.find(x=>x.id===String(baselineId)):p.scans.find(x=>x.id===String(leftScanId)),right=p.scans.find(x=>x.id===String(rightScanId));
    if(!left||!right)throw Object.assign(new Error('Both comparison sources are required.'),{code:'NETWORK_COMPARE_SOURCE_NOT_FOUND'});
    const key=h=>normalizeMac(h.mac)||`ip:${h.ip}`,a=new Map((left.hosts||[]).map(h=>[key(h),h])),b=new Map((right.hosts||[]).map(h=>[key(h),h])),added=[],removed=[],changed=[],unchanged=[];
    for(const [k,h] of b){if(!a.has(k))added.push(h);else{const before=a.get(k),changes=diffHost(before,h);(changes.length?changed:unchanged).push(changes.length?{before,after:h,changes}:h);}}
    for(const [k,h] of a)if(!b.has(k))removed.push(h);
    return{left:{id:left.id,name:left.name||left.id},right:{id:right.id},summary:{added:added.length,removed:removed.length,changed:changed.length,unchanged:unchanged.length},added,removed,changed,unchanged};
  }
  addEvent(projectId,input={},options={}){
    const p=this._project(projectId),event={id:safeId('event'),at:input.at||now(),type:cleanText(input.type||'network-event',80),hostId:input.hostId?cleanText(input.hostId,180):null,ip:input.ip?cleanText(input.ip,80):null,source:cleanText(input.source||'network-discovery',80),...clone(input)};
    p.events.push(event);this._trimProject(p);if(options.persist!==false)this._atomic();return clone(event);
  }
  listEvents(projectId,{limit=500,hostId=null,ip=null,type=null}={}){const p=this._project(projectId);let rows=p.events;if(hostId)rows=rows.filter(x=>String(x.hostId||'')===String(hostId));if(ip)rows=rows.filter(x=>String(x.ip||'')===String(ip));if(type)rows=rows.filter(x=>String(x.type||'')===String(type));return rows.slice(-Math.max(1,Math.min(5000,Number(limit)||500))).reverse().map(clone);}
  setTopology(projectId,topology={}){const p=this._project(projectId);p.topology={nodes:clone((topology.nodes||[]).slice(0,4096)),edges:clone((topology.edges||[]).slice(0,8192)),updatedAt:now()};this._atomic();return clone(p.topology);}
  getTopology(projectId){return clone(this._project(projectId).topology||{nodes:[],edges:[]});}
  exportProject(projectId){
    const p=this._project(projectId);
    return clone({
      version:1,projectId:projectKey(projectId),exportedAt:now(),
      hosts:Object.values(p.hosts||{}),scans:p.scans||[],baselines:p.baselines||[],
      events:p.events||[],topology:p.topology||{nodes:[],edges:[]}
    });
  }
  _trimProject(p){
    const hosts=Object.values(p.hosts);if(hosts.length>MAX_HOSTS){hosts.sort((a,b)=>String(b.lastSeen||'').localeCompare(String(a.lastSeen||'')));p.hosts=Object.fromEntries(hosts.slice(0,MAX_HOSTS).map(h=>[h.id,h]));}
    p.scans=p.scans.slice(-MAX_SCANS);p.baselines=p.baselines.slice(-MAX_BASELINES);p.events=p.events.slice(-MAX_EVENTS);
  }
}
module.exports={NetworkStore,normalizeHost,diffHost,hostKey,normalizedServices,signature,unitIdentity,compactHostSnapshot,MAX_STORE_BYTES,MAX_HOSTS,MAX_SCANS,MAX_BASELINES,MAX_EVENTS};
