'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeDeviceKey, parseDeviceKey } = require('./transportIdentity');
const { validateMappingDefinition } = require('./engineering');

function now() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; }
function finite(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function safeStamp() { return new Date().toISOString().replace(/[:.]/g,'-'); }
function ignorableSyncError(error) { return ['EPERM','EINVAL','ENOTSUP','ENOSYS'].includes(error?.code); }
function replaceRetryError(error) { return ['EPERM','EEXIST','ENOTEMPTY','EACCES'].includes(error?.code); }
function mappingError(code,message,extra={}){const e=new Error(message);e.code=code;Object.assign(e,extra);return e;}
function discoverySummary(results=[]) {
  const list=Array.isArray(results)?results:[];
  return {checked:list.length,responding:list.filter(x=>x?.responded).length,identified:list.filter(x=>x?.identificationSupported&&Array.isArray(x?.objects)&&x.objects.length).length,unsupported:list.filter(x=>x?.responded&&x?.identificationSupported===false).length,silent:list.filter(x=>!x?.responded).length};
}
function normalizeDiscoveryRun(input={}) {
  const transport=String(input.transport||input.result?.transport||'').toUpperCase();
  if(!['RTU','TCP'].includes(transport))throw new Error('Discovery evidence transport must be RTU or TCP.');
  const source=input.result&&typeof input.result==='object'?input.result:input;
  const results=(Array.isArray(source.results)?source.results:[]).slice(0,256).map(r=>clone(r));
  const target=transport==='TCP'
    ? {host:String(source.host||input.host||'').trim().slice(0,255),port:finite(source.port??input.port,502)}
    : {port:String(source.port||input.port||'').trim().slice(0,255),serial:clone(source.serial||input.serial||{})};
  return {
    id:String(input.id||id('discovery')).slice(0,180),jobId:input.jobId?String(input.jobId).slice(0,180):null,
    transport,mode:'active-identification',readOnly:true,transmit:true,
    startedAt:finite(input.startedAt,null),completedAt:finite(input.completedAt,null),savedAt:input.savedAt||now(),
    target,unitStart:finite(source.unitStart??input.unitStart,null),unitEnd:finite(source.unitEnd??input.unitEnd,null),
    summary:{...discoverySummary(results),...(input.summary&&typeof input.summary==='object'?clone(input.summary):{})},results
  };
}

function validateRegisterShape(mapping){
  const functionCode=Number(mapping.functionCode);if(!Number.isInteger(functionCode)||functionCode<1||functionCode>127)throw mappingError('INVALID_FUNCTION_CODE','Invalid function code.');
  const v=validateMappingDefinition(mapping);
  return{functionCode,...v};
}
function overlap(a,b){return a.address<=b.endAddress&&b.address<=a.endAddress;}
function validateRegisterSet(rows,{allowSameStartReplace=false}={}){
  const groups=new Map();
  for(const row of rows){
    const v=validateRegisterShape(row),deviceKey=String(row.deviceKey||'profile'),gkey=`${deviceKey}:${v.functionCode}`;
    const normalized={...row,...v};if(!groups.has(gkey))groups.set(gkey,[]);groups.get(gkey).push(normalized);
  }
  for(const list of groups.values()){
    list.sort((a,b)=>a.address-b.address);
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      if(list[j].address>list[i].endAddress)break;
      if(allowSameStartReplace&&list[i].address===list[j].address)continue;
      if(overlap(list[i],list[j])&&(list[i].wordCount>1||list[j].wordCount>1))throw mappingError('MAPPING_OVERLAP',`Register mapping ${list[j].address} overlaps multiword mapping ${list[i].address} on FC${list[i].functionCode}.`,{first:list[i],second:list[j]});
    }
  }
  return true;
}
function normalizeProfileRegister(r){const v=validateRegisterShape(r);return{...clone(r),type:v.type,address:v.address,byteOrder:v.byteOrder,wordCount:v.wordCount,endAddress:v.endAddress,functionCode:v.functionCode};}

class WorkspaceCorruptionError extends Error {
  constructor(message, details = {}) { super(message); this.name='WorkspaceCorruptionError'; this.code='WORKSPACE_CORRUPT'; Object.assign(this,details); }
}

