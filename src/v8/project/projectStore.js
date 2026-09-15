'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  V8_PROJECT_SCHEMA_VERSION,
  V8ProjectSchemaError,
  clone,
  createEmptyV8Database,
  normalizeV8Project,
  sanitizeConnectionProfile,
  validateV8Database,
} = require('./schema');
const { migrateV7Workspace } = require('./migrateV7');

function stamp() {
  return new Date().toISOString();
}

function safeStamp() {
  return stamp().replace(/[:.]/g, '-');
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function syncIgnorable(error) {
  return ['EPERM', 'EINVAL', 'ENOTSUP', 'ENOSYS'].includes(error?.code);
}

function replaceRetryError(error) {
  return ['EPERM', 'EEXIST', 'ENOTEMPTY', 'EACCES'].includes(error?.code);
}

class V8ProjectStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V8ProjectStoreError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, V8ProjectStoreError);
  }
}

class V8ProjectStore {
  constructor({
    dataDir = path.join(process.cwd(), 'data'),
    file = null,
    sourceV7File = null,
    autoMigrate = true,
  } = {}) {
    this.dataDir = dataDir;
    this.file = file || path.join(dataDir, 'workbench-v8.json');
    this.backupFile = `${this.file}.bak`;
    this.sourceV7File = sourceV7File || path.join(dataDir, 'workspaces.json');
    this.autoMigrate = Boolean(autoMigrate);
    this.lastMigrationReport = null;
    this.lastRecoveryReport = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const loaded = this._load();
    this.db = loaded.db;
    this.lastMigrationReport = loaded.migrationReport || null;
    this.lastRecoveryReport = loaded.recoveryReport || null;
  }

  _readJson(file, { preserveCorrupt = false } = {}) {
    const raw = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (error) {
      let corruptFile = null;
      if (preserveCorrupt) {
        corruptFile = `${file}.corrupt-${safeStamp()}`;
        try { fs.copyFileSync(file, corruptFile); } catch { corruptFile = null; }
      }
      throw new V8ProjectStoreError('PROJECT_FILE_CORRUPT', `Project JSON is corrupted: ${file}`, {
        file,
        corruptFile,
        cause: error.message,
      });
    }
  }

  _load() {
    if (fs.existsSync(this.file)) {
      try {
        const db = validateV8Database(this._readJson(this.file, { preserveCorrupt: true }));
        return { db, migrationReport: db.metadata?.migration || null, recoveryReport: null };
      } catch (error) {
        if (!(error instanceof V8ProjectStoreError) || error.code !== 'PROJECT_FILE_CORRUPT' || !fs.existsSync(this.backupFile)) throw error;
        const recovered = validateV8Database(this._readJson(this.backupFile));
        fs.copyFileSync(this.backupFile, this.file);
        return {
          db: recovered,
          migrationReport: recovered.metadata?.migration || null,
          recoveryReport: {
            recoveredAt: stamp(),
            reason: 'Primary v8 project file was corrupt; restored the last known-good backup.',
            backupFile: this.backupFile,
            corruptFile: error.details.corruptFile || null,
          },
        };
      }
    }

    if (this.autoMigrate && fs.existsSync(this.sourceV7File)) {
      const source = this._readJson(this.sourceV7File, { preserveCorrupt: false });
      const sourceBackup = `${this.sourceV7File}.v7-backup-${safeStamp()}`;
      fs.copyFileSync(this.sourceV7File, sourceBackup);
      const { db, report } = migrateV7Workspace(source, { source: this.sourceV7File });
      this._atomicWrite(db, { backupExisting: false });
      const reportFile = `${this.file}.migration-${safeStamp()}.json`;
      const persistedReport = {
        ...report,
        sourceFile: this.sourceV7File,
        sourceBackup,
        destinationFile: this.file,
        reportFile,
      };
      fs.writeFileSync(reportFile, JSON.stringify(persistedReport, null, 2));
      return { db, migrationReport: persistedReport, recoveryReport: null };
    }

    const db = createEmptyV8Database();
    this._atomicWrite(db, { backupExisting: false });
    return { db, migrationReport: null, recoveryReport: null };
  }

