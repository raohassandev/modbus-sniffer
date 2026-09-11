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
  if (!port) throw new Error('Serial port is required.');
  if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 4000000) throw new Error('Invalid baud rate.');
  if (![5, 6, 7, 8].includes(dataBits)) throw new Error('dataBits must be 5, 6, 7, or 8.');
  if (![1, 2].includes(stopBits)) throw new Error('stopBits must be 1 or 2.');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new Error('Invalid parity.');
  if (!Number.isFinite(reconnectMs) || reconnectMs < 250) throw new Error('Reconnect interval must be at least 250 ms.');
  return { port, baudRate, dataBits, stopBits, parity, reconnectMs };
}

async function startWebServer({ state, options, configureSerial, demo = false }) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const publicDir = path.join(__dirname, '..', 'public');

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
    next();
  });

  app.get('/api/status', (_req, res) => res.json(state.getStatus()));
  app.get('/api/analysis', (_req, res) => res.json(state.getAnalysis()));
  app.get('/api/transactions', (req, res) => res.json(state.getTransactions(req.query)));
  app.get('/api/registers', (req, res) => res.json(state.getRegisters(req.query)));
  app.get('/api/config', (_req, res) => res.json({ ...state.config, demo }));
  app.get('/api/ports', async (_req, res) => {
    try {
      res.json(await PortManager.list());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/serial/configure', async (req, res) => {
    if (demo) return res.status(409).json({ error: 'Serial configuration is disabled in demo mode.' });
    try {
      const next = validateSerialConfig(req.body || {});
      await configureSerial(next);
      res.json({ ok: true, config: state.config });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/capture/clear', (_req, res) => {
    state.clearCapture();
    res.json({ ok: true });
  });

  app.get('/api/export/transactions.csv', (_req, res) => {
    const rows = state.getTransactions({ limit: 5000 });
    sendCsv(res, 'modbus-transactions.csv', rows, [
      { label: 'id', value: r => r.id },
      { label: 'timestamp', value: r => new Date(r.timestamp).toISOString() },
      { label: 'direction', value: r => r.direction },
      { label: 'slave', value: r => r.slaveId },
      { label: 'function', value: r => r.functionCode },
      { label: 'functionName', value: r => r.functionName },
      { label: 'rttMs', value: r => r.rttMs },
      { label: 'exception', value: r => r.exceptionName || '' },
      { label: 'rawHex', value: r => r.rawHex },
      { label: 'decoded', value: r => r.decoded }
    ]);
  });

  app.get('/api/export/registers.csv', (_req, res) => {
    const rows = state.getRegisters({ limit: 10000 });
    sendCsv(res, 'modbus-registers.csv', rows, [
      { label: 'slave', value: r => r.slaveId },
      { label: 'function', value: r => r.functionCode },
      { label: 'address', value: r => r.address },
      { label: 'lastValue', value: r => r.lastValue },
      { label: 'lastHex', value: r => r.lastHex },
      { label: 'min', value: r => r.min },
      { label: 'max', value: r => r.max },
      { label: 'reads', value: r => r.reads },
      { label: 'writes', value: r => r.writes },
      { label: 'changes', value: r => r.changes },
      { label: 'lastSeen', value: r => new Date(r.lastSeen).toISOString() }
    ]);
  });

  app.use(express.static(publicDir));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(publicDir, 'index.html'));
    next();
  });

  const broadcast = (type, payload) => {
    const msg = JSON.stringify({ type, payload });
    for (const ws of wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };

  const onTransaction = payload => broadcast('transaction', payload);
  const onPort = payload => broadcast('port', payload);
  const onNoise = payload => broadcast('noise', payload);
  const onClear = () => broadcast('clear', {});
  const onConfig = payload => broadcast('config', payload);
  state.on('transaction', onTransaction);
  state.on('port', onPort);
  state.on('noise', onNoise);
  state.on('clear', onClear);
  state.on('config', onConfig);

  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'hello', payload: { status: state.getStatus(), analysis: state.getAnalysis() } }));
    ws.on('error', () => {});
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.webPort, options.webHost, resolve);
  });

  return {
    url: `http://${options.webHost === '0.0.0.0' ? '127.0.0.1' : options.webHost}:${options.webPort}`,
    close: async () => {
      state.off('transaction', onTransaction);
      state.off('port', onPort);
      state.off('noise', onNoise);
      state.off('clear', onClear);
      state.off('config', onConfig);
      for (const ws of wss.clients) ws.close();
      await new Promise(resolve => server.close(() => resolve()));
    }
  };
}

module.exports = { startWebServer, validateSerialConfig };
