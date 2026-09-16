'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  V8_WORKSPACE_FORMAT,
  createV8Workspace,
  loadV8Workspace,
  migrateV7Workspace,
} = require('./projectSchema');

class ProjectStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectStoreError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ProjectStoreError);
  }
}

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseJsonFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ProjectStoreError('PROJECT_JSON_CORRUPT', `Project file is not valid JSON: ${file}`, { file, cause: error.message });
  }
}

class V8ProjectStore {
  constructor({ dataDir = path.join(process.cwd(), 'data'), file = null, autoCreate = true } = {}) {
    this.dataDir = dataDir;
    this.file = file || path.join(dataDir, 'v8-workspace.json');
    this.backupFile = `${this.file}.bak`;
    this.lastMigrationReport = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.workspace = this._load({ autoCreate });
  }

  _load({ autoCreate }) {
    if (!fs.existsSync(this.file)) {
      if (fs.existsSync(this.backupFile)) {
        try {
          const recovered = loadV8Workspace(parseJsonFile(this.backupFile));
          this._atomicWrite(recovered, { backupExisting: false });
          this.lastMigrationReport = Object.freeze({ recoveredFromBackup: true, backupFile: this.backupFile, recoveredAt: new Date().toISOString() });
          return recovered;
        } catch (error) {
          throw new ProjectStoreError('PROJECT_RECOVERY_FAILED', 'Primary project is missing and backup recovery failed', { backupFile: this.backupFile, cause: error.message });
        }
      }
      const empty = createV8Workspace({ projects: [] });
      if (autoCreate) this._atomicWrite(empty, { backupExisting: false });
      return empty;
    }

    let parsed;
    try {
      parsed = parseJsonFile(this.file);
    } catch (error) {
      const preserved = `${this.file}.corrupt-${safeStamp()}`;
      try { fs.copyFileSync(this.file, preserved); } catch { /* preserve best effort */ }
      throw new ProjectStoreError('PROJECT_JSON_CORRUPT', error.message, { file: this.file, preserved, backupFile: fs.existsSync(this.backupFile) ? this.backupFile : null });
    }

    if (parsed?.format === V8_WORKSPACE_FORMAT) {
      try {
        return loadV8Workspace(parsed);
      } catch (error) {
        throw new ProjectStoreError('PROJECT_SCHEMA_INVALID', error.message, { file: this.file, causeCode: error.code || null });
      }
    }

    if (Number(parsed?.version) === 2 && Array.isArray(parsed.projects) && Array.isArray(parsed.profiles)) {
      const migrationBackup = `${this.file}.v7-backup-${safeStamp()}`;
      fs.copyFileSync(this.file, migrationBackup);
      const migrated = migrateV7Workspace(parsed);
      this._atomicWrite(migrated.workspace, { backupExisting: true });
      const reportFile = `${this.file}.migration-${safeStamp()}.json`;
      fs.writeFileSync(reportFile, JSON.stringify({ ...migrated.report, backupFile: migrationBackup }, null, 2));
      this.lastMigrationReport = Object.freeze({ ...migrated.report, backupFile: migrationBackup, reportFile });
      return migrated.workspace;
    }

    throw new ProjectStoreError('UNSUPPORTED_PROJECT_FORMAT', 'Project file is neither v8 workspace format nor supported v7 workspace schema v2', { file: this.file });
  }

  _atomicWrite(workspace, { backupExisting = true } = {}) {
    const safe = loadV8Workspace(cloneJson(workspace));
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`;
    const existed = fs.existsSync(this.file);
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
    let fd = null;
    try {
      fd = fs.openSync(tmp, 'r');
      try { fs.fsyncSync(fd); } catch (error) {
        if (!['EINVAL', 'ENOTSUP', 'ENOSYS', 'EPERM'].includes(error?.code)) throw error;
      }
    } finally {
      if (fd != null) fs.closeSync(fd);
    }

    if (existed && backupExisting) fs.copyFileSync(this.file, this.backupFile);
    try {
      fs.renameSync(tmp, this.file);
    } catch (error) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore cleanup */ }
      throw new ProjectStoreError('PROJECT_SAVE_FAILED', `Unable to replace project file: ${error.message}`, { file: this.file, cause: error.code || null });
    }
    return safe;
  }

  save(workspace = this.workspace) {
    const safe = this._atomicWrite(workspace, { backupExisting: true });
    this.workspace = safe;
    return this.snapshot();
  }

  snapshot() {
    return cloneJson(this.workspace);
  }

  listProjects() {
    return Object.freeze(this.workspace.projects.map((project) => Object.freeze({
      projectId: project.projectId,
      name: project.name,
      site: project.site,
      bus: project.bus,
      updatedAt: project.updatedAt,
      active: project.projectId === this.workspace.activeProjectId,
    })));
  }

  getProject(projectId) {
    const project = this.workspace.projects.find((item) => item.projectId === projectId);
    return project ? cloneJson(project) : null;
  }

  replaceProject(project) {
    const normalizedWorkspace = createV8Workspace({
      ...cloneJson(this.workspace),
      projects: this.workspace.projects.map((item) => item.projectId === project.projectId ? project : item),
    });
    if (!normalizedWorkspace.projects.some((item) => item.projectId === project.projectId)) {
      throw new ProjectStoreError('PROJECT_NOT_FOUND', `Project ${project.projectId} does not exist`, { projectId: project.projectId });
    }
    return this.save(normalizedWorkspace);
  }

  setActiveProject(projectId) {
    if (!this.workspace.projects.some((project) => project.projectId === projectId)) {
      throw new ProjectStoreError('PROJECT_NOT_FOUND', `Project ${projectId} does not exist`, { projectId });
    }
    return this.save(createV8Workspace({ ...cloneJson(this.workspace), activeProjectId: projectId }));
  }
}

module.exports = {
  ProjectStoreError,
  V8ProjectStore,
  parseJsonFile,
};