class WorkspaceStore {
  constructor({ dataDir = path.join(process.cwd(), 'data'), file = null } = {}) {
    this.dataDir = dataDir;
    this.file = file || path.join(dataDir, 'workspaces.json');
    this.backupFile = `${this.file}.bak`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const loaded = this._load();
    this.db = loaded.db;
    this.lastMigrationReport = loaded.migrationReport || null;
    if (!this.db.projects.length) this.createProject({ name:'Default Project', site:'', bus:'Primary Bus' });
    if (!this.db.activeProjectId || !this.db.projects.some(p=>p.id===this.db.activeProjectId)) {
      this.db.activeProjectId=this.db.projects[0].id;
      this._save();
    }
  }

  _empty() { return { version:2, activeProjectId:null, projects:[], profiles:[] }; }

  _readJson(file) {
    const raw=fs.readFileSync(file,'utf8');
    try { return JSON.parse(raw); }
    catch (error) {
      const corrupt=`${file}.corrupt-${safeStamp()}`;
      try { fs.copyFileSync(file,corrupt); } catch {}
      throw new WorkspaceCorruptionError(`Workspace JSON is corrupted. Original preserved at ${corrupt}.`, { file, corruptFile:corrupt, backupFile:fs.existsSync(this.backupFile)?this.backupFile:null, cause:error.message });
    }
  }

  _load() {
    if (!fs.existsSync(this.file)) {
      if (fs.existsSync(this.backupFile)) {
        const restored=this._readJson(this.backupFile);
        const version=Number(restored?.version||1);
        if(version!==2)throw new WorkspaceCorruptionError('Primary workspace is missing and the recovery backup is not schema v2.',{file:this.file,backupFile:this.backupFile});
        this._validateDb(restored);
        fs.copyFileSync(this.backupFile,this.file);
        return {db:this._normalizeV2(restored),migrationReport:{recoveredAt:now(),reason:'Primary workspace was missing; restored the last known-good backup.',backupFile:this.backupFile}};
      }
      return {db:this._empty(),migrationReport:null};
    }
    const parsed=this._readJson(this.file);
    const version=Number(parsed?.version||1);
    if (version===2) { this._validateDb(parsed); return {db:this._normalizeV2(parsed),migrationReport:null}; }
    if (version===1) {
      const backup=`${this.file}.v1-backup-${safeStamp()}`;
      fs.copyFileSync(this.file,backup);
      const {db,report}=this._migrateV1(parsed,backup);
      this._validateDb(db);
      this._atomicWrite(db,{backupExisting:true});
      const reportFile=`${this.file}.migration-${safeStamp()}.json`;
      fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
      return {db,migrationReport:{...report,reportFile}};
    }
    throw new Error(`Unsupported workspace schema version ${version}.`);
  }

  _normalizeV2(data) {
    const db={...this._empty(),...clone(data),version:2};
    db.projects=db.projects.map(p=>({
      ...p,
      channels:p.channels&&typeof p.channels==='object'?p.channels:{},
      devices:p.devices&&typeof p.devices==='object'?p.devices:{},
      registers:p.registers&&typeof p.registers==='object'?p.registers:{},
      discoveryRuns:Array.isArray(p.discoveryRuns)?p.discoveryRuns.slice(-100):[],
      legacyUnassigned:p.legacyUnassigned&&typeof p.legacyUnassigned==='object'?p.legacyUnassigned:{devices:{},registers:{}},
      updatedAt:p.updatedAt||p.createdAt||now(),createdAt:p.createdAt||now()
    }));
    db.profiles=db.profiles.map(p=>({...p,version:Math.max(1,Number(p.version)||1),source:p.source&&typeof p.source==='object'?p.source:{type:'legacy-profile'}}));
    return db;
  }

