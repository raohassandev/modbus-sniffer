'use strict';

const { SlaveRuntime, SlaveRuntimeError, normalizeConfig } = require('./slaveRuntime');

function statusFor(error) {
  if (['DEVICE_NOT_FOUND'].includes(error?.code)) return 404;
  if ([
    'SLAVE_RUNNING',
    'PASSIVE_CAPTURE_ACTIVE',
    'MASTER_ACTIVE',
    'RAW_LAB_ACTIVE',
    'DISCOVERY_ACTIVE',
    'RESOURCE_BUSY',
    'CONNECTION_OWNED',
    'UNIT_ID_CONFLICT',
  ].includes(error?.code)) return 409;
  return 400;
}

function sendError(res, error) {
  res.status(statusFor(error)).json({
    error: String(error?.message || error),
    code: error?.code || null,
    details: error?.details || undefined,
  });
}

function sameSerialPort(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function installSlaveRoutes({
  app,
  state,
  demo = false,
  disconnectSerial = null,
  masterRuntime = null,
  activeDiscovery = null,
  getRawLabStatus = null,
  disconnectRawLab = null,
  broadcast = () => {},
  runtime = new SlaveRuntime(),
} = {}) {
  if (!app) throw new TypeError('app is required');

  const passiveState = () => {
    try { return state?.getStatus?.() || {}; } catch { return {}; }
  };

  async function ensureSerialOwnership(config, body = {}) {
    if (!['rtu','ascii'].includes(config.type)) return;

    if (demo) {
      const error = new SlaveRuntimeError('DEMO_SERIAL_DISABLED', 'Serial Slave mode is disabled while Analyzer demo mode is active.');
      throw error;
    }

    const status = passiveState();
    const passiveConnection = status.connection || state?.connection || {};
    const passiveConfig = status.config || state?.config || {};
    const passiveOpen = ['open', 'connecting', 'reconnecting', 'detecting'].includes(String(passiveConnection.status || '').toLowerCase());
    const passiveSamePort = sameSerialPort(passiveConfig.port, config.path);
    if (passiveOpen && passiveSamePort) {
      if (body.confirmPassiveDisconnect !== true) {
        throw new SlaveRuntimeError(
          'PASSIVE_CAPTURE_ACTIVE',
          `The passive Analyzer currently owns ${config.path}. Confirm switching this port to active Slave mode.`,
          { port: config.path, requiresConfirmation: true }
        );
      }
      if (typeof disconnectSerial === 'function') await disconnectSerial();
    }

    const master = masterRuntime?.status?.() || {};
    const masterSerial = master.connected && ['rtu', 'ascii'].includes(String(master.config?.type || '').toLowerCase());
    if (masterSerial && sameSerialPort(master.config?.path, config.path)) {
      if (body.confirmMasterDisconnect !== true) {
        throw new SlaveRuntimeError(
          'MASTER_ACTIVE',
          `Modbus Master currently owns ${config.path}. Confirm disconnecting Master before starting Slave mode.`,
          { port: config.path, requiresConfirmation: true }
        );
      }
      await masterRuntime.disconnect();
    }

    const rawLab = typeof getRawLabStatus === 'function' ? getRawLabStatus() : null;
    const rawSerial = rawLab?.studio?.connectionState === 'open' && ['rtu', 'ascii'].includes(String(rawLab.config?.type || '').toLowerCase());
    if (rawSerial && sameSerialPort(rawLab.config?.path, config.path)) {
      if (body.confirmRawLabClose !== true) {
        throw new SlaveRuntimeError(
          'RAW_LAB_ACTIVE',
          `Raw Frame Lab currently owns ${config.path}. Confirm closing Raw Lab before starting Slave mode.`,
          { port: config.path, requiresConfirmation: true }
        );
      }
      if (typeof disconnectRawLab === 'function') await disconnectRawLab();
    }

    const discovery = activeDiscovery?.status?.() || {};
    const discoveryActive = ['running', 'starting', 'cancelling'].includes(String(discovery.state || '').toLowerCase());
    const discoveryTransport = String(discovery.transport || discovery.config?.transport || '').toUpperCase();
    if (discoveryActive && discoveryTransport === 'RTU') {
      throw new SlaveRuntimeError(
        'DISCOVERY_ACTIVE',
        'Stop active RTU Discovery before starting a serial Slave server.',
        { discoveryJobId: discovery.jobId || null }
      );
    }
  }

  app.get('/api/slave/status', (_req, res) => res.json(runtime.status()));

  app.post('/api/slave/configure', async (req, res) => {
    try {
      const config = normalizeConfig(req.body || {});
      const status = await runtime.configure(config);
      broadcast('slave-status', status);
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/slave/start', async (req, res) => {
    try {
      const body = req.body || {};
      const config = normalizeConfig(body.config || body);
      await ensureSerialOwnership(config, body);
      const status = await runtime.start(config);
      broadcast('slave-status', status);
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/slave/stop', async (_req, res) => {
    try {
      const status = await runtime.stop();
      broadcast('slave-status', status);
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/slave/devices', (_req, res) => {
    try { res.json(runtime.listDevices()); } catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/devices', (req, res) => {
    try {
      const device = runtime.addDevice(req.body || {});
      broadcast('slave-device', { action: 'saved', device });
      res.status(201).json(device);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/slave/devices/:unitId', (req, res) => {
    try {
      runtime.removeDevice(Number(req.params.unitId));
      broadcast('slave-device', { action: 'removed', unitId: Number(req.params.unitId) });
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/slave/memory', (req, res) => {
    try {
      res.json(runtime.readMemory({
        unitId: Number(req.query.unitId),
        area: String(req.query.area || 'holdingRegisters'),
        address: Number(req.query.address || 0),
        quantity: Number(req.query.quantity || 16),
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/slave/memory', (req, res) => {
    try {
      const memory = runtime.seedMemory(req.body || {});
      broadcast('slave-memory', {
        unitId: memory.unitId,
        area: memory.area,
        address: memory.address,
        quantity: memory.quantity,
      });
      res.json(memory);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/slave/file-records/read', (req, res) => {
    try { res.json(runtime.readFileRecords(req.body || {})); }
    catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/file-records', (req, res) => {
    try {
      const result = runtime.seedFileRecords(req.body || {});
      broadcast('slave-file-records', { unitId: result.unitId, records: result.records.length });
      res.json(result);
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/fifo', (req, res) => {
    try { res.json(runtime.readFifo({ unitId: Number(req.query.unitId), address: Number(req.query.address || 0) })); }
    catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/fifo', (req, res) => {
    try {
      const result = runtime.seedFifo(req.body || {});
      broadcast('slave-fifo', { unitId: result.unitId, address: result.address, quantity: result.values.length });
      res.json(result);
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/lab/status', (_req, res) => {
    try { res.json(runtime.status().lab || { enabled:false }); } catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/lab/arm', (req, res) => {
    try {
      const body=req.body||{};
      const status=runtime.armLab(body.policy||{}, { confirmed: body.confirmed === true });
      broadcast('slave-lab', status);
      res.json(status);
    } catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/lab/disarm', (_req, res) => {
    try {
      const status=runtime.disarmLab();
      broadcast('slave-lab', status);
      res.json(status);
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/generators', (_req, res) => {
    try { res.json(runtime.listGenerators()); } catch (error) { sendError(res, error); }
  });

  app.post('/api/slave/generators', (req, res) => {
    try {
      const item=runtime.saveGenerator(req.body||{});
      broadcast('slave-generator', item);
      res.json(item);
    } catch (error) { sendError(res, error); }
  });

  app.delete('/api/slave/generators/:id', (req, res) => {
    try {
      const ok=runtime.removeGenerator(req.params.id);
      broadcast('slave-generator', { generatorId:req.params.id, removed:ok });
      res.json({ok});
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/clients', (_req, res) => {
    try { res.json(runtime.listClients()); } catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/events', (req, res) => {
    try { res.json(runtime.getEvents({ limit: Number(req.query.limit || 200), type: req.query.type || null })); }
    catch (error) { sendError(res, error); }
  });

  app.get('/api/slave/export.json', (_req, res) => {
    try {
      res.setHeader('Content-Disposition', 'attachment; filename="modbus-slave-map.json"');
      res.json(runtime.exportConfig());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/slave/import', async (req, res) => {
    try {
      const status = await runtime.importConfig(req.body || {});
      broadcast('slave-status', status);
      res.json(status);
    } catch (error) {
      sendError(res, error);
    }
  });

  return runtime;
}

module.exports = {
  installSlaveRoutes,
  sameSerialPort,
  sendError,
  statusFor,
};
