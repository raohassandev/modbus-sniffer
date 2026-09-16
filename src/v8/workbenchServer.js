'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { ConnectionCenterService } = require('./connectionCenterService');
const { loadFeatureFlags, assertFeature } = require('./featureFlags');

function httpErrorStatus(error) {
  const code = error?.code || '';
  if (['PROFILE_NOT_FOUND', 'PROJECT_NOT_FOUND', 'CONNECTION_NOT_FOUND'].includes(code)) return 404;
  if (['OWNERSHIP_CONFLICT', 'CONNECTION_ACTIVE', 'RESOURCE_BUSY', 'CONNECTION_OWNED', 'OWNER_MISMATCH'].includes(code)) return 409;
  if (['FEATURE_DISABLED'].includes(code)) return 403;
  if (['INVALID_ARGUMENT', 'INVALID_OWNER_MODE', 'INVALID_IMPORT', 'UNSUPPORTED_TRANSPORT', 'SERIAL_PATH_REQUIRED', 'TCP_HOST_REQUIRED'].includes(code)) return 400;
  return 500;
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'INTERNAL_ERROR',
      message: String(error?.message || error),
      details: error?.details && typeof error.details === 'object' ? error.details : null,
    },
  };
}

function safeJson(value) {
  return JSON.stringify(value, (_key, current) => Buffer.isBuffer(current) ? current.toString('hex').toUpperCase() : current);
}

