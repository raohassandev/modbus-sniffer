'use strict';

const { MasterRuntime, normalizeConnectionConfig } = require('./masterRuntime');

function errorStatus(error) {
  if (['MASTER_NOT_CONNECTED'].includes(error?.code)) return 409;
  if (['PASSIVE_CAPTURE_ACTIVE', 'SLAVE_ACTIVE'].includes(error?.code)) return 409;
  if (['TIMEOUT'].includes(error?.code)) return 504;
  if (['MODBUS_EXCEPTION'].includes(error?.code)) return 502;
  if (String(error?.code || '').startsWith('INVALID_')) return 400;
  return 400;
}

function sendError(res, error) {
  return res.status(errorStatus(error)).json({
    error: String(error?.message || error),
    code: error?.code || 'MASTER_ERROR',
    details: error?.details || undefined,
  });
}

function installMasterRoutes({
  app,
  state,
  disconnectSerial,
  demo = false,
  runtime = new MasterRuntime(),
  getSlaveStatus = null,
  disconnectSlave = null,
} = {}) {
  if (!app) throw new TypeError('app is required');

  const passiveStatus = () => {
    try { return state?.getStatus?.() || {}; } catch { return {}; }
  };

  app.get('/api/master/status', (_req, res) => {
    res.json(runtime.status());
  });

  app.post('/api/master/connect', async (req, res) => {
    try {
      const config = normalizeConnectionConfig(req.body || {});
      if (demo && config.type !== 'tcp') {
        const error = new Error('Serial Master connections are disabled while Analyzer demo mode is active.');
        error.code = 'DEMO_SERIAL_DISABLED';
        throw error;
      }

      if (config.type !== 'tcp') {
        const status = passiveStatus();
        const passiveConnection = status.connection || {};
        const passiveConfig = status.config || state?.config || {};
        const samePort = String(passiveConfig.port || '').toLowerCase() === String(config.path || '').toLowerCase();
        const passiveOpen = ['open', 'connecting', 'reconnecting', 'detecting'].includes(String(passiveConnection.status || '').toLowerCase());
        if (passiveOpen && samePort) {
          if (req.body?.confirmPassiveDisconnect !== true) {
            const error = new Error(`The passive Analyzer currently owns ${config.path}. Confirm switching this serial port to active Master mode.`);
            error.code = 'PASSIVE_CAPTURE_ACTIVE';
            error.details = { port: config.path, requiresConfirmation: true };
            throw error;
          }
          if (typeof disconnectSerial === 'function') await disconnectSerial();
        }

        const slave = typeof getSlaveStatus === 'function' ? getSlaveStatus() : null;
        const slaveSerial = slave?.running && ['rtu', 'ascii'].includes(String(slave.config?.type || '').toLowerCase());
        const slaveSamePort = slaveSerial && String(slave.config?.path || '').toLowerCase() === String(config.path || '').toLowerCase();
        if (slaveSamePort) {
          if (req.body?.confirmSlaveStop !== true) {
            const error = new Error(`Modbus Slave currently owns ${config.path}. Confirm stopping Slave before starting Master mode.`);
            error.code = 'SLAVE_ACTIVE';
            error.details = { port: config.path, requiresConfirmation: true };
            throw error;
          }
          if (typeof disconnectSlave === 'function') await disconnectSlave();
        }
      }

      const result = await runtime.connect(config);
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/master/disconnect', async (_req, res) => {
    try {
      const result = await runtime.disconnect();
      res.json({ ok: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/master/read', async (req, res) => {
    try {
      res.json(await runtime.read(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/master/advanced', async (req, res) => {
    try {
      res.json(await runtime.advanced(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/master/write', async (req, res) => {
    try {
      res.json(await runtime.write(req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/master/write-audit', (req, res) => {
    try {
      res.json(runtime.writeAuditEntries({ limit: Number(req.query.limit || 200) }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/master/stats/reset', (_req, res) => {
    try {
      res.json({ ok: true, ...runtime.resetStats() });
    } catch (error) {
      sendError(res, error);
    }
  });

  return runtime;
}

module.exports = { installMasterRoutes, sendError, errorStatus };