  _migrateV1(data, backupFile) {
    if(!data||!Array.isArray(data.projects)||!Array.isArray(data.profiles))throw new Error('Invalid v1 workspace structure.');
    let legacyDevices=0,legacyRegisters=0;
    const projects=data.projects.map(old=>{
      const oldDevices=old.devices&&typeof old.devices==='object'?clone(old.devices):{};
      const oldRegisters=old.registers&&typeof old.registers==='object'?clone(old.registers):{};
      legacyDevices+=Object.keys(oldDevices).length;legacyRegisters+=Object.keys(oldRegisters).length;
      return {
        id:old.id||id('project'),name:String(old.name||'Untitled Project'),site:String(old.site||''),bus:String(old.bus||''),description:String(old.description||''),
        createdAt:old.createdAt||now(),updatedAt:now(),channels:{},devices:{},registers:{},discoveryRuns:[],
        legacyUnassigned:{devices:oldDevices,registers:oldRegisters,migratedFromVersion:1,reason:'Original v1 data had no transport/channel identity. Assign it explicitly before use.'}
      };
    });
    const profiles=(data.profiles||[]).map(p=>({...clone(p),version:Math.max(1,Number(p.version)||1),source:p.source&&typeof p.source==='object'?clone(p.source):{type:'legacy-profile'}}));
    const db={version:2,activeProjectId:data.activeProjectId,projects,profiles};
    if(!projects.some(p=>p.id===db.activeProjectId)&&projects.length)db.activeProjectId=projects[0].id;
    const report={migratedAt:now(),fromVersion:1,toVersion:2,backupFile,projectCount:projects.length,legacyDevices,legacyRegisters,policy:'No legacy device/register was guessed onto a live channel. All v1 identities remain Legacy / Unassigned until explicitly assigned.'};
    return {db,report};
  }

  _validateDb(data) {
    if(!data||Number(data.version)!==2||!Array.isArray(data.projects)||!Array.isArray(data.profiles))throw new Error('Invalid workspace v2 structure.');
    if(data.projects.length>5000||data.profiles.length>10000)throw new Error('Workspace exceeds supported project/profile limits.');
    const ids=new Set();
    for(const p of data.projects){
      if(!p||typeof p!=='object'||!p.id)throw new Error('Workspace project is missing an ID.');
      if(ids.has(p.id))throw new Error(`Duplicate project ID ${p.id}.`);ids.add(p.id);
      for(const field of ['channels','devices','registers'])if(p[field]!=null&&typeof p[field]!=='object')throw new Error(`Project ${p.id} has invalid ${field}.`);
      if(p.discoveryRuns!=null&&!Array.isArray(p.discoveryRuns))throw new Error(`Project ${p.id} has invalid discoveryRuns.`);
      if(Object.keys(p.channels||{}).length>1000)throw new Error(`Project ${p.id} has too many channels.`);
      if(Object.keys(p.devices||{}).length>100000)throw new Error(`Project ${p.id} has too many devices.`);
      if(Object.keys(p.registers||{}).length>500000)throw new Error(`Project ${p.id} has too many register mappings.`);
      if((p.discoveryRuns||[]).length>100)throw new Error(`Project ${p.id} has too many discovery runs.`);
      for(const run of p.discoveryRuns||[]){if(!run||typeof run!=='object'||!run.id)throw new Error(`Project ${p.id} has invalid discovery evidence.`);if(!['RTU','TCP'].includes(String(run.transport||'').toUpperCase()))throw new Error(`Project ${p.id} discovery run ${run.id} has invalid transport.`);if(!Array.isArray(run.results)||run.results.length>256)throw new Error(`Project ${p.id} discovery run ${run.id} has invalid results.`);}
      for(const [key,d] of Object.entries(p.devices||{})){const parsed=parseDeviceKey(key);if(!parsed||d.deviceKey&&d.deviceKey!==key)throw new Error(`Invalid device key ${key} in project ${p.id}.`);}
    }
    for(const p of data.profiles){if(!p||typeof p!=='object'||!p.id)throw new Error('Workspace profile is missing an ID.');if(p.registers!=null&&!Array.isArray(p.registers))throw new Error(`Profile ${p.id} has invalid registers.`);if((p.registers||[]).length>10000)throw new Error(`Profile ${p.id} has too many register mappings.`);}
    return true;
  }

