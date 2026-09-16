'use strict';

const base = require('./connectionCenterServiceV8');
const { sanitizeConnectionProfile, COLLECTION_LIMITS } = require('./project/schema');

class ConnectionCenterServiceV8 extends base.ConnectionCenterServiceV8 {
  importProfiles(payload, projectId = this.activeProjectId()) {
    if (payload && !Array.isArray(payload)) {
      if (payload.format != null && payload.format !== 'modbus-workbench-v8-connections') {
        throw new base.ConnectionCenterError('INVALID_IMPORT', 'Unsupported connection import format', { format: payload.format });
      }
      if (payload.version != null && Number(payload.version) !== 1) {
        throw new base.ConnectionCenterError('INVALID_IMPORT', 'Unsupported connection import version', { version: payload.version });
      }
    }
    const profiles = Array.isArray(payload) ? payload : payload?.profiles;
    if (!Array.isArray(profiles)) throw new base.ConnectionCenterError('INVALID_IMPORT', 'Connection import must contain a profiles array');
    const max = COLLECTION_LIMITS.connections || 2000;
    if (profiles.length > max) throw new base.ConnectionCenterError('INVALID_IMPORT', `Connection import exceeds ${max} profiles`, { count: profiles.length, max });

    const project = this.store.getProject(projectId);
    if (!project) throw new base.ConnectionCenterError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const seen = new Set();
    const normalized = profiles.map((profile, index) => {
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new base.ConnectionCenterError('INVALID_IMPORT', `Profile ${index + 1} must be an object`, { index });
      const persistent = base.normalizePersistentTransportOptions(profile);
      const safe = sanitizeConnectionProfile(persistent, { index });
      if (seen.has(safe.connectionId)) throw new base.ConnectionCenterError('INVALID_IMPORT', `Duplicate connection ID ${safe.connectionId}`, { connectionId: safe.connectionId });
      seen.add(safe.connectionId);
      if (safe.sourceChannelId != null && !project.channels?.[safe.sourceChannelId]) {
        throw new base.ConnectionCenterError('INVALID_IMPORT', `Connection ${safe.connectionId} references unknown channel ${safe.sourceChannelId}`, { connectionId: safe.connectionId, sourceChannelId: safe.sourceChannelId });
      }
      // Constructing validates transport-specific configuration without opening network/serial I/O.
      this.transportFactory(safe);
      return persistent;
    });

    const original = this.store.listConnectionProfiles(projectId);
    try {
      return normalized.map((profile) => this.saveProfile(profile, projectId));
    } catch (error) {
      // Restore persistence first, then remove any inactive definitions created/replaced
      // during this import so sync() must rebuild them from the original profiles.
      this.store.updateProject(projectId, { connections: original });
      for (const connectionId of seen) {
        if (!this._hasRuntime(connectionId)) continue;
        const runtime = this.broker.getConnection(connectionId);
        if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) continue;
        try {
          this.broker.removeConnection(connectionId);
          this.transports.delete(connectionId);
        } catch { /* preserve the original import error and continue rollback */ }
      }
      try { this.sync(projectId); } catch { /* retain original import error */ }
      throw error;
    }
  }
}

module.exports = {
  ...base,
  ConnectionCenterService: ConnectionCenterServiceV8,
  ConnectionCenterServiceV8,
};