function startV8WorkbenchServer({
  store,
  broker,
  host = '127.0.0.1',
  port = 0,
  flags = loadFeatureFlags(),
  publicDir = path.resolve(__dirname, '..', '..', 'public', 'v8'),
  connectionCenter = null,
} = {}) {
  if (!store) throw new TypeError('store is required');
  if (!broker) throw new TypeError('broker is required');
  assertFeature(flags, 'shell');
  const center = connectionCenter || new ConnectionCenterService({ store, broker });
  center.sync();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const route = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(httpErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/status', route(async (_req, res) => {
    const db = store.exportAll();
    res.json({
      ok: true,
      version: '8-dev',
      schemaVersion: db.schemaVersion,
      activeProjectId: db.activeProjectId,
      activeProject: store.getActiveProject(),
      flags,
      connections: center.inventory(),
      migration: store.getMigrationReport(),
      recovery: store.getRecoveryReport(),
    });
  }));

  app.get('/api/v8/projects', route(async (_req, res) => {
    res.json({ ok: true, activeProjectId: center.activeProjectId(), projects: store.listProjects() });
  }));

  app.post('/api/v8/projects/:projectId/active', route(async (req, res) => {
    for (const item of broker.listConnections()) {
      if (item.owner || ['open', 'opening', 'closing'].includes(item.state)) {
        const error = new Error('Close active connections before switching project');
        error.code = 'CONNECTION_ACTIVE';
        error.details = { connectionId: item.connectionId };
        throw error;
      }
    }
    store.setActiveProject(req.params.projectId);
    center.sync(req.params.projectId);
    broadcast({ type: 'project.active', projectId: req.params.projectId });
    res.json({ ok: true, project: store.getActiveProject(), connections: center.inventory(req.params.projectId) });
  }));

  app.patch('/api/v8/projects/:projectId/ui', route(async (req, res) => {
    const project = store.getProject(req.params.projectId);
    if (!project) {
      const error = new Error(`Project ${req.params.projectId} was not found`);
      error.code = 'PROJECT_NOT_FOUND';
      throw error;
    }
    const ui = {
      ...(project.ui || {}),
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
    };
    const updated = store.updateProject(req.params.projectId, { ui });
    broadcast({ type: 'project.ui', projectId: req.params.projectId, ui: updated.ui });
    res.json({ ok: true, ui: updated.ui });
  }));

  app.get('/api/v8/connections', route(async (_req, res) => {
    assertFeature(flags, 'connectionCenter');
    res.json({ ok: true, projectId: center.activeProjectId(), connections: center.inventory() });
  }));

  app.post('/api/v8/connections', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const saved = center.saveProfile(req.body || {});
    broadcast({ type: 'connection.profile-saved', connectionId: saved.profile.connectionId });
    res.status(201).json({ ok: true, connection: saved });
  }));

  app.get('/api/v8/connections/export', route(async (_req, res) => {
    assertFeature(flags, 'connectionCenter');
    res.json({ ok: true, ...center.exportProfiles() });
  }));

  app.post('/api/v8/connections/import', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const imported = center.importProfiles(req.body || {});
    broadcast({ type: 'connection.profiles-imported', count: imported.length });
    res.json({ ok: true, imported });
  }));

  app.get('/api/v8/connections/:connectionId', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    res.json({ ok: true, connection: center.get(req.params.connectionId) });
  }));

  app.delete('/api/v8/connections/:connectionId', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const removed = center.removeProfile(req.params.connectionId);
    broadcast({ type: 'connection.profile-removed', connectionId: req.params.connectionId });
    res.json({ ok: true, removed });
  }));

  app.post('/api/v8/connections/:connectionId/duplicate', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const connection = center.duplicateProfile(req.params.connectionId, req.body || {});
    broadcast({ type: 'connection.profile-duplicated', connectionId: connection.profile.connectionId });
    res.status(201).json({ ok: true, connection });
  }));

  app.post('/api/v8/connections/:connectionId/open', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const ownerMode = String(req.body?.ownerMode || 'master');
    const connection = await center.activate(req.params.connectionId, { ownerMode });
    broadcast({ type: 'connection.opened', connectionId: req.params.connectionId, ownerMode });
    res.json({ ok: true, connection });
  }));

  app.post('/api/v8/connections/:connectionId/close', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const connection = await center.deactivate(req.params.connectionId);
    broadcast({ type: 'connection.closed', connectionId: req.params.connectionId });
    res.json({ ok: true, connection });
  }));

  app.post('/api/v8/connections/:connectionId/test', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const result = await center.testConnection(req.params.connectionId);
    broadcast({ type: 'connection.tested', connectionId: req.params.connectionId, ok: true, elapsedMs: result.elapsedMs });
    res.json({ ok: true, result });
  }));

  app.get('/api/v8/system/serial-ports', route(async (_req, res) => {
    assertFeature(flags, 'connectionCenter');
    res.json({ ok: true, ports: await center.listSerialPorts() });
  }));

  app.get('/api/v8/system/network-interfaces', route(async (_req, res) => {
    assertFeature(flags, 'connectionCenter');
    res.json({ ok: true, interfaces: center.listNetworkInterfaces() });
  }));

  app.get('/api/v8/system/recommend-interface', route(async (req, res) => {
    assertFeature(flags, 'connectionCenter');
    const target = String(req.query.target || '').trim();
    res.json({ ok: true, target, recommendation: center.recommendLocalInterface(target) });
  }));

  app.use('/v8', express.static(publicDir, { index: 'index.html', fallthrough: true }));
  app.get('/', (_req, res) => res.redirect('/v8/'));
  app.get('/v8/*splat', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  function broadcast(event) {
    const payload = safeJson({ at: Date.now(), ...event });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/ws/v8') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (ws) => {
    ws.send(safeJson({
      at: Date.now(),
      type: 'hello',
      activeProjectId: center.activeProjectId(),
      flags,
    }));
  });

  const onBrokerEvent = (event) => broadcast({ type: 'runtime.event', event });
  broker.on('event', onBrokerEvent);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port }, () => {
      server.off('error', reject);
      const address = server.address();
      const boundHost = typeof address === 'object' && address ? address.address : host;
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve(Object.freeze({
        app,
        server,
        wss,
        center,
        host: boundHost,
        port: boundPort,
        url: `http://${boundHost.includes(':') ? `[${boundHost}]` : boundHost}:${boundPort}/v8/`,
        async close() {
          broker.off('event', onBrokerEvent);
          for (const connection of broker.listConnections()) {
            if (connection.owner) {
              try { await center.deactivate(connection.connectionId); } catch { /* best effort shutdown */ }
            }
          }
          for (const client of wss.clients) client.close();
          await new Promise((done) => wss.close(() => done()));
          await new Promise((done) => server.close(() => done()));
        },
      }));
    });
  });
}

module.exports = {
  startV8WorkbenchServer,
  errorPayload,
  httpErrorStatus,
};
