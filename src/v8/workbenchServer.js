'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { ConnectionBroker } = require('./connectionBroker');
const { listSerialPorts } = require('./transports/serialTransport');
const { listLocalAddresses } = require('./transports/networkAddresses');
const { V8ProjectStore, V8_PROJECT_SCHEMA_VERSION } = require('./project');
const { buildProfileRuntime, describeProfileRuntime, profileFingerprint } = require('./connectionProfileRuntime');

const SAFE_OWNER_MODES = Object.freeze(new Set(['analyzer', 'master', 'slave', 'proxy', 'discovery', 'test', 'replay']));

class V8WorkbenchServerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V8WorkbenchServerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, V8WorkbenchServerError);
  }
}

function profileKey(projectId, connectionId) {
  return `${projectId}::${connectionId}`;
}

function runtimeConnectionId(projectId, connectionId) {
  return `v8:${projectId}:${connectionId}`;
}

function ownerIdFor(projectId, connectionId) {
  return `v8-shell:${projectId}:${connectionId}`;
}

function safeError(error) {
  return {
    error: String(error?.message || error),
    code: error?.code || 'ERROR',
    details: error?.details && typeof error.details === 'object' ? error.details : undefined,
  };
}

function mutationSameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site') return res.status(403).json({ error: 'Cross-site mutation blocked.', code: 'CROSS_SITE_MUTATION_BLOCKED' });
  const origin = req.get('origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== req.get('host')) return res.status(403).json({ error: 'Origin does not match this workbench.', code: 'ORIGIN_MISMATCH' });
    } catch {
      return res.status(403).json({ error: 'Invalid Origin header.', code: 'INVALID_ORIGIN' });
    }
  }
  return next();
}

function findProfile(store, projectId, connectionId) {
  const project = store.getProject(projectId);
  if (!project) throw new V8WorkbenchServerError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
  const profile = (project.connections || []).find((entry) => entry.connectionId === connectionId);
  if (!profile) throw new V8WorkbenchServerError('CONNECTION_PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { projectId, connectionId });
  return { project, profile };
}

function projectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    site: project.site,
    bus: project.bus,
    description: project.description,
    ui: project.ui,
    connectionCount: (project.connections || []).length,
    masterJobCount: (project.masterJobs || []).length,
    simulatorCount: (project.slaveServers || []).length,
    updatedAt: project.updatedAt,
  };
}

