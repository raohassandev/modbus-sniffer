'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { V8ProjectStore, V8_PROJECT_SCHEMA_VERSION } = require('../project');
const { ConnectionBroker } = require('../connectionBrokerSafety');
const { listSerialPorts } = require('../transports/serialTransportSafety');
const { listLocalAddresses } = require('../transports/networkAddresses');
const { V8ConnectionManager } = require('./connectionManager');
const { getV8FeatureFlags } = require('./featureFlags');

function isLoopbackHost(host) {
  const value = String(host || '').trim().toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

function sameOriginRequest(req) {
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers.host || ''); } catch { return false; }
}

function apiStatus(error) {
  if (['CONNECTION_BUSY', 'CONNECTION_OWNED', 'RESOURCE_BUSY', 'CONNECTION_OPEN'].includes(error?.code)) return 409;
  if (['CROSS_ORIGIN_MUTATION_BLOCKED', 'V8_DEV_LOCAL_ONLY'].includes(error?.code)) return 403;
  if (['CONNECTION_PROFILE_NOT_FOUND', 'PROJECT_NOT_FOUND'].includes(error?.code)) return 404;
  return 400;
}

function apiError(res, error) {
  res.status(apiStatus(error)).json({
    error: String(error?.message || error),
    code: error?.code || null,
    details: error?.details || undefined,
  });
}

function createV8ShellServer({
  dataDir = path.join(process.cwd(), 'data'),
  store = null,
  broker = null,
  featureFlags = null,
  publicDir = path.join(__dirname, '..', '..', '..', 'public', 'v8'),
} = {}) {
  const projects = store || new V8ProjectStore({ dataDir });
  const connectionBroker = broker || new ConnectionBroker();
  const connections = new V8ConnectionManager({ store: projects, broker: connectionBroker });
  const flags = getV8FeatureFlags(featureFlags);
  const app = express();
  const server = http.createServer(app);
  let listening = false;
  let listeningHost = null;

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!sameOriginRequest(req)) {
      return res.status(403).json({ error: 'Cross-origin state-changing request blocked.', code: 'CROSS_ORIGIN_MUTATION_BLOCKED' });
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v8/status', (_req, res) => {
    const activeProject = projects.getActiveProject();
    res.json({
      stableProductVersion: '7.0.0',
      workbenchVersion: '8-dev',
      schemaVersion: V8_PROJECT_SCHEMA_VERSION,
      activeProject: activeProject ? { id: activeProject.id, name: activeProject.name } : null,
      features: flags,
      connections: connections.list().map((entry) => ({
        connectionId: entry.profile.connectionId,
        name: entry.profile.name,
        transportKind: entry.profile.transportKind,
        state: entry.runtime.state,
        ownerMode: entry.runtime.owner?.ownerMode || 'none',
        transmitCapability: entry.runtime.transmitCapability,
        writeLock: entry.runtime.writeLock,
      })),
    });
  });

  app.get('/api/v8/projects', (_req, res) => {
    res.json({ activeProjectId: projects.exportAll().activeProjectId, projects: projects.listProjects() });
  });

  app.post('/api/v8/projects/:id/select', async (req, res) => {
    try {
      await connections.closeAll();
      res.json(projects.setActiveProject(req.params.id));
    } catch (error) { apiError(res, error); }
  });

  app.get('/api/v8/connections', (_req, res) => res.json(connections.list()));

  app.post('/api/v8/connections', (req, res) => {
    try {
      const project = projects.getActiveProject();
      if (!project) throw Object.assign(new Error('No active project'), { code: 'PROJECT_NOT_FOUND' });
      const profile = projects.upsertConnectionProfile(project.id, req.body || {});
      res.status(201).json(profile);
    } catch (error) { apiError(res, error); }
  });

  app.delete('/api/v8/connections/:id', async (req, res) => {
    try {
      const decoded = decodeURIComponent(req.params.id);
      const entry = connections.get(decoded);
      if (entry.runtime.owner || ['open', 'opening', 'closing'].includes(entry.runtime.state)) {
        throw Object.assign(new Error('Close the connection before removing its profile'), { code: 'CONNECTION_BUSY' });
      }
      const project = projects.getActiveProject();
      res.json({ ok: projects.removeConnectionProfile(project.id, decoded) });
    } catch (error) { apiError(res, error); }
  });

  app.post('/api/v8/connections/:id/open', async (req, res) => {
    try {
      const status = await connections.open(decodeURIComponent(req.params.id), { ownerMode: String(req.body?.ownerMode || '') });
      res.json(status);
    } catch (error) { apiError(res, error); }
  });

  app.post('/api/v8/connections/:id/close', async (req, res) => {
    try { res.json(await connections.close(decodeURIComponent(req.params.id))); }
    catch (error) { apiError(res, error); }
  });

  app.get('/api/v8/ports', async (_req, res) => {
    try { res.json(await listSerialPorts()); }
    catch (error) { apiError(res, error); }
  });

  app.get('/api/v8/interfaces', (_req, res) => {
    try { res.json(listLocalAddresses()); }
    catch (error) { apiError(res, error); }
  });

  app.use('/v8', express.static(publicDir, { index: 'index.html', etag: true, maxAge: 0 }));
  app.get('/', (_req, res) => res.redirect('/v8/'));
  app.use((req, res) => res.status(404).json({ error: `Not found: ${req.path}`, code: 'NOT_FOUND' }));

  async function start({ host = '127.0.0.1', port = 8188 } = {}) {
    if (!isLoopbackHost(host)) {
      const error = new Error('The v8 development shell is local-only until production authentication/bind policy is implemented.');
      error.code = 'V8_DEV_LOCAL_ONLY';
      throw error;
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be 0..65535');
    if (listening) return address();
    listeningHost = host;
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ host, port });
    });
    listening = true;
    return address();
  }

  function address() {
    const value = server.address();
    if (!value || typeof value === 'string') return null;
    const host = listeningHost === 'localhost' ? '127.0.0.1' : listeningHost;
    const displayHost = host === '::1' ? '[::1]' : host;
    return Object.freeze({ host, port: value.port, url: `http://${displayHost}:${value.port}` });
  }

  async function stop() {
    await connections.closeAll();
    if (!listening) return;
    await new Promise((resolve) => server.close(() => resolve()));
    listening = false;
    listeningHost = null;
  }

  return Object.freeze({
    app,
    server,
    projects,
    broker: connectionBroker,
    connections,
    featureFlags: flags,
    start,
    stop,
    address,
  });
}

module.exports = {
  apiStatus,
  createV8ShellServer,
  isLoopbackHost,
  sameOriginRequest,
};