  _atomicWrite(db, { backupExisting = true } = {}) {
    const normalized = validateV8Database(db);
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    const existed = fs.existsSync(this.file);
    fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2));
    let fd = null;
    try {
      fd = fs.openSync(tmp, 'r');
      try { fs.fsyncSync(fd); } catch (error) { if (!syncIgnorable(error)) throw error; }
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }

    if (existed && (backupExisting || !fs.existsSync(this.backupFile))) fs.copyFileSync(this.file, this.backupFile);
    try {
      fs.renameSync(tmp, this.file);
    } catch (error) {
      if (!(existed && replaceRetryError(error))) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw error;
      }
      try {
        fs.unlinkSync(this.file);
        fs.renameSync(tmp, this.file);
      } catch (second) {
        try {
          if (!fs.existsSync(this.file) && fs.existsSync(this.backupFile)) fs.copyFileSync(this.backupFile, this.file);
        } catch { /* ignore */ }
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw second;
      }
    }
  }

  _save() {
    this.db.metadata = {
      ...(this.db.metadata || {}),
      updatedAt: stamp(),
    };
    this.db = validateV8Database(this.db);
    this._atomicWrite(this.db, { backupExisting: true });
  }

  exportAll() {
    return clone(this.db);
  }

  importAll(input, { allowV7Migration = true } = {}) {
    let next;
    let migrationReport = null;
    if (Number(input?.schemaVersion) === V8_PROJECT_SCHEMA_VERSION) {
      next = validateV8Database(input);
    } else if (allowV7Migration && Number(input?.version) === 2) {
      const migrated = migrateV7Workspace(input, { source: 'import' });
      next = migrated.db;
      migrationReport = migrated.report;
    } else {
      throw new V8ProjectSchemaError('UNSUPPORTED_IMPORT_SCHEMA', 'Import must be v8 schema 3 or an explicitly migratable v7 schema 2 workspace');
    }
    this.db = next;
    this.lastMigrationReport = migrationReport;
    this._save();
    return this.exportAll();
  }

  getMigrationReport() {
    return this.lastMigrationReport ? clone(this.lastMigrationReport) : null;
  }

  getRecoveryReport() {
    return this.lastRecoveryReport ? clone(this.lastRecoveryReport) : null;
  }

  listProjects() {
    return this.db.projects.map((project) => ({
      id: project.id,
      name: project.name,
      site: project.site,
      bus: project.bus,
      active: project.id === this.db.activeProjectId,
      channelCount: Object.keys(project.channels || {}).length,
      deviceCount: Object.keys(project.devices || {}).length,
      registerCount: Object.keys(project.registers || {}).length,
      connectionCount: (project.connections || []).length,
      masterJobCount: (project.masterJobs || []).length,
      virtualDeviceCount: (project.virtualDevices || []).length,
      updatedAt: project.updatedAt,
    }));
  }

  getProject(projectId) {
    const project = this.db.projects.find((entry) => entry.id === projectId);
    return project ? clone(project) : null;
  }

  getActiveProject() {
    return this.getProject(this.db.activeProjectId);
  }

  createProject(input = {}) {
    const stampValue = stamp();
    const project = normalizeV8Project({
      ...input,
      id: input.id || id('project'),
      projectId: input.id || undefined,
      createdAt: input.createdAt || stampValue,
      updatedAt: stampValue,
    }, { index: this.db.projects.length });
    if (this.db.projects.some((entry) => entry.id === project.id)) {
      throw new V8ProjectStoreError('PROJECT_EXISTS', `Project ${project.id} already exists`, { projectId: project.id });
    }
    this.db.projects.push(project);
    if (!this.db.activeProjectId) this.db.activeProjectId = project.id;
    this._save();
    return clone(project);
  }

  updateProject(projectId, patch = {}) {
    const index = this.db.projects.findIndex((entry) => entry.id === projectId);
    if (index < 0) throw new V8ProjectStoreError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const current = this.db.projects[index];
    const next = normalizeV8Project({
      ...current,
      ...clone(patch),
      id: current.id,
      projectId: current.id,
      createdAt: current.createdAt,
      updatedAt: stamp(),
    }, { index });
    this.db.projects[index] = next;
    this._save();
    return clone(next);
  }

  setActiveProject(projectId) {
    if (!this.db.projects.some((entry) => entry.id === projectId)) {
      throw new V8ProjectStoreError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    }
    this.db.activeProjectId = projectId;
    this._save();
    return this.getProject(projectId);
  }

  listConnectionProfiles(projectId) {
    const project = this._project(projectId);
    return clone(project.connections || []);
  }

  upsertConnectionProfile(projectId, input) {
    const project = this._project(projectId);
    const next = sanitizeConnectionProfile(input, { index: project.connections.length });
    if (next.sourceChannelId != null && !project.channels[next.sourceChannelId]) {
      throw new V8ProjectStoreError('UNKNOWN_SOURCE_CHANNEL', `Connection ${next.connectionId} references unknown channel ${next.sourceChannelId}`, {
        projectId,
        connectionId: next.connectionId,
        sourceChannelId: next.sourceChannelId,
      });
    }
    const index = project.connections.findIndex((entry) => entry.connectionId === next.connectionId);
    if (index >= 0) project.connections[index] = next;
    else project.connections.push(next);
    project.updatedAt = stamp();
    this._save();
    return clone(next);
  }

  removeConnectionProfile(projectId, connectionId) {
    const project = this._project(projectId);
    const index = project.connections.findIndex((entry) => entry.connectionId === connectionId);
    if (index < 0) return false;
    project.connections.splice(index, 1);
    project.updatedAt = stamp();
    this._save();
    return true;
  }

  _project(projectId) {
    const project = this.db.projects.find((entry) => entry.id === projectId);
    if (!project) throw new V8ProjectStoreError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    return project;
  }
}

module.exports = {
  V8ProjectStore,
  V8ProjectStoreError,
};