  _validateEngineeringData(data){
    for(const p of data.projects||[]){
      const rows=[];
      for(const [key,r] of Object.entries(p.registers||{})){
        if(!r||typeof r!=='object'||!r.deviceKey)throw mappingError('INVALID_REGISTER_MAPPING',`Project ${p.id} contains an invalid register mapping ${key}.`);
        const parsed=parseDeviceKey(r.deviceKey);if(!parsed||!p.channels?.[parsed.channelId])throw mappingError('INVALID_REGISTER_MAPPING',`Register mapping ${key} references an unknown channel/device.`);
        const v=validateRegisterShape(r);rows.push({...r,...v});
      }
      validateRegisterSet(rows);
    }
    for(const p of data.profiles||[])validateRegisterSet((p.registers||[]).map(r=>({...r,deviceKey:'profile'})));
    return true;
  }

  _atomicWrite(db,{backupExisting=true}={}) {
    const tmp=`${this.file}.tmp-${process.pid}-${Date.now()}`;
    const existed=fs.existsSync(this.file);
    fs.writeFileSync(tmp,JSON.stringify(db,null,2));
    let fd=null;
    try {
      fd=fs.openSync(tmp,'r');
      try { fs.fsyncSync(fd); } catch(error) { if(!ignorableSyncError(error))throw error; }
    } finally { if(fd!==null)fs.closeSync(fd); }

    if(existed&&(backupExisting||!fs.existsSync(this.backupFile)))fs.copyFileSync(this.file,this.backupFile);

    try { fs.renameSync(tmp,this.file); }
    catch(error) {
      if(!(existed&&replaceRetryError(error))){try{fs.unlinkSync(tmp);}catch{}throw error;}
      try {
        fs.unlinkSync(this.file);
        fs.renameSync(tmp,this.file);
      } catch(second) {
        try { if(!fs.existsSync(this.file)&&fs.existsSync(this.backupFile))fs.copyFileSync(this.backupFile,this.file); } catch {}
        try { if(fs.existsSync(tmp))fs.unlinkSync(tmp); } catch {}
        throw second;
      }
    }
  }

  _save() { this._validateDb(this.db); this._atomicWrite(this.db,{backupExisting:true}); }

  listProjects() {
    return this.db.projects.map(p=>({
      id:p.id,name:p.name,site:p.site,bus:p.bus,description:p.description,createdAt:p.createdAt,updatedAt:p.updatedAt,active:p.id===this.db.activeProjectId,
      channelCount:Object.keys(p.channels||{}).length,deviceCount:Object.keys(p.devices||{}).length,mappingCount:Object.keys(p.registers||{}).length,discoveryRunCount:(p.discoveryRuns||[]).length,
      legacyDeviceCount:Object.keys(p.legacyUnassigned?.devices||{}).length,legacyMappingCount:Object.keys(p.legacyUnassigned?.registers||{}).length
    }));
  }
  getActiveProject() { return this.getProject(this.db.activeProjectId); }
  getProject(projectId) { const p=this.db.projects.find(x=>x.id===projectId); return p?clone(p):null; }

  createProject(input={}) {
    const stamp=now();const p={id:id('project'),name:String(input.name||'Untitled Project').trim().slice(0,120),site:String(input.site||'').trim().slice(0,200),bus:String(input.bus||'').trim().slice(0,120),description:String(input.description||'').trim().slice(0,2000),createdAt:stamp,updatedAt:stamp,channels:{},devices:{},registers:{},discoveryRuns:[],legacyUnassigned:{devices:{},registers:{}}};
    this.db.projects.push(p);this.db.activeProjectId=p.id;this._save();return clone(p);
  }
  updateProject(projectId,patch={}) {const p=this._project(projectId);for(const k of ['name','site','bus','description'])if(patch[k]!=null)p[k]=String(patch[k]).trim().slice(0,k==='description'?2000:200);p.updatedAt=now();this._save();return clone(p);}
  selectProject(projectId){if(!this.db.projects.some(x=>x.id===projectId))throw new Error('Project not found.');this.db.activeProjectId=projectId;this._save();return this.getActiveProject();}
  deleteProject(projectId){if(this.db.projects.length<=1)throw new Error('At least one project must remain.');const before=this.db.projects.length;this.db.projects=this.db.projects.filter(x=>x.id!==projectId);if(this.db.projects.length===before)throw new Error('Project not found.');if(this.db.activeProjectId===projectId)this.db.activeProjectId=this.db.projects[0].id;this._save();return true;}

