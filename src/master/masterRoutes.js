'use strict';

const { MasterRuntime, normalizeConnectionConfig } = require('./masterRuntime');
const { MasterMonitorSessionStore } = require('./masterMonitorSessionStore');

function errorStatus(error) {
  const code = String(error?.code || '');
  if (code === 'MASTER_NOT_CONNECTED') return 409;
  if (['PASSIVE_CAPTURE_ACTIVE', 'SLAVE_ACTIVE', 'RAW_LAB_ACTIVE'].includes(code)) return 409;
  if (code === 'TIMEOUT') return 408;
  if (code === 'MODBUS_EXCEPTION') return 422;
  if (['CONNECTION_LOST','CONNECTION_NOT_OPEN','NOT_OPEN','CLOSED','RECONNECTING','CONNECT_FAILED','CONNECT_TIMEOUT','WRITE_FAILED'].includes(code)) return 503;
  if (['INVALID_RESPONSE','UNIT_MISMATCH','TID_MISMATCH','FUNCTION_MISMATCH'].includes(code)) return 422;
  if (['STORE_READ_FAILED','STORE_WRITE_FAILED','STORE_INVALID'].includes(code)) return 500;
  if (code.startsWith('INVALID_')) return 400;
  return 400;
}

function errorGuidance(error) {
  const code = String(error?.code || 'MASTER_ERROR');
  const details = error?.details || {};
  if (code === 'TIMEOUT') return {
    category:'timeout',
    retryable:true,
    hint:'No matching Modbus response arrived before the timeout. Verify Unit ID, function code, register address, device TCP port and network path; then increase timeout only if the device is known to respond slowly.',
  };
  if (code === 'MODBUS_EXCEPTION') {
    const names = { 1:'Illegal Function', 2:'Illegal Data Address', 3:'Illegal Data Value', 4:'Server Device Failure', 5:'Acknowledge', 6:'Server Device Busy', 8:'Memory Parity Error', 10:'Gateway Path Unavailable', 11:'Gateway Target Device Failed to Respond' };
    const n = Number(details.exceptionCode);
    return {
      category:'modbus-exception',
      retryable:[5,6,10,11].includes(n),
      hint:`The device returned Modbus exception ${Number.isFinite(n)?n:'?'}${names[n] ? ` (${names[n]})` : ''}. Check the requested function/address/quantity against the device register map.`,
    };
  }
  if (['CONNECTION_LOST','CONNECTION_NOT_OPEN','NOT_OPEN','CLOSED','RECONNECTING','CONNECT_FAILED','CONNECT_TIMEOUT','WRITE_FAILED'].includes(code)) return {
    category:'transport',
    retryable:true,
    hint:'The TCP/serial transport is not currently usable. Reconnect the target and verify IP/port, cabling, firewall/VPN and device availability.',
  };
  if (['INVALID_RESPONSE','UNIT_MISMATCH','TID_MISMATCH','FUNCTION_MISMATCH'].includes(code)) return {
    category:'protocol',
    retryable:false,
    hint:'A response arrived but did not match the active Modbus request. Check for the correct target, gateway routing and duplicate/competing clients.',
  };
  if (code.startsWith('INVALID_')) return {
    category:'request',
    retryable:false,
    hint:'The read definition is invalid. Check Unit ID, function code, address, quantity and connection parameters.',
  };
  return { category:'master', retryable:false, hint:null };
}

function jsonSafeDetails(value) {
  if (Buffer.isBuffer(value)) return value.toString('hex').toUpperCase();
  if (Array.isArray(value)) return value.map(jsonSafeDetails);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (Buffer.isBuffer(item)) out[`${key}Hex`] = item.toString('hex').toUpperCase();
    else out[key] = jsonSafeDetails(item);
  }
  return out;
}

function sendError(res, error) {
  const guidance = errorGuidance(error);
  return res.status(errorStatus(error)).json({
    error: String(error?.message || error),
    code: error?.code || 'MASTER_ERROR',
    category: guidance.category,
    retryable: guidance.retryable,
    hint: guidance.hint,
    details: error?.details ? jsonSafeDetails(error.details) : undefined,
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
  getRawLabStatus = null,
  disconnectRawLab = null,
  dataDir = null,
  monitorStore = null,
} = {}) {
  if (!app) throw new TypeError('app is required');

  const savedMonitors = monitorStore || (dataDir ? new MasterMonitorSessionStore({ dataDir }) : null);

  const passiveStatus = () => {
    try { return state?.getStatus?.() || {}; } catch { return {}; }
  };

  app.get('/api/master/status', (_req, res) => {
    res.json(runtime.status());
  });

  if (savedMonitors) {
    app.get('/api/master/monitor-sessions', (_req, res) => {
      try {
        res.json(savedMonitors.load());
      } catch (error) {
        sendError(res, error);
      }
    });

    const saveMonitorSessions = (req, res) => {
      try {
        res.json(savedMonitors.save(req.body || {}));
      } catch (error) {
        sendError(res, error);
      }
    };
    app.put('/api/master/monitor-sessions', saveMonitorSessions);
  }

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

        const rawLab = typeof getRawLabStatus === 'function' ? getRawLabStatus() : null;
        const rawSerial = rawLab?.studio?.connectionState === 'open' && ['rtu', 'ascii'].includes(String(rawLab.config?.type || '').toLowerCase());
        const rawSamePort = rawSerial && String(rawLab.config?.path || '').toLowerCase() === String(config.path || '').toLowerCase();
        if (rawSamePort) {
          if (req.body?.confirmRawLabClose !== true) {
            const error = new Error(`Raw Frame Lab currently owns ${config.path}. Confirm closing Raw Lab before starting Master mode.`);
            error.code = 'RAW_LAB_ACTIVE';
            error.details = { port: config.path, requiresConfirmation: true };
            throw error;
          }
          if (typeof disconnectRawLab === 'function') await disconnectRawLab();
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

module.exports = { installMasterRoutes, sendError, errorStatus, errorGuidance, jsonSafeDetails };
