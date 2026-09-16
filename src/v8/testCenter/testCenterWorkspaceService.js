'use strict';

const { EventEmitter } = require('node:events');
const { MasterEngine } = require('../master/masterEngine');
const { WriteAuditTrail, WriteSafetyController } = require('../master/writeSafety');
const { RawFrameStudio } = require('./rawFrameStudio');
const { RecipeEngine, validateRecipe } = require('./recipeEngine');

class TestCenterWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TestCenterWorkspaceError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TestCenterWorkspaceError);
  }
}

function collectConnectionIds(steps, fallback, target = new Set()) {
  for (const step of steps || []) {
    const connectionId = String(step?.connectionId || fallback || '').trim();
    if (connectionId) target.add(connectionId);
    if (step?.type === 'repeat' && Array.isArray(step.steps)) collectConnectionIds(step.steps, fallback, target);
  }
  return target;
}

class TestCenterWorkspaceService extends EventEmitter {
  constructor({ store, broker, connectionCenter } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!broker) throw new TypeError('broker is required');
    if (!connectionCenter) throw new TypeError('connectionCenter is required');
    this.store = store;
    this.broker = broker;
    this.connectionCenter = connectionCenter;
    this.sessions = new Map();
    this.lastRun = null;
    this.recipe = new RecipeEngine({ resolveContext: (connectionId) => this.sessions.get(connectionId)?.context || null });
    this.recipe.on('event', (event) => this.emit('event', event));
  }

  snapshot(projectId = this.connectionCenter.activeProjectId()) {
    const connections = this.connectionCenter.inventory(projectId).map((item) => {
      const session = this.sessions.get(item.profile.connectionId);
      return Object.freeze({
        connectionId: item.profile.connectionId,
        name: item.profile.name,
        transportKind: item.profile.transportKind,
        endpoint: item.profile.endpoint,
        eligible: this._eligible(item.profile),
        runtime: item.runtime,
        session: session ? Object.freeze({
          framing: session.framing,
          raw: session.raw.status(),
          writes: session.safety.status(),
          rawAuditEntries: session.raw.listAudit({ limit: 1_000_000 }).length,
          writeAuditEntries: session.writeAudit.list({ limit: 1_000_000 }).length,
        }) : null,
      });
    });
    return Object.freeze({
      projectId,
      recipe: this.recipe.status(),
      lastRun: this.lastRun,
      connections: Object.freeze(connections),
    });
  }

  async open(connectionId, projectId = this.connectionCenter.activeProjectId()) {
    const session = await this._ensureSession(connectionId, projectId);
    return Object.freeze({ connection: this.connectionCenter.get(connectionId), session: this._sessionView(session) });
  }

  async disconnect(connectionId) {
    const session = this.sessions.get(connectionId);
    if (!session) {
      const runtime = this.broker.getConnection(connectionId);
      if (runtime.owner?.ownerMode === 'test') await this.connectionCenter.deactivate(connectionId);
      return this.connectionCenter.get(connectionId);
    }
    try { session.raw.disarmLab('disconnect'); } catch { /* best effort */ }
    try { session.safety.lock({ reason: 'disconnect' }); } catch { /* already closed/locked */ }
    const runtime = this.broker.getConnection(connectionId);
    if (runtime.owner?.ownerMode === 'test' && runtime.owner?.ownerId === session.ownerId) {
      await this.connectionCenter.deactivate(connectionId);
    }
    this.sessions.delete(connectionId);
    this._emit('test-center.session-closed', { connectionId });
    return this.connectionCenter.get(connectionId);
  }

  async sendRaw(input = {}) {
    const session = await this._ensureSession(input.connectionId);
    return session.raw.send(input);
  }

  async repeatRaw(input = {}) {
    const session = await this._ensureSession(input.connectionId);
    return session.raw.repeat(input);
  }

  async armLab(connectionId, options = {}) {
    const session = await this._ensureSession(connectionId);
    return session.raw.armLab(options);
  }

  disarmLab(connectionId, reason = 'manual') {
    return this._session(connectionId).raw.disarmLab(reason);
  }

  async armWrites(connectionId, { durationMs = 10000, confirmation = null } = {}) {
    const session = await this._ensureSession(connectionId);
    return session.safety.unlock({ durationMs, confirmation });
  }

  lockWrites(connectionId, reason = 'manual') {
    return this._session(connectionId).safety.lock({ reason });
  }

  audit(connectionId, { limit = 200 } = {}) {
    const session = this._session(connectionId);
    return Object.freeze({
      raw: session.raw.listAudit({ limit }),
      writes: session.writeAudit.list({ limit }),
    });
  }

  async runRecipe(recipe, { variables = {}, defaultConnectionId = null, signal = null } = {}) {
    validateRecipe(recipe);
    const fallback = String(defaultConnectionId || '').trim() || null;
    const connectionIds = collectConnectionIds(recipe.steps, fallback);
    if (!connectionIds.size) throw new TestCenterWorkspaceError('RECIPE_CONNECTION_REQUIRED', 'Recipe requires a defaultConnectionId or connectionId on executable I/O steps');
    for (const connectionId of connectionIds) await this._ensureSession(connectionId);
    try {
      const result = await this.recipe.run(recipe, { variables, defaultConnectionId: fallback, signal });
      this.lastRun = result;
      return result;
    } catch (error) {
      if (error?.recipeResult) this.lastRun = error.recipeResult;
      throw error;
    }
  }

  pauseRecipe() { this.recipe.pause(); return this.recipe.status(); }
  resumeRecipe() { this.recipe.resume(); return this.recipe.status(); }
  stopRecipe() { this.recipe.stop(); return this.recipe.status(); }

  async shutdown() {
    this.recipe.stop();
    for (const connectionId of [...this.sessions.keys()]) {
      try { await this.disconnect(connectionId); } catch { /* best effort shutdown */ }
    }
  }

  async _ensureSession(connectionId, projectId = this.connectionCenter.activeProjectId()) {
    connectionId = String(connectionId || '').trim();
    if (!connectionId) throw new TestCenterWorkspaceError('CONNECTION_REQUIRED', 'connectionId is required');
    const existing = this.sessions.get(connectionId);
    if (existing) {
      const runtime = this.broker.getConnection(connectionId);
      if (runtime.state !== 'open') await existing.context.master.open();
      return existing;
    }

    const profile = this.connectionCenter.listProfiles(projectId).find((entry) => entry.connectionId === connectionId);
    if (!profile) throw new TestCenterWorkspaceError('PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { connectionId, projectId });
    if (!this._eligible(profile)) throw new TestCenterWorkspaceError('TEST_TRANSPORT_UNSUPPORTED', 'Test Center requires serial RTU/ASCII, TCP/UDP client or virtual transport', { connectionId, transportKind: profile.transportKind });
    const framing = this._framing(profile);
    const ownerId = `v8-ui:test:${connectionId}`;
    await this.connectionCenter.activate(connectionId, { ownerMode: 'test', ownerId }, projectId);

    const engine = new MasterEngine({ broker: this.broker, connectionId, ownerId, framing });
    const raw = new RawFrameStudio({ broker: this.broker, connectionId, ownerId, framing });
    const writeAudit = new WriteAuditTrail();
    const contextMaster = {
      broker: this.broker,
      connectionId,
      request: (options) => engine.request(options),
      setWriteEnabled: (enabled) => engine.setWriteEnabled(enabled),
      open: async () => {
        const runtime = this.broker.getConnection(connectionId);
        if (runtime.state === 'open') {
          if (runtime.owner?.ownerMode !== 'test' || runtime.owner?.ownerId !== ownerId) throw new TestCenterWorkspaceError('OWNER_MISMATCH', 'Connection is owned by another workspace', { connectionId, owner: runtime.owner });
          return runtime;
        }
        return this.connectionCenter.activate(connectionId, { ownerMode: 'test', ownerId }, projectId);
      },
      close: async () => {
        try { raw.disarmLab('recipe-disconnect'); } catch { /* best effort */ }
        try { engine.setWriteEnabled(false); } catch { /* already closed */ }
        const runtime = this.broker.getConnection(connectionId);
        if (runtime.owner?.ownerMode === 'test' && runtime.owner?.ownerId === ownerId) return this.connectionCenter.deactivate(connectionId);
        return runtime;
      },
    };
    const safety = new WriteSafetyController({ master: contextMaster, auditTrail: writeAudit, userId: 'v8-local-user', sessionId: `test:${connectionId}` });
    const context = { master: contextMaster, writeSafety: safety, rawFrameStudio: raw };
    const session = { connectionId, projectId, profile, framing, ownerId, engine, raw, safety, writeAudit, context };
    engine.on('event', (event) => this.emit('event', event));
    raw.on('event', (event) => this.emit('event', event));
    safety.on('event', (event) => this.emit('event', event));
    this.sessions.set(connectionId, session);
    this._emit('test-center.session-opened', { connectionId, projectId, framing });
    return session;
  }

  _session(connectionId) {
    const session = this.sessions.get(String(connectionId || '').trim());
    if (!session) throw new TestCenterWorkspaceError('TEST_SESSION_NOT_OPEN', `Test Center session ${connectionId} is not open`, { connectionId });
    return session;
  }

  _sessionView(session) {
    return Object.freeze({
      connectionId: session.connectionId,
      framing: session.framing,
      raw: session.raw.status(),
      writes: session.safety.status(),
    });
  }

  _eligible(profile) {
    return ['serial-rtu', 'serial-ascii', 'tcp-client', 'udp-client', 'virtual'].includes(String(profile?.transportKind || '').toLowerCase());
  }

  _framing(profile) {
    const kind = String(profile?.transportKind || '').toLowerCase();
    if (kind === 'serial-ascii') return 'ascii';
    if (kind === 'tcp-client' || kind === 'udp-client') return 'tcp';
    return 'rtu';
  }

  _emit(type, details) {
    this.emit('event', Object.freeze({ type, source: 'test-center-workspace', at: Date.now(), details: Object.freeze({ ...details }) }));
  }
}

module.exports = {
  TestCenterWorkspaceError,
  TestCenterWorkspaceService,
  collectConnectionIds,
};