  upsertChannel(projectId,channel={}) {
    const p=this._project(projectId);if(!channel.channelId)throw new Error('channelId is required.');
    const key=String(channel.channelId),prev=p.channels[key]||{};
    p.channels[key]={...prev,...clone(channel),channelId:key,transport:String(channel.transport||prev.transport||'RTU').toUpperCase(),mode:String(channel.mode||prev.mode||'offline'),name:String(channel.name||prev.name||key).slice(0,160),updatedAt:now(),createdAt:prev.createdAt||channel.createdAt||now()};
    p.updatedAt=now();this._save();return clone(p.channels[key]);
  }
  listChannels(projectId){const p=this._project(projectId);return Object.values(p.channels||{}).map(clone).sort((a,b)=>String(a.name).localeCompare(String(b.name)));}

  _resolveDeviceKey(project,ref,channelId=null,{allowUnseen=false}={}) {
    if(ref&&typeof ref==='object'){channelId=ref.channelId||channelId;ref=ref.deviceKey||(ref.unitId??ref.slaveId);}
    if(typeof ref==='string'){const parsed=parseDeviceKey(ref);if(parsed)return parsed.deviceKey;}
    const unitId=Number(ref);if(!Number.isInteger(unitId)||unitId<0||unitId>255)throw new Error('Invalid Unit/Slave ID.');
    if(channelId)return makeDeviceKey(String(channelId),unitId);
    const channels=Object.keys(project.channels||{});
    const matching=Object.keys(project.devices||{}).filter(k=>parseDeviceKey(k)?.unitId===unitId);
    if(matching.length===1)return matching[0];
    if(matching.length>1||channels.length>1){const e=new Error(`Unit/Slave ${unitId} is ambiguous. Specify channelId or deviceKey.`);e.code='AMBIGUOUS_DEVICE';throw e;}
    if(channels.length===1)return makeDeviceKey(channels[0],unitId);
    if(allowUnseen)throw new Error('A channel must be selected before assigning a device.');
    return null;
  }

