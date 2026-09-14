'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeDeviceKey, parseDeviceKey } = require('./transportIdentity');

function now() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; }
function finite(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function safeStamp() { return new Date().toISOString().replace(/[:.]/g,'-'); }

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
    if (!fs.existsSync(this.file)) return {db:this._empty(),migrationReport:null};
    const parsed=this._readJson(this.file);
    const version=Number(parsed?.version||1);
    if (version===2) { this._validateDb(parsed); return {db:this._normalizeV2(parsed),migrationReport:null}; }
    if (version===1) {
      const backup=`${this.file}.v1-backup-${safeStamp()}`;
      fs.copyFileSync(this.file,backup);
      const {db,report}=this._migrateV1(parsed,backup);
      this._validateDb(db);
      this._atomicWrite(db,{backupExisting:false});
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
      legacyUnassigned:p.legacyUnassigned&&typeof p.legacyUnassigned==='object'?p.legacyUnassigned:{devices:{},registers:{}},
      updatedAt:p.updatedAt||p.createdAt||now(),createdAt:p.createdAt||now()
    }));
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
        createdAt:old.createdAt||now(),updatedAt:now(),channels:{},devices:{},registers:{},
        legacyUnassigned:{devices:oldDevices,registers:oldRegisters,migratedFromVersion:1,reason:'Original v1 data had no transport/channel identity. Assign it explicitly before use.'}
      };
    });
    const db={version:2,activeProjectId:data.activeProjectId,projects,profiles:clone(data.profiles||[])};
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
      if(Object.keys(p.channels||{}).length>1000)throw new Error(`Project ${p.id} has too many channels.`);
      if(Object.keys(p.devices||{}).length>100000)throw new Error(`Project ${p.id} has too many devices.`);
      if(Object.keys(p.registers||{}).length>500000)throw new Error(`Project ${p.id} has too many register mappings.`);
      for(const [key,d] of Object.entries(p.devices||{})){const parsed=parseDeviceKey(key);if(!parsed||d.deviceKey&&d.deviceKey!==key)throw new Error(`Invalid device key ${key} in project ${p.id}.`);}
    }
    return true;
  }

  _atomicWrite(db,{backupExisting=true}={}) {
    const tmp=`${this.file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp,JSON.stringify(db,null,2));
    const fd=fs.openSync(tmp,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(backupExisting&&fs.existsSync(this.file))fs.copyFileSync(this.file,this.backupFile);
    try { fs.renameSync(tmp,this.file); }
    catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
  }

  _save() { this._validateDb(this.db); this._atomicWrite(this.db,{backupExisting:true}); }

  listProjects() {
    return this.db.projects.map(p=>({
      id:p.id,name:p.name,site:p.site,bus:p.bus,description:p.description,createdAt:p.createdAt,updatedAt:p.updatedAt,active:p.id===this.db.activeProjectId,
      channelCount:Object.keys(p.channels||{}).length,deviceCount:Object.keys(p.devices||{}).length,mappingCount:Object.keys(p.registers||{}).length,
      legacyDeviceCount:Object.keys(p.legacyUnassigned?.devices||{}).length,legacyMappingCount:Object.keys(p.legacyUnassigned?.registers||{}).length
    }));
  }
  getActiveProject() { return this.getProject(this.db.activeProjectId); }
  getProject(projectId) { const p=this.db.projects.find(x=>x.id===projectId); return p?clone(p):null; }

  createProject(input={}) {
    const stamp=now();const p={id:id('project'),name:String(input.name||'Untitled Project').trim().slice(0,120),site:String(input.site||'').trim().slice(0,200),bus:String(input.bus||'').trim().slice(0,120),description:String(input.description||'').trim().slice(0,2000),createdAt:stamp,updatedAt:stamp,channels:{},devices:{},registers:{},legacyUnassigned:{devices:{},registers:{}}};
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
    const prev=p.devices[key]||{};p.devices[key]={...prev,deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,name:String(patch.name??prev.name??`${p.channels[parsed.channelId].transport==='TCP'?'Unit':'Slave'} ${parsed.unitId}`).trim().slice(0,120),manufacturer:String(patch.manufacturer??prev.manufacturer??'').trim().slice(0,120),model:String(patch.model??prev.model??'').trim().slice(0,120),notes:String(patch.notes??prev.notes??'').trim().slice(0,2000),profileId:patch.profileId===undefined?(prev.profileId||null):(patch.profileId||null),updatedAt:now()};p.updatedAt=now();this._save();return clone(p.devices[key]);
  }
  getDevice(projectId,ref,channelId=null){const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId);return key?clone(p.devices[key]||null):null;}

  setRegister(projectId,input={}) {
    const p=this._project(projectId),key=this._resolveDeviceKey(p,input.deviceKey||(input.unitId??input.slaveId),input.channelId,{allowUnseen:true}),parsed=parseDeviceKey(key);
    if(!p.channels[parsed.channelId])throw new Error(`Channel ${parsed.channelId} is not registered in this project.`);
    const functionCode=Number(input.functionCode),address=Number(input.address);if(!Number.isInteger(functionCode)||functionCode<1||functionCode>127)throw new Error('Invalid function code.');if(!Number.isInteger(address)||address<0||address>65535)throw new Error('Invalid register address.');
    const mapKey=`${key}:${functionCode}:${address}`,prev=p.registers[mapKey]||{},type=String(input.type??prev.type??'uint16').toLowerCase();if(!['uint16','int16','uint32','int32','float32','uint64','int64','float64','ascii','bits'].includes(type))throw new Error('Unsupported data type.');
    const byteOrder=String(input.byteOrder??prev.byteOrder??(type.includes('64')?'ABCDEFGH':'ABCD')).toUpperCase();
    p.registers[mapKey]={deviceKey:key,channelId:parsed.channelId,unitId:parsed.unitId,slaveId:parsed.unitId,functionCode,address,name:String(input.name??prev.name??'').trim().slice(0,160),type,byteOrder,scale:finite(input.scale,finite(prev.scale,1)),offset:finite(input.offset,finite(prev.offset,0)),unit:String(input.unit??prev.unit??'').trim().slice(0,40),notes:String(input.notes??prev.notes??'').trim().slice(0,2000),updatedAt:now()};p.updatedAt=now();this._save();return clone(p.registers[mapKey]);
  }
  deleteRegister(projectId,ref,functionCode,address,channelId=null){const p=this._project(projectId),deviceKey=this._resolveDeviceKey(p,ref,channelId);if(!deviceKey)return false;const key=`${deviceKey}:${Number(functionCode)}:${Number(address)}`,existed=Boolean(p.registers[key]);delete p.registers[key];if(existed){p.updatedAt=now();this._save();}return existed;}
  listRegisters(projectId,ref=null,channelId=null){const p=this._project(projectId);let deviceKey=null;if(ref!=null)deviceKey=this._resolveDeviceKey(p,ref,channelId);return Object.values(p.registers).filter(r=>!deviceKey||r.deviceKey===deviceKey).map(clone).sort((a,b)=>String(a.deviceKey).localeCompare(String(b.deviceKey))||a.functionCode-b.functionCode||a.address-b.address);}
  getLegacyUnassigned(projectId){const p=this._project(projectId);return clone(p.legacyUnassigned||{devices:{},registers:{}});}

  listProfiles(){return this.db.profiles.map(p=>({id:p.id,name:p.name,manufacturer:p.manufacturer,model:p.model,registerCount:(p.registers||[]).length,createdAt:p.createdAt,updatedAt:p.updatedAt}));}
  getProfile(profileId){const p=this.db.profiles.find(x=>x.id===profileId);return p?clone(p):null;}
  saveProfile(input={}){const stamp=now(),existing=input.id?this.db.profiles.find(x=>x.id===input.id):null,profile=existing||{id:id('profile'),createdAt:stamp};profile.name=String(input.name||profile.name||'Unnamed Profile').trim().slice(0,160);profile.manufacturer=String(input.manufacturer??profile.manufacturer??'').trim().slice(0,120);profile.model=String(input.model??profile.model??'').trim().slice(0,120);profile.notes=String(input.notes??profile.notes??'').trim().slice(0,2000);profile.registers=Array.isArray(input.registers)?clone(input.registers):clone(profile.registers||[]);profile.updatedAt=stamp;if(!existing)this.db.profiles.push(profile);this._save();return clone(profile);}
  createProfileFromDevice(projectId,ref,meta={},channelId=null){const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId),regs=this.listRegisters(projectId,key).map(r=>{const x={...r};for(const k of ['deviceKey','channelId','unitId','slaveId','updatedAt'])delete x[k];return x;}),d=this.getDevice(projectId,key)||{};return this.saveProfile({name:meta.name||`${d.manufacturer||'Device'} ${d.model||''}`.trim()||`${key} profile`,manufacturer:meta.manufacturer??d.manufacturer,model:meta.model??d.model,notes:meta.notes||'',registers:regs});}
  applyProfile(projectId,ref,profileId,channelId=null){const profile=this.getProfile(profileId);if(!profile)throw new Error('Profile not found.');const p=this._project(projectId),key=this._resolveDeviceKey(p,ref,channelId,{allowUnseen:true});let count=0;for(const r of profile.registers){this.setRegister(projectId,{...r,deviceKey:key});count++;}this.setDevice(projectId,key,{...this.getDevice(projectId,key),manufacturer:profile.manufacturer,model:profile.model,profileId});return{count,device:this.getDevice(projectId,key)};}
  deleteProfile(profileId){const n=this.db.profiles.length;this.db.profiles=this.db.profiles.filter(x=>x.id!==profileId);if(this.db.profiles.length===n)return false;this._save();return true;}

  exportAll(){return clone(this.db);}
  importAll(data){const candidate=this._normalizeV2(clone(data));this._validateDb(candidate);if(!candidate.projects.length)throw new Error('Workspace export contains no projects.');if(!candidate.projects.some(p=>p.id===candidate.activeProjectId))candidate.activeProjectId=candidate.projects[0].id;this._atomicWrite(candidate,{backupExisting:true});this.db=candidate;return this.exportAll();}
  getMigrationReport(){return this.lastMigrationReport?clone(this.lastMigrationReport):null;}
  _project(projectId){const p=this.db.projects.find(x=>x.id===(projectId||this.db.activeProjectId));if(!p)throw new Error('Project not found.');return p;}
}

module.exports={WorkspaceStore,WorkspaceCorruptionError};