async function startV8WorkbenchServer({
  dataDir = path.join(process.cwd(), 'data'),
  host = '127.0.0.1',
  port = 18778,
  store = null,
  broker = null,
  quiet = false,
} = {}) {
  if (typeof host !== 'string' || !host.trim()) throw new TypeError('host is required');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be 0..65535');

  const projects = store || new V8ProjectStore({ dataDir });
  const connections = broker || new ConnectionBroker();
  const runtimes = new Map();
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/v8/ws' });
  const publicDir = path.join(__dirname, '..', '..', 'public', 'v8');

  app.disable('x-powered-by');
  app.enable('strict routing');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache, no-store, must-revalidate');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(mutationSameOriginGuard);

  const activeProject = () => projects.getActiveProject();
  const broadcast = (type, payload) => {
    const message = JSON.stringify({ type, payload });
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(message);
  };

  const runtimeSnapshot = (projectId, connectionId) => {
    const key = profileKey(projectId, connectionId);
    const runtime = runtimes.get(key);
    if (!runtime) return null;
    let brokerState = null;
    try { brokerState = connections.getConnection(runtime.runtimeId); } catch { brokerState = null; }
    let transport = null;
    try { transport = runtime.transport?.status?.() || null; } catch { transport = null; }
    return {
      runtimeId: runtime.runtimeId,
      projectId,
      connectionId,
      fingerprint: runtime.fingerprint,
      ownerMode: brokerState?.owner?.ownerMode || null,
      ownerId: brokerState?.owner?.ownerId || null,
      state: brokerState?.state || 'unknown',
      transportState: brokerState?.transportState || transport?.state || 'unknown',
      writeLock: brokerState?.writeLock || 'LOCKED',
      transmitCapability: brokerState?.transmitCapability || 'none',
      faultInjectionEnabled: Boolean(brokerState?.faultInjectionEnabled),
      transport,
    };
  };

  const inventory = (projectId = activeProject()?.id) => {
    const project = projects.getProject(projectId);
    if (!project) throw new V8WorkbenchServerError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    return (project.connections || []).map((profile) => {
      let descriptor = null;
      let validationError = null;
      try { descriptor = describeProfileRuntime(profile); } catch (error) { validationError = safeError(error); }
      return {
        profile,
        descriptor,
        runtime: runtimeSnapshot(project.id, profile.connectionId),
        validationError,
      };
    });
  };

  const cleanupRuntime = async (projectId, connectionId, { remove = true } = {}) => {
    const key = profileKey(projectId, connectionId);
    const runtime = runtimes.get(key);
    if (!runtime) return null;
    let status = null;
    try { status = connections.getConnection(runtime.runtimeId); } catch { status = null; }
    try {
      if (status && ['open', 'error'].includes(status.state)) await connections.close(runtime.runtimeId, { ownerId: runtime.ownerId });
    } catch { /* continue cleanup */ }
    try {
      status = connections.getConnection(runtime.runtimeId);
      if (status.owner?.ownerId === runtime.ownerId && !['open', 'opening', 'closing'].includes(status.state)) connections.release(runtime.runtimeId, { ownerId: runtime.ownerId });
    } catch { /* continue cleanup */ }
    if (remove) {
      try { connections.removeConnection(runtime.runtimeId); } catch { /* continue cleanup */ }
    }
    try { await runtime.cleanup?.(); } catch { /* continue cleanup */ }
    runtimes.delete(key);
    return status;
  };

  const openProfile = async (projectId, connectionId, ownerMode = 'master') => {
    ownerMode = String(ownerMode || 'master').toLowerCase();
    if (!SAFE_OWNER_MODES.has(ownerMode)) throw new V8WorkbenchServerError('INVALID_OWNER_MODE', `Unsupported owner mode ${ownerMode}`, { ownerMode });
    const { profile } = findProfile(projects, projectId, connectionId);
    const key = profileKey(projectId, connectionId);
    const fingerprint = profileFingerprint(profile);
    const existing = runtimes.get(key);
    if (existing) {
      const snap = runtimeSnapshot(projectId, connectionId);
      if (existing.fingerprint !== fingerprint) throw new V8WorkbenchServerError('PROFILE_CHANGED_WHILE_ACTIVE', 'Close this connection before applying changed profile settings.', { projectId, connectionId });
      if (snap?.state === 'open') {
        if (snap.ownerMode !== ownerMode) throw new V8WorkbenchServerError('OWNER_MODE_CONFLICT', `Connection is already open as ${snap.ownerMode}`, { currentOwnerMode: snap.ownerMode, requestedOwnerMode: ownerMode });
        return snap;
      }
      await cleanupRuntime(projectId, connectionId);
    }

    const built = await buildProfileRuntime(profile);
    const runtimeId = runtimeConnectionId(projectId, connectionId);
    const ownerId = ownerIdFor(projectId, connectionId);
    connections.defineConnection({
      connectionId: runtimeId,
      resourceKey: built.resourceKey,
      transportKind: built.kind,
      transport: built.transport,
      exclusive: built.exclusive,
      metadata: { projectId, profileConnectionId: connectionId },
    });
    const runtime = { ...built, runtimeId, ownerId, fingerprint };
    runtimes.set(key, runtime);
    try {
      await connections.open(runtimeId, { ownerMode, ownerId });
      const snap = runtimeSnapshot(projectId, connectionId);
      broadcast('connection-state', snap);
      return snap;
    } catch (error) {
      await cleanupRuntime(projectId, connectionId);
      throw error;
    }
  };

  const closeProfile = async (projectId, connectionId) => {
    const before = runtimeSnapshot(projectId, connectionId);
    if (!before) return { projectId, connectionId, state: 'closed', writeLock: 'LOCKED', transmitCapability: 'none' };
    await cleanupRuntime(projectId, connectionId);
    const after = { projectId, connectionId, state: 'closed', transportState: 'closed', ownerMode: null, ownerId: null, writeLock: 'LOCKED', transmitCapability: 'none', faultInjectionEnabled: false };
    broadcast('connection-state', after);
    return after;
  };

  const testProfile = async (projectId, connectionId) => {
    if (runtimes.has(profileKey(projectId, connectionId))) throw new V8WorkbenchServerError('CONNECTION_ACTIVE', 'Close the active connection before running Test Connection.', { projectId, connectionId });
    const { profile } = findProfile(projects, projectId, connectionId);
    const built = await buildProfileRuntime(profile);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const runtimeId = `v8-test:${projectId}:${connectionId}:${suffix}`;
    const ownerId = `v8-test:${suffix}`;
    connections.defineConnection({ connectionId: runtimeId, resourceKey: built.resourceKey, transportKind: built.kind, transport: built.transport, exclusive: built.exclusive, metadata: { projectId, profileConnectionId: connectionId, testOnly: true } });
    const startedAt = Date.now();
    let transportStatus = null;
    try {
      await connections.open(runtimeId, { ownerMode: 'discovery', ownerId });
      transportStatus = built.transport?.status?.() || null;
      const brokerStatus = connections.getConnection(runtimeId);
      return { ok: true, elapsedMs: Date.now() - startedAt, broker: brokerStatus, transport: transportStatus, writesArmed: brokerStatus.writeLock === 'ENABLED' };
    } finally {
      try {
        const state = connections.getConnection(runtimeId);
        if (['open', 'error'].includes(state.state)) await connections.close(runtimeId, { ownerId });
      } catch { /* ignore test cleanup */ }
      try {
        const state = connections.getConnection(runtimeId);
        if (state.owner?.ownerId === ownerId) connections.release(runtimeId, { ownerId });
      } catch { /* ignore test cleanup */ }
      try { connections.removeConnection(runtimeId); } catch { /* ignore test cleanup */ }
      try { await built.cleanup?.(); } catch { /* ignore test cleanup */ }
    }
  };

  connections.on('event', (event) => {
    broadcast('broker-event', event);
    const runtime = [...runtimes.entries()].find(([, item]) => item.runtimeId === event.connectionId);
    if (runtime) {
      const [key] = runtime;
      const [projectId, connectionId] = key.split('::');
      broadcast('connection-state', runtimeSnapshot(projectId, connectionId));
    }
  });

  app.get('/api/v8/status', (_req, res) => {
    const project = activeProject();
    res.json({
      product: 'Modbus Engineering Workbench',
      preview: true,
      productMajor: 8,
      stableRelease: '7.0.0',
      schemaVersion: V8_PROJECT_SCHEMA_VERSION,
      activeProject: project ? projectSummary(project) : null,
      connectionCount: project ? (project.connections || []).length : 0,
      activeRuntimeConnections: runtimes.size,
      writePolicy: 'locked-by-default',
    });
  });

  app.get('/api/v8/projects', (_req, res) => res.json({ activeProjectId: projects.db.activeProjectId, projects: projects.listProjects() }));
  app.get('/api/v8/project', (_req, res) => res.json(activeProject()));
  app.post('/api/v8/projects/:projectId/select', (req, res) => {
    try {
      if (runtimes.size) throw new V8WorkbenchServerError('ACTIVE_CONNECTIONS', 'Close active v8 connections before switching projects.');
      const project = projects.setActiveProject(req.params.projectId);
      broadcast('project', project);
      res.json(project);
    } catch (error) { res.status(409).json(safeError(error)); }
  });

  app.get('/api/v8/connections', (req, res) => {
    try { res.json({ projectId: req.query.projectId || activeProject()?.id, connections: inventory(req.query.projectId || undefined) }); }
    catch (error) { res.status(400).json(safeError(error)); }
  });

  app.get('/api/v8/connections/:connectionId/diagnostics', (req, res) => {
    try {
      const projectId = String(req.query.projectId || activeProject()?.id || '');
      const found = findProfile(projects, projectId, req.params.connectionId);
      let descriptor = null;
      try { descriptor = describeProfileRuntime(found.profile); } catch (error) { return res.status(400).json(safeError(error)); }
      res.json({ projectId, profile: found.profile, descriptor, runtime: runtimeSnapshot(projectId, req.params.connectionId) });
    } catch (error) { res.status(404).json(safeError(error)); }
  });

  app.put('/api/v8/projects/:projectId/connections/:connectionId', (req, res) => {
    try {
      if (runtimes.has(profileKey(req.params.projectId, req.params.connectionId))) throw new V8WorkbenchServerError('CONNECTION_ACTIVE', 'Close this connection before editing its profile.');
      const input = { ...(req.body || {}), connectionId: req.params.connectionId };
      // Validate the candidate before any project mutation so invalid runtime settings never persist.
      describeProfileRuntime(input);
      const saved = projects.upsertConnectionProfile(req.params.projectId, input);
      describeProfileRuntime(saved);
      broadcast('profiles', { projectId: req.params.projectId, connections: inventory(req.params.projectId) });
      res.json(saved);
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.delete('/api/v8/projects/:projectId/connections/:connectionId', (req, res) => {
    try {
      if (runtimes.has(profileKey(req.params.projectId, req.params.connectionId))) throw new V8WorkbenchServerError('CONNECTION_ACTIVE', 'Close this connection before deleting its profile.');
      const ok = projects.removeConnectionProfile(req.params.projectId, req.params.connectionId);
      broadcast('profiles', { projectId: req.params.projectId, connections: inventory(req.params.projectId) });
      res.json({ ok });
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.post('/api/v8/projects/:projectId/connections/:connectionId/duplicate', (req, res) => {
    try {
      const { profile } = findProfile(projects, req.params.projectId, req.params.connectionId);
      const newId = String(req.body?.connectionId || '').trim();
      if (!newId) throw new V8WorkbenchServerError('CONNECTION_ID_REQUIRED', 'New connectionId is required.');
      const clone = { ...profile, ...req.body, connectionId: newId, id: newId, sourceChannelId: null, name: req.body?.name || `${profile.name} Copy` };
      describeProfileRuntime(clone);
      const saved = projects.upsertConnectionProfile(req.params.projectId, clone);
      describeProfileRuntime(saved);
      broadcast('profiles', { projectId: req.params.projectId, connections: inventory(req.params.projectId) });
      res.json(saved);
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.get('/api/v8/projects/:projectId/connections/export.json', (req, res) => {
    try {
      const project = projects.getProject(req.params.projectId);
      if (!project) throw new V8WorkbenchServerError('PROJECT_NOT_FOUND', 'Project not found.');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.projectId}-connections.json"`);
      res.json({ schemaVersion: V8_PROJECT_SCHEMA_VERSION, projectId: req.params.projectId, connections: project.connections || [] });
    } catch (error) { res.status(404).json(safeError(error)); }
  });

  app.post('/api/v8/projects/:projectId/connections/import', (req, res) => {
    try {
      const list = Array.isArray(req.body) ? req.body : req.body?.connections;
      if (!Array.isArray(list) || list.length > 2000) throw new V8WorkbenchServerError('INVALID_IMPORT', 'connections must be an array with at most 2000 profiles.');
      const candidates = [];
      const seen = new Set();
      for (const profile of list) {
        const connectionId = String(profile?.connectionId || profile?.id || '').trim();
        if (!connectionId) throw new V8WorkbenchServerError('INVALID_IMPORT', 'Every imported profile requires connectionId.');
        if (seen.has(connectionId)) throw new V8WorkbenchServerError('INVALID_IMPORT', `Duplicate connectionId ${connectionId} in import payload.`, { connectionId });
        seen.add(connectionId);
        if (runtimes.has(profileKey(req.params.projectId, connectionId))) throw new V8WorkbenchServerError('CONNECTION_ACTIVE', `Cannot overwrite active connection ${connectionId}.`);
        const candidate = { ...profile, connectionId };
        describeProfileRuntime(candidate);
        candidates.push(candidate);
      }
      const saved = [];
      for (const candidate of candidates) {
        const value = projects.upsertConnectionProfile(req.params.projectId, candidate);
        describeProfileRuntime(value);
        saved.push(value);
      }
      broadcast('profiles', { projectId: req.params.projectId, connections: inventory(req.params.projectId) });
      res.json({ ok: true, imported: saved.length });
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.post('/api/v8/connections/:connectionId/open', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || activeProject()?.id || '');
      res.json(await openProfile(projectId, req.params.connectionId, req.body?.ownerMode || 'master'));
    } catch (error) { res.status(409).json(safeError(error)); }
  });

  app.post('/api/v8/connections/:connectionId/close', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || activeProject()?.id || '');
      res.json(await closeProfile(projectId, req.params.connectionId));
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.post('/api/v8/connections/:connectionId/test', async (req, res) => {
    try {
      const projectId = String(req.body?.projectId || activeProject()?.id || '');
      res.json(await testProfile(projectId, req.params.connectionId));
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.get('/api/v8/system/serial-ports', async (_req, res) => {
    try { res.json(await listSerialPorts()); } catch (error) { res.status(500).json(safeError(error)); }
  });
  app.get('/api/v8/system/network-interfaces', (_req, res) => {
    try { res.json(listLocalAddresses()); } catch (error) { res.status(500).json(safeError(error)); }
  });

  app.get('/api/v8/ui', (_req, res) => res.json(activeProject()?.ui || { theme: 'system', density: 'comfortable', layout: {} }));
  app.put('/api/v8/ui', (req, res) => {
    try {
      const project = activeProject();
      const updated = projects.updateProject(project.id, { ui: req.body || {} });
      broadcast('project', updated);
      res.json(updated.ui);
    } catch (error) { res.status(400).json(safeError(error)); }
  });

  app.get(/^\/v8$/, (_req, res) => res.redirect('/v8/'));
  app.use('/v8', express.static(publicDir, { etag: true, maxAge: 0 }));
  app.get('/v8/*path', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', payload: { status: { schemaVersion: V8_PROJECT_SCHEMA_VERSION, stableRelease: '7.0.0', preview: true }, project: activeProject(), connections: inventory() } }));
    ws.on('error', () => {});
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const visibleHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const url = `http://${visibleHost}:${actualPort}/v8/`;
  if (!quiet) console.log(`[V8 PREVIEW] ${url}`);

  return {
    app,
    server,
    broker: connections,
    store: projects,
    url,
    port: actualPort,
    host,
    inventory,
    openProfile,
    closeProfile,
    testProfile,
    close: async () => {
      for (const key of [...runtimes.keys()]) {
        const [projectId, connectionId] = key.split('::');
        await cleanupRuntime(projectId, connectionId);
      }
      for (const ws of wss.clients) ws.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  SAFE_OWNER_MODES,
  V8WorkbenchServerError,
  mutationSameOriginGuard,
  startV8WorkbenchServer,
};
