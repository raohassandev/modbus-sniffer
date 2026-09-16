'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST = new Set([
  'INVALID_SIMULATOR_CONFIG',
  'INVALID_MEMORY_AREA',
  'INVALID_MEMORY_VALUES',
  'INVALID_GENERATOR',
  'INVALID_FORMULA',
  'INVALID_FAULT_POLICY',
  'LAB_CONFIRMATION_REQUIRED',
  'SIMULATOR_TRANSPORT_MISMATCH',
]);
const NOT_FOUND = new Set(['SERVER_NOT_FOUND', 'DEVICE_NOT_FOUND', 'GENERATOR_NOT_FOUND', 'PROFILE_NOT_FOUND', 'PROJECT_NOT_FOUND']);
const CONFLICT = new Set(['SERVER_RUNNING', 'SERVER_NOT_RUNNING', 'CONNECTION_ACTIVE', 'CONNECTION_ALREADY_ASSIGNED', 'UNIT_ID_CONFLICT', 'OWNERSHIP_CONFLICT', 'RESOURCE_BUSY', 'CONNECTION_OWNED']);

function simulatorStatus(error) {
  if (BAD_REQUEST.has(error?.code)) return 400;
  if (NOT_FOUND.has(error?.code)) return 404;
  if (CONFLICT.has(error?.code)) return 409;
  return httpErrorStatus(error);
}

function mountSimulatorRoutes({ app, simulator, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!simulator) throw new TypeError('simulator is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');
  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'simulatorWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(simulatorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/simulator/servers', route(async (_req, res) => res.json({ ok: true, servers: simulator.listServers() })));
  app.post('/api/v8/simulator/servers', route(async (req, res) => {
    const server = simulator.saveServer(req.body || {});
    broadcast({ type: 'simulator.server-saved', serverId: server.serverId });
    res.status(201).json({ ok: true, server });
  }));
  app.delete('/api/v8/simulator/servers/:serverId', route(async (req, res) => {
    const removed = simulator.removeServer(req.params.serverId);
    broadcast({ type: 'simulator.server-removed', serverId: req.params.serverId });
    res.json({ ok: true, removed });
  }));
  app.post('/api/v8/simulator/servers/:serverId/start', route(async (req, res) => {
    const server = await simulator.startServer(req.params.serverId);
    broadcast({ type: 'simulator.server-started', serverId: req.params.serverId });
    res.json({ ok: true, server });
  }));
  app.post('/api/v8/simulator/servers/:serverId/stop', route(async (req, res) => {
    const server = await simulator.stopServer(req.params.serverId);
    broadcast({ type: 'simulator.server-stopped', serverId: req.params.serverId });
    res.json({ ok: true, server });
  }));

  app.get('/api/v8/simulator/devices', route(async (req, res) => res.json({ ok: true, devices: simulator.listDevices(req.query.serverId || null) })));
  app.post('/api/v8/simulator/devices', route(async (req, res) => {
    const device = simulator.saveDevice(req.body || {});
    broadcast({ type: 'simulator.device-saved', deviceId: device.deviceId, serverId: device.serverId });
    res.status(201).json({ ok: true, device });
  }));
  app.delete('/api/v8/simulator/devices/:deviceId', route(async (req, res) => {
    const removed = simulator.removeDevice(req.params.deviceId);
    broadcast({ type: 'simulator.device-removed', deviceId: req.params.deviceId });
    res.json({ ok: true, removed });
  }));

  app.get('/api/v8/simulator/devices/:deviceId/memory', route(async (req, res) => {
    const result = simulator.readMemory(req.params.deviceId, {
      area: String(req.query.area || 'holdingRegisters'),
      address: Number(req.query.address || 0),
      quantity: Number(req.query.quantity || 16),
    });
    res.json({ ok: true, memory: result });
  }));
  app.post('/api/v8/simulator/devices/:deviceId/memory', route(async (req, res) => {
    const result = simulator.seedMemory(req.params.deviceId, req.body || {});
    broadcast({ type: 'simulator.memory-updated', deviceId: req.params.deviceId, area: result.area, address: result.address, quantity: result.quantity });
    res.json({ ok: true, memory: result });
  }));

  app.post('/api/v8/simulator/devices/:deviceId/generators', route(async (req, res) => {
    const generator = simulator.saveGenerator(req.params.deviceId, req.body || {});
    broadcast({ type: 'simulator.generator-saved', deviceId: req.params.deviceId, generatorId: generator.generatorId });
    res.status(201).json({ ok: true, generator });
  }));
  app.delete('/api/v8/simulator/devices/:deviceId/generators/:generatorId', route(async (req, res) => {
    const removed = simulator.removeGenerator(req.params.deviceId, req.params.generatorId);
    broadcast({ type: 'simulator.generator-removed', deviceId: req.params.deviceId, generatorId: req.params.generatorId });
    res.json({ ok: true, removed });
  }));

  app.post('/api/v8/simulator/servers/:serverId/fault-lab/arm', route(async (req, res) => {
    const faultLab = simulator.armFaultLab(req.params.serverId, req.body?.policy || {}, { confirmed: req.body?.confirmed === true });
    broadcast({ type: 'simulator.fault-lab-armed', serverId: req.params.serverId });
    res.json({ ok: true, faultLab });
  }));
  app.post('/api/v8/simulator/servers/:serverId/fault-lab/disarm', route(async (req, res) => {
    const faultLab = simulator.disarmFaultLab(req.params.serverId);
    broadcast({ type: 'simulator.fault-lab-disarmed', serverId: req.params.serverId });
    res.json({ ok: true, faultLab });
  }));
  app.get('/api/v8/simulator/servers/:serverId/write-audit', route(async (req, res) => {
    res.json({ ok: true, audit: simulator.getWriteAudit(req.params.serverId, { limit: Number(req.query.limit || 100) }) });
  }));
  app.get('/api/v8/simulator/servers/:serverId/clients', route(async (req, res) => {
    res.json({ ok: true, clients: simulator.listClientSessions(req.params.serverId) });
  }));
}

module.exports = { mountSimulatorRoutes, simulatorStatus };
