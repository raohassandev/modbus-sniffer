'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { PortManager } = require('./portManager');

function csvEscape(value) {
  if (value == null) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, rows, columns) {
  const lines = [columns.map(c => csvEscape(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map(c => csvEscape(c.value(row))).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(lines.join('\r\n'));
}

function validateSerialConfig(body) {
  const port = String(body.port || '').trim();
  const baudRate = Number(body.baudRate);
  const dataBits = Number(body.dataBits);
  const stopBits = Number(body.stopBits);
  const parity = String(body.parity || '').toLowerCase();
  const reconnectMs = Number(body.reconnectMs || 2000);
  const requestTimeoutMs = Number(body.requestTimeoutMs || 1000);
  if (!port) throw new Error('Serial port is required.');
  if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 4000000) throw new Error('Invalid baud rate.');
  if (![5, 6, 7, 8].includes(dataBits)) throw new Error('dataBits must be 5, 6, 7, or 8.');
  if (![1, 2].includes(stopBits)) throw new Error('stopBits must be 1 or 2.');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new Error('Invalid parity.');
  if (!Number.isFinite(reconnectMs) || reconnectMs < 250) throw new Error('Reconnect interval must be at least 250 ms.');
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 50 || requestTimeoutMs > 60000) throw new Error('Request timeout must be 50..60000 ms.');
  return { port, baudRate, dataBits, stopBits, parity, reconnectMs, requestTimeoutMs };
}

async function startAdvancedWebServer({ state, options, configureSerial, disconnectSerial, autoDetectSerial, replay, demo = false }) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const publicDir = path.join(__dirname, '..', 'public');

  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache, no-store, must-revalidate');
    next();
  });

  app.get('/api/status', (_req, res) => res.json(state.getStatus()));
  app.get('/api/analysis', (_req, res) => res.json(state.getAnalysis()));
  app.get('/api/transactions', (req, res) => res.json(state.getTransactions(req.query)));
  app.get('/api/registers', (req, res) => res.json(state.getRegisters(req.query)));
  app.get('/api/polls', (req, res) => res.json(state.getPollGroups(req.query)));
  app.get('/api/devices', (_req, res) => res.json(state.getDevices()));
  app.get('/api/devices/:slave', (req, res) => {
    const device = state.getDevice(req.params.slave);
    if (!device) return res.status(404).json({ error: `Slave ${req.params.slave} has not been observed.` });
    res.json(device);
  });
  app.get('/api/decode', (req, res) => res.json(state.getDataTypeAnalysis(req.query)));
  app.get('/api/config', (_req, res) => res.json({ ...state.config, demo }));
  app.get('/api/replay/status', (_req, res) => res.json(replay.status()));

  app.get('/api/ports', async (_req, res) => {
    try { res.json(await PortManager.list()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/serial/configure', async (req, res) => {
    if (demo) return res.status(409).json({ error: 'Serial configuration is disabled in demo mode.' });
    try {
      replay.stop();
      const next = validateSerialConfig(req.body || {});
      await configureSerial(next);
      res.json({ ok: true, config: state.config });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/serial/disconnect', async (_req, res) => {
    if (demo) return res.status(409).json({ error: 'No serial port is active in demo mode.' });
    try { await disconnectSerial(); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/serial/autodetect', async (req, res) => {
    if (demo) return res.status(409).json({ error: 'Serial auto-detection is disabled in demo mode.' });
    try {
      replay.stop();
      const result = await autoDetectSerial(req.body || {});
      res.json(result);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/capture/clear', (_req, res) => {
    replay.stop();
    state.clearCapture();
    res.json({ ok: true });
  });

  app.get('/api/capture/export.mbcap', (_req, res) => {
    const capture = state.exportCapture();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="modbus-${stamp}.mbcap"`);
    res.send(JSON.stringify(capture, null, 2));
  });

  app.post('/api/capture/import', async (req, res) => {
    try {
      if (!demo && state.connection.status === 'open') await disconnectSerial();
      const capture = req.body;
      replay.load(capture);
      const status = state.loadCapture(capture, { emit: false });
      state.setConnection('capture', { path: 'CAPTURE', message: `${capture.transactions.length} captured events loaded` });
      res.json({ ok: true, status, replay: replay.status() });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/replay/start', async (req, res) => {
    try {
      if (!demo && state.connection.status === 'open') await disconnectSerial();
      const status = replay.start({ speed: req.body?.speed });
      res.json({ ok: true, replay: status });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  app.post('/api/replay/stop', (_req, res) => {
    replay.stop();
    res.json({ ok: true, replay: replay.status() });
  });

  app.get('/api/export/transactions.csv', (_req, res) => {
    const rows = state.getTransactions({ limit: 20000 });
    sendCsv(res, 'modbus-transactions.csv', rows, [
      { label: 'id', value: r => r.id }, { label: 'timestamp', value: r => new Date(r.timestamp).toISOString() },
      { label: 'direction', value: r => r.direction }, { label: 'slave', value: r => r.slaveId },
      { label: 'function', value: r => r.functionCode }, { label: 'functionName', value: r => r.functionName },
      { label: 'rttMs', value: r => r.rttMs }, { label: 'timeoutMs', value: r => r.timeoutMs },
      { label: 'exception', value: r => r.exceptionName || '' }, { label: 'rawHex', value: r => r.rawHex },
      { label: 'decoded', value: r => r.decoded }
    ]);
  });

  app.get('/api/export/registers.csv', (_req, res) => {
    const rows = state.getRegisters({ limit: 20000 });
    sendCsv(res, 'modbus-registers.csv', rows, [
      { label: 'slave', value: r => r.slaveId }, { label: 'function', value: r => r.functionCode },
      { label: 'address', value: r => r.address }, { label: 'lastValue', value: r => r.lastValue },
      { label: 'lastHex', value: r => r.lastHex }, { label: 'min', value: r => r.min }, { label: 'max', value: r => r.max },
      { label: 'reads', value: r => r.reads }, { label: 'writes', value: r => r.writes }, { label: 'changes', value: r => r.changes },
      { label: 'pollIntervalMs', value: r => r.pollIntervalMs }, { label: 'lastSeen', value: r => new Date(r.lastSeen).toISOString() }
    ]);
  });

  app.get('/api/export/polls.csv', (_req, res) => {
    const rows = state.getPollGroups();
    sendCsv(res, 'modbus-polling-groups.csv', rows, [
      { label: 'slave', value: r => r.slaveId }, { label: 'function', value: r => r.functionCode }, { label: 'operation', value: r => r.operation },
      { label: 'startAddress', value: r => r.startAddress }, { label: 'quantity', value: r => r.quantity }, { label: 'requests', value: r => r.requests },
      { label: 'responses', value: r => r.responses }, { label: 'timeouts', value: r => r.timeouts }, { label: 'exceptions', value: r => r.exceptions },
      { label: 'medianIntervalMs', value: r => r.medianIntervalMs }, { label: 'p95IntervalMs', value: r => r.p95IntervalMs },
      { label: 'jitterPct', value: r => r.jitterPct }, { label: 'avgRttMs', value: r => r.avgRttMs }, { label: 'p95RttMs', value: r => r.p95RttMs }
    ]);
  });

  app.get('/api/export/devices.csv', (_req, res) => {
    const rows = state.getDevices();
    sendCsv(res, 'modbus-devices.csv', rows, [
      { label: 'slave', value: r => r.slaveId }, { label: 'status', value: r => r.status }, { label: 'healthScore', value: r => r.healthScore },
      { label: 'requests', value: r => r.requests }, { label: 'responses', value: r => r.responses }, { label: 'timeouts', value: r => r.timeouts },
      { label: 'timeoutRate', value: r => r.timeoutRate }, { label: 'exceptions', value: r => r.exceptions }, { label: 'registerCount', value: r => r.registerCount },
      { label: 'pollGroupCount', value: r => r.pollGroupCount }, { label: 'expectedPollIntervalMs', value: r => r.expectedPollIntervalMs },
      { label: 'avgRttMs', value: r => r.avgRttMs }, { label: 'p95RttMs', value: r => r.p95RttMs }, { label: 'lastSeen', value: r => new Date(r.lastSeen).toISOString() }
    ]);
  });

  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'v4.html')));
  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(publicDir, 'v4.html'));
    next();
  });

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  const handlers = {
    transaction: p => broadcast('transaction', p), port: p => broadcast('port', p), noise: p => broadcast('noise', p),
    clear: () => broadcast('clear', {}), config: p => broadcast('config', p), timeout: p => broadcast('timeout', p),
    captureLoaded: p => broadcast('capture-loaded', p)
  };
  state.on('transaction', handlers.transaction); state.on('port', handlers.port); state.on('noise', handlers.noise);
  state.on('clear', handlers.clear); state.on('config', handlers.config); state.on('timeout', handlers.timeout); state.on('capture-loaded', handlers.captureLoaded);

  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'hello', payload: { status: state.getStatus(), analysis: state.getAnalysis(), devices: state.getDevices(), replay: replay.status() } }));
    ws.on('error', () => {});
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.webPort, options.webHost, resolve); });

  return {
    url: `http://${options.webHost === '0.0.0.0' ? '127.0.0.1' : options.webHost}:${options.webPort}`,
    close: async () => {
      for (const [name, fn] of Object.entries(handlers)) {
        const event = name === 'captureLoaded' ? 'capture-loaded' : name;
        state.off(event, fn);
      }
      for (const ws of wss.clients) ws.close();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

module.exports = { startAdvancedWebServer, validateSerialConfig };
