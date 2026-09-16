'use strict';

const {
  MasterWorkspaceService: BaseMasterWorkspaceService,
  MasterWorkspaceError,
  normalizePersistentJob,
} = require('./masterWorkspaceService');

function clampLimit(value, fallback = 200) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) return fallback;
  return Math.min(numeric, 100000);
}

const MASTER_CLIENT_KINDS = Object.freeze(new Set([
  'serial-rtu',
  'serial-ascii',
  'tcp-client',
  'udp-client',
  'tls-client',
  'rtu-tcp-client',
  'ascii-tcp-client',
  'rtu-udp-client',
  'ascii-udp-client',
  'virtual',
]));

class MasterWorkspaceService extends BaseMasterWorkspaceService {
  saveJob(input, projectId = this.connectionCenter.activeProjectId()) {
    const project = this.store.getProject(projectId);
    if (!project) throw new MasterWorkspaceError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });

    const connectionId = String(input?.connectionId || '').trim();
    const profile = this._profile(connectionId, projectId);
    const framing = this._framing(profile);
    const jobs = Array.isArray(project.masterJobs) ? project.masterJobs : [];
    const jobId = String(input?.jobId || '').trim();
    const existingIndex = jobs.findIndex((entry) => entry.jobId === jobId);
    const existing = existingIndex >= 0 ? jobs[existingIndex] : null;

    if (existing && existing.connectionId !== connectionId) {
      throw new MasterWorkspaceError('MASTER_JOB_CONNECTION_IMMUTABLE', 'Move a job by deleting and recreating it on the target connection', { jobId: existing.jobId });
    }

    const job = normalizePersistentJob(input, { framing, existing });
    const session = this.sessions.get(connectionId);
    const runtimeJob = session?.loadedJobs.has(job.jobId) ? session.scheduler.jobs.get(job.jobId) : null;
    if (runtimeJob?.inFlight) {
      throw new MasterWorkspaceError('JOB_BUSY', 'Cannot modify an in-flight poll job', { jobId: job.jobId, connectionId });
    }

    const previousJobs = jobs.map((entry) => ({ ...entry }));
    const nextJobs = jobs.map((entry) => ({ ...entry }));
    if (existingIndex >= 0) nextJobs[existingIndex] = job;
    else nextJobs.push(job);
    this.store.updateProject(projectId, { masterJobs: nextJobs });

    try {
      if (session) {
        if (session.loadedJobs.has(job.jobId)) {
          session.scheduler.updateJob(job.jobId, this._schedulerJob(job));
        } else {
          session.scheduler.addJob(this._schedulerJob(job));
          session.loadedJobs.add(job.jobId);
        }
      }
    } catch (error) {
      this.store.updateProject(projectId, { masterJobs: previousJobs });
      if (error?.code === 'JOB_BUSY') {
        throw new MasterWorkspaceError('JOB_BUSY', 'Cannot modify an in-flight poll job', { jobId: job.jobId, connectionId });
      }
      throw error;
    }

    this._emit('master.job-saved', { projectId, connectionId, jobId: job.jobId });
    return job;
  }

  snapshot(projectId = this.connectionCenter.activeProjectId()) {
    const base = super.snapshot(projectId);
    const connections = base.connections.map((entry) => {
      const session = this.sessions.get(entry.connectionId);
      return Object.freeze({
        ...entry,
        schedulerJobs: session ? session.scheduler.listJobs() : Object.freeze([]),
      });
    });
    return Object.freeze({ ...base, connections: Object.freeze(connections) });
  }

  audit({ limit = 200, connectionId = null } = {}) {
    const safeLimit = clampLimit(limit);
    const rows = [];
    for (const [sessionConnectionId, session] of this.sessions) {
      if (connectionId != null && sessionConnectionId !== connectionId) continue;
      for (const record of session.auditTrail.list({ limit: safeLimit })) {
        rows.push(record.connectionId ? record : Object.freeze({ ...record, connectionId: sessionConnectionId }));
      }
    }
    rows.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0) || String(a.auditId || '').localeCompare(String(b.auditId || '')));
    return Object.freeze(rows.slice(-safeLimit));
  }

  _isMasterEligible(profile) {
    return MASTER_CLIENT_KINDS.has(String(profile?.transportKind || '').toLowerCase());
  }

  _framing(profile) {
    const kind = String(profile?.transportKind || '').toLowerCase();
    if (['serial-ascii', 'ascii-tcp-client', 'ascii-udp-client'].includes(kind)) return 'ascii';
    if (['tcp-client', 'udp-client', 'tls-client'].includes(kind)) return 'tcp';
    return 'rtu';
  }
}

module.exports = {
  MASTER_CLIENT_KINDS,
  MasterWorkspaceService,
};