  setDevice(projectId,ref,patch={},channelId=null) {
    const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId,{allowUnseen:true}),parsed=parseDeviceKey(key);if(!p.channels[parsed.channelId])throw new Error(`Channel ${parsed.channelId} is not registered in this project.`);
    const prev=p.devices[key]||{};p.devices[key]={...prev,deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,name:String(patch.name??prev.name??`${p.channels[parsed.channelId].transport==='TCP'?'Unit':'Slave'} ${parsed.unitId}`).trim().slice(0,120),manufacturer:String(patch.manufacturer??prev.manufacturer??'').trim().slice(0,120),model:String(patch.model??prev.model??'').trim().slice(0,120),notes:String(patch.notes??prev.notes??'').trim().slice(0,2000),profileId:patch.profileId===undefined?(prev.profileId||null):(patch.profileId||null),profileVersion:patch.profileVersion===undefined?(prev.profileVersion||null):(Number(patch.profileVersion)||null),profileSource:patch.profileSource===undefined?(prev.profileSource||null):(patch.profileSource?clone(patch.profileSource):null),updatedAt:now()};p.updatedAt=now();this._save();return clone(p.devices[key]);
  }
  getDevice(projectId,ref,channelId=null){const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId);return key?clone(p.devices[key]||null):null;}

  _registerCandidate(project,key,input={}){
    const parsed=parseDeviceKey(key);if(!parsed||!project.channels[parsed.channelId])throw new Error(`Channel ${parsed?.channelId||'unknown'} is not registered in this project.`);
    const functionCode=Number(input.functionCode),address=Number(input.address),mapKey=`${key}:${functionCode}:${address}`,prev=project.registers[mapKey]||{},base={...prev,...input,deviceKey:key,functionCode,address};
    const validated=validateRegisterShape(base),candidate={deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,functionCode:validated.functionCode,address:validated.address,name:String(input.name??prev.name??'').trim().slice(0,160),type:validated.type,byteOrder:validated.byteOrder,wordCount:validated.wordCount,endAddress:validated.endAddress,scale:finite(input.scale,finite(prev.scale,1)),offset:finite(input.offset,finite(prev.offset,0)),unit:String(input.unit??prev.unit??'').trim().slice(0,40),notes:String(input.notes??prev.notes??'').trim().slice(0,2000),updatedAt:now()};
    const peers=Object.entries(project.registers).filter(([k])=>k!==mapKey).map(([,r])=>r).filter(r=>r.deviceKey===key&&Number(r.functionCode)===validated.functionCode);
    for(const other of peers){const ov=validateRegisterShape(other);if(overlap(candidate,ov)&&(candidate.wordCount>1||ov.wordCount>1))throw mappingError('MAPPING_OVERLAP',`${candidate.type} mapping ${candidate.address}-${candidate.endAddress} overlaps existing ${other.type||'register'} mapping ${other.address}-${ov.endAddress} on the same device and FC.`,{candidate,existing:other});}
    return{mapKey,candidate};
  }

  setRegister(projectId,input={}) {
    const p=this._project(projectId),key=this._resolveDeviceKey(p,input.deviceKey||(input.unitId??input.slaveId),input.channelId,{allowUnseen:true}),{mapKey,candidate}=this._registerCandidate(p,key,input);
    p.registers[mapKey]=candidate;p.updatedAt=now();this._save();return clone(candidate);
  }
  deleteRegister(projectId,ref,functionCode,address,channelId=null){const p=this._project(projectId),deviceKey=this._resolveDeviceKey(p,ref,channelId);if(!deviceKey)return false;const key=`${deviceKey}:${Number(functionCode)}:${Number(address)}`,existed=Boolean(p.registers[key]);delete p.registers[key];if(existed){p.updatedAt=now();this._save();}return existed;}
  listRegisters(projectId,ref=null,channelId=null){const p=this._project(projectId);let deviceKey=null;if(ref!=null)deviceKey=this._resolveDeviceKey(p,ref,channelId);return Object.values(p.registers).filter(r=>!deviceKey||r.deviceKey===deviceKey).map(clone).sort((a,b)=>String(a.deviceKey).localeCompare(String(b.deviceKey))||a.functionCode-b.functionCode||a.address-b.address);}
  getLegacyUnassigned(projectId){const p=this._project(projectId);return clone(p.legacyUnassigned||{devices:{},registers:{}});}

  saveDiscoveryRun(projectId,input={}) {
    const p=this._project(projectId),run=normalizeDiscoveryRun(input),runs=p.discoveryRuns||[];
    p.discoveryRuns=[...runs.filter(x=>x.id!==run.id),run].slice(-100);p.updatedAt=now();this._save();return clone(run);
  }
  listDiscoveryRuns(projectId) {
    const p=this._project(projectId);return (p.discoveryRuns||[]).slice().reverse().map(run=>({id:run.id,jobId:run.jobId||null,transport:run.transport,mode:run.mode,readOnly:Boolean(run.readOnly),transmit:Boolean(run.transmit),startedAt:run.startedAt??null,completedAt:run.completedAt??null,savedAt:run.savedAt||null,target:clone(run.target||{}),unitStart:run.unitStart??null,unitEnd:run.unitEnd??null,summary:clone(run.summary||discoverySummary(run.results)),resultCount:Array.isArray(run.results)?run.results.length:0}));
  }
  getDiscoveryRun(projectId,runId){const p=this._project(projectId),run=(p.discoveryRuns||[]).find(x=>x.id===runId);return run?clone(run):null;}
  deleteDiscoveryRun(projectId,runId){const p=this._project(projectId),before=(p.discoveryRuns||[]).length;p.discoveryRuns=(p.discoveryRuns||[]).filter(x=>x.id!==runId);if(p.discoveryRuns.length===before)return false;p.updatedAt=now();this._save();return true;}

  listProfiles(){return this.db.profiles.map(p=>({id:p.id,name:p.name,manufacturer:p.manufacturer,model:p.model,version:p.version||1,source:clone(p.source||{}),registerCount:(p.registers||[]).length,createdAt:p.createdAt,updatedAt:p.updatedAt}));}
  getProfile(profileId){const p=this.db.profiles.find(x=>x.id===profileId);return p?clone(p):null;}
  saveProfile(input={}){
    const stamp=now(),existing=input.id?this.db.profiles.find(x=>x.id===input.id):null,profile=existing||{id:id('profile'),createdAt:stamp};
    const regs=Array.isArray(input.registers)?input.registers:(profile.registers||[]),normalized=regs.map(normalizeProfileRegister);validateRegisterSet(normalized.map(r=>({...r,deviceKey:'profile'})));
    profile.name=String(input.name||profile.name||'Unnamed Profile').trim().slice(0,160);profile.manufacturer=String(input.manufacturer??profile.manufacturer??'').trim().slice(0,120);profile.model=String(input.model??profile.model??'').trim().slice(0,120);profile.notes=String(input.notes??profile.notes??'').trim().slice(0,2000);profile.registers=normalized;profile.version=existing?Math.max(1,Number(existing.version)||1)+1:Math.max(1,Number(input.version)||1);profile.source=input.source&&typeof input.source==='object'?clone(input.source):(profile.source||{type:'user'});profile.updatedAt=stamp;if(!existing)this.db.profiles.push(profile);this._save();return clone(profile);
  }
  createProfileFromDevice(projectId,ref,meta={},channelId=null){const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId),regs=this.listRegisters(projectId,key).map(r=>{const x={...r};for(const k of ['deviceKey','channelId','unitId','slaveId','updatedAt'])delete x[k];return x;}),d=this.getDevice(projectId,key)||{};return this.saveProfile({name:meta.name||`${d.manufacturer||'Device'} ${d.model||''}`.trim()||`${key} profile`,manufacturer:meta.manufacturer??d.manufacturer,model:meta.model??d.model,notes:meta.notes||'',source:{type:'project-device',projectId,deviceKey:key,capturedAt:now()},registers:regs});}
  applyProfile(projectId,ref,profileId,channelId=null){
    const profile=this.getProfile(profileId);if(!profile)throw new Error('Profile not found.');const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId,{allowUnseen:true});
    // Preflight every mapping against a cloned project so an invalid profile can never partially apply.
    const preview=clone(p);let count=0;
    for(const r of profile.registers){const{mapKey,candidate}=this._registerCandidate(preview,key,{...r,deviceKey:key});preview.registers[mapKey]=candidate;count++;}
    p.registers=preview.registers;
    const current=this.getDevice(projectId,key)||{};const parsed=parseDeviceKey(key),prev=p.devices[key]||{};
    p.devices[key]={...prev,deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,name:current.name||prev.name||`${p.channels[parsed.channelId].transport==='TCP'?'Unit':'Slave'} ${parsed.unitId}`,manufacturer:profile.manufacturer||current.manufacturer||'',model:profile.model||current.model||'',notes:current.notes||prev.notes||'',profileId:profile.id,profileVersion:profile.version||1,profileSource:clone(profile.source||{}),updatedAt:now()};
    p.updatedAt=now();this._save();return{count,device:this.getDevice(projectId,key),profile:{id:profile.id,version:profile.version||1,source:clone(profile.source||{})}};
  }
  deleteProfile(profileId){const n=this.db.profiles.length;this.db.profiles=this.db.profiles.filter(x=>x.id!==profileId);if(this.db.profiles.length===n)return false;this._save();return true;}

  exportAll(){return clone(this.db);}
  importAll(data){const candidate=this._normalizeV2(clone(data));this._validateDb(candidate);this._validateEngineeringData(candidate);if(!candidate.projects.length)throw new Error('Workspace export contains no projects.');if(!candidate.projects.some(p=>p.id===candidate.activeProjectId))candidate.activeProjectId=candidate.projects[0].id;this._atomicWrite(candidate,{backupExisting:true});this.db=candidate;return this.exportAll();}
  getMigrationReport(){return this.lastMigrationReport?clone(this.lastMigrationReport):null;}
  _project(projectId){const p=this.db.projects.find(x=>x.id===(projectId||this.db.activeProjectId));if(!p)throw new Error('Project not found.');return p;}
}

module.exports={WorkspaceStore,WorkspaceCorruptionError,normalizeDiscoveryRun,discoverySummary,validateRegisterSet};
