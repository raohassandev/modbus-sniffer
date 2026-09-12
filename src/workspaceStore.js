'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function now() { return new Date().toISOString(); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`; }
function finite(v, fallback = null) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

class WorkspaceStore {
  constructor({ dataDir = path.join(process.cwd(), 'data'), file = null } = {}) {
    this.dataDir = dataDir;
    this.file = file || path.join(dataDir, 'workspaces.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = this._load();
    if (!this.db.projects.length) this.createProject({ name: 'Default Project', site: '', bus: 'Primary Bus' });
    if (!this.db.activeProjectId || !this.db.projects.some(p => p.id === this.db.activeProjectId)) {
      this.db.activeProjectId = this.db.projects[0].id;
      this._save();
    }
  }

  _empty() { return { version: 1, activeProjectId: null, projects: [], profiles: [] }; }
  _load() {
    try {
      if (!fs.existsSync(this.file)) return this._empty();
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.profiles)) return this._empty();
      return { ...this._empty(), ...parsed };
    } catch { return this._empty(); }
  }
  _save() {
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  listProjects() {
    return this.db.projects.map(p => ({ id:p.id, name:p.name, site:p.site, bus:p.bus, description:p.description, createdAt:p.createdAt, updatedAt:p.updatedAt, active:p.id===this.db.activeProjectId, deviceCount:Object.keys(p.devices||{}).length, mappingCount:Object.keys(p.registers||{}).length }));
  }
  getActiveProject() { return this.getProject(this.db.activeProjectId); }
  getProject(projectId) { const p=this.db.projects.find(x=>x.id===projectId); return p ? clone(p) : null; }
  createProject(input = {}) {
    const stamp = now();
    const p = { id:id('project'), name:String(input.name||'Untitled Project').trim().slice(0,120), site:String(input.site||'').trim().slice(0,200), bus:String(input.bus||'').trim().slice(0,120), description:String(input.description||'').trim().slice(0,2000), createdAt:stamp, updatedAt:stamp, devices:{}, registers:{} };
    this.db.projects.push(p); this.db.activeProjectId=p.id; this._save(); return clone(p);
  }
  updateProject(projectId, patch = {}) {
    const p=this.db.projects.find(x=>x.id===projectId); if(!p) throw new Error('Project not found.');
    for(const k of ['name','site','bus','description']) if(patch[k]!=null) p[k]=String(patch[k]).trim().slice(0,k==='description'?2000:200);
    p.updatedAt=now(); this._save(); return clone(p);
  }
  selectProject(projectId) { if(!this.db.projects.some(x=>x.id===projectId)) throw new Error('Project not found.'); this.db.activeProjectId=projectId; this._save(); return this.getActiveProject(); }
  deleteProject(projectId) {
    if(this.db.projects.length<=1) throw new Error('At least one project must remain.');
    const before=this.db.projects.length; this.db.projects=this.db.projects.filter(x=>x.id!==projectId); if(this.db.projects.length===before) throw new Error('Project not found.');
    if(this.db.activeProjectId===projectId) this.db.activeProjectId=this.db.projects[0].id; this._save(); return true;
  }

  setDevice(projectId, slaveId, patch = {}) {
    const p=this._project(projectId); const sid=String(Number(slaveId)); if(!Number.isInteger(Number(slaveId))||Number(slaveId)<0||Number(slaveId)>247) throw new Error('Invalid Slave ID.');
    const prev=p.devices[sid]||{}; p.devices[sid]={ ...prev, name:String(patch.name??prev.name??`Slave ${sid}`).trim().slice(0,120), manufacturer:String(patch.manufacturer??prev.manufacturer??'').trim().slice(0,120), model:String(patch.model??prev.model??'').trim().slice(0,120), notes:String(patch.notes??prev.notes??'').trim().slice(0,2000), profileId:patch.profileId===undefined?(prev.profileId||null):(patch.profileId||null), updatedAt:now() };
    p.updatedAt=now(); this._save(); return clone(p.devices[sid]);
  }
  getDevice(projectId, slaveId) { const p=this._project(projectId); return clone(p.devices[String(Number(slaveId))]||null); }

  setRegister(projectId, input = {}) {
    const p=this._project(projectId); const slaveId=Number(input.slaveId), functionCode=Number(input.functionCode), address=Number(input.address);
    if(!Number.isInteger(slaveId)||slaveId<0||slaveId>247) throw new Error('Invalid Slave ID.');
    if(!Number.isInteger(functionCode)||functionCode<1||functionCode>127) throw new Error('Invalid function code.');
    if(!Number.isInteger(address)||address<0||address>65535) throw new Error('Invalid register address.');
    const key=`${slaveId}:${functionCode}:${address}`; const prev=p.registers[key]||{};
    const type=String(input.type??prev.type??'uint16').toLowerCase();
    if(!['uint16','int16','uint32','int32','float32','uint64','int64','float64','ascii','bits'].includes(type)) throw new Error('Unsupported data type.');
    const byteOrder=String(input.byteOrder??prev.byteOrder??(type.includes('64')?'ABCDEFGH':'ABCD')).toUpperCase();
    p.registers[key]={ slaveId,functionCode,address,name:String(input.name??prev.name??'').trim().slice(0,160),type,byteOrder,scale:finite(input.scale,finite(prev.scale,1)),offset:finite(input.offset,finite(prev.offset,0)),unit:String(input.unit??prev.unit??'').trim().slice(0,40),notes:String(input.notes??prev.notes??'').trim().slice(0,2000),updatedAt:now() };
    p.updatedAt=now(); this._save(); return clone(p.registers[key]);
  }
  deleteRegister(projectId, slaveId, functionCode, address) { const p=this._project(projectId); const key=`${Number(slaveId)}:${Number(functionCode)}:${Number(address)}`; const existed=Boolean(p.registers[key]); delete p.registers[key]; if(existed){p.updatedAt=now();this._save();} return existed; }
  listRegisters(projectId, slaveId = null) { const p=this._project(projectId); return Object.values(p.registers).filter(r=>slaveId==null||r.slaveId===Number(slaveId)).map(clone).sort((a,b)=>a.slaveId-b.slaveId||a.functionCode-b.functionCode||a.address-b.address); }

  listProfiles() { return this.db.profiles.map(p=>({ id:p.id,name:p.name,manufacturer:p.manufacturer,model:p.model,registerCount:p.registers.length,createdAt:p.createdAt,updatedAt:p.updatedAt })); }
  getProfile(profileId) { const p=this.db.profiles.find(x=>x.id===profileId); return p?clone(p):null; }
  saveProfile(input = {}) {
    const stamp=now(); const existing=input.id?this.db.profiles.find(x=>x.id===input.id):null;
    const profile=existing||{id:id('profile'),createdAt:stamp};
    profile.name=String(input.name||profile.name||'Unnamed Profile').trim().slice(0,160); profile.manufacturer=String(input.manufacturer??profile.manufacturer??'').trim().slice(0,120); profile.model=String(input.model??profile.model??'').trim().slice(0,120); profile.notes=String(input.notes??profile.notes??'').trim().slice(0,2000); profile.registers=Array.isArray(input.registers)?clone(input.registers):clone(profile.registers||[]); profile.updatedAt=stamp;
    if(!existing)this.db.profiles.push(profile); this._save(); return clone(profile);
  }
  createProfileFromDevice(projectId, slaveId, meta = {}) {
    const regs=this.listRegisters(projectId,slaveId).map(r=>{const x={...r};delete x.slaveId;delete x.updatedAt;return x;}); const d=this.getDevice(projectId,slaveId)||{};
    return this.saveProfile({name:meta.name||`${d.manufacturer||'Device'} ${d.model||''}`.trim()||`Slave ${slaveId} profile`,manufacturer:meta.manufacturer??d.manufacturer,model:meta.model??d.model,notes:meta.notes||'',registers:regs});
  }
  applyProfile(projectId, slaveId, profileId) {
    const profile=this.getProfile(profileId); if(!profile) throw new Error('Profile not found.');
    let count=0; for(const r of profile.registers) { this.setRegister(projectId,{...r,slaveId:Number(slaveId)}); count++; }
    this.setDevice(projectId,slaveId,{...this.getDevice(projectId,slaveId),manufacturer:profile.manufacturer,model:profile.model,profileId}); return {count,device:this.getDevice(projectId,slaveId)};
  }
  deleteProfile(profileId) { const n=this.db.profiles.length; this.db.profiles=this.db.profiles.filter(x=>x.id!==profileId); if(this.db.profiles.length===n) return false; this._save(); return true; }

  exportAll() { return clone(this.db); }
  importAll(data) { if(!data||!Array.isArray(data.projects)||!Array.isArray(data.profiles)) throw new Error('Invalid workspace export.'); this.db={...this._empty(),...clone(data)}; if(!this.db.projects.length) throw new Error('Workspace export contains no projects.'); if(!this.db.projects.some(p=>p.id===this.db.activeProjectId)) this.db.activeProjectId=this.db.projects[0].id; this._save(); return this.exportAll(); }
  _project(projectId) { const p=this.db.projects.find(x=>x.id===(projectId||this.db.activeProjectId)); if(!p) throw new Error('Project not found.'); return p; }
}

module.exports = { WorkspaceStore };
