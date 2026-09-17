'use strict';

const { ConnectionBroker } = require('../v8/connectionBroker');
const { MasterEngine } = require('../v8/master/masterEngine');
const { SerialTransport } = require('../v8/transports/serialTransport');
const { TcpClientTransport } = require('../v8/transports/tcpClientTransport');
const protocol = require('../v8/protocol');

const READ_FUNCTIONS = new Set([1, 2, 3, 4]);

class MasterRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MasterRuntimeError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, MasterRuntimeError);
  }
}

function intInRange(value, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new MasterRuntimeError('INVALID_ARGUMENT', `${field} must be ${min}..${max}`, { field, value });
  }
  return n;
}

function positiveNumber(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new MasterRuntimeError('INVALID_ARGUMENT', `${field} must be between ${min} and ${max}`, { field, value });
  }
  return n;
}

function normalizeConnectionConfig(input = {}) {
  const type = String(input.type || input.framing || '').trim().toLowerCase();
  if (!['rtu', 'ascii', 'tcp'].includes(type)) {
    throw new MasterRuntimeError('INVALID_CONNECTION_TYPE', 'Connection type must be RTU, ASCII or TCP', { type });
  }

  const timeoutMs = positiveNumber(input.timeoutMs ?? 1000, 'timeoutMs', { min: 50, max: 60000 });
  if (type === 'tcp') {
    const host = String(input.host || input.ipAddress || '').trim();
    if (!host) throw new MasterRuntimeError('INVALID_ARGUMENT', 'TCP host/IP address is required', { field: 'host' });
    const port = intInRange(input.port ?? 502, 1, 65535, 'port');
    return Object.freeze({ type, host, port, timeoutMs });
  }

  const path = String(input.path || input.port || '').trim();
  if (!path) throw new MasterRuntimeError('INVALID_ARGUMENT', 'Serial COM/port path is required', { field: 'path' });
  const baudRate = intInRange(input.baudRate ?? 9600, 50, 4000000, 'baudRate');
  const dataBits = intInRange(input.dataBits ?? 8, 5, 8, 'dataBits');
  const stopBits = Number(input.stopBits ?? 1);
  if (![1, 1.5, 2].includes(stopBits)) {
    throw new MasterRuntimeError('INVALID_ARGUMENT', 'stopBits must be 1, 1.5 or 2', { field: 'stopBits', value: input.stopBits });
  }
  const parity = String(input.parity || 'none').trim().toLowerCase();
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) {
    throw new MasterRuntimeError('INVALID_ARGUMENT', 'Unsupported serial parity', { field: 'parity', value: parity });
  }
  const echoSuppression = Boolean(input.echoSuppression);
  return Object.freeze({ type, path, baudRate, dataBits, stopBits, parity, timeoutMs, echoSuppression });
}

function normalizeReadRequest(input = {}) {
  const unitId = intInRange(input.unitId ?? input.slaveId ?? 1, 1, 247, 'unitId');
  const functionCode = intInRange(input.functionCode ?? 3, 1, 4, 'functionCode');
  if (!READ_FUNCTIONS.has(functionCode)) {
    throw new MasterRuntimeError('INVALID_FUNCTION_CODE', 'Master basic read supports FC01, FC02, FC03 and FC04', { functionCode });
  }
  const address = intInRange(input.address ?? input.startAddress ?? 0, 0, 65535, 'address');
  const maxQuantity = functionCode <= 2 ? 2000 : 125;
  const quantity = intInRange(input.quantity ?? 1, 1, maxQuantity, 'quantity');
  const timeoutMs = input.timeoutMs == null ? null : positiveNumber(input.timeoutMs, 'timeoutMs', { min: 50, max: 60000 });
  return Object.freeze({ unitId, functionCode, address, quantity, timeoutMs });
}

function referenceAddress(functionCode, address) {
  const offset = Number(address) + 1;
  if (functionCode === 1) return String(offset).padStart(5, '0');
  if (functionCode === 2) return String(10000 + offset);
  if (functionCode === 3) return String(40000 + offset);
  if (functionCode === 4) return String(30000 + offset);
  return String(offset);
}

function buildReadRows(request, decoded) {
  const values = Array.isArray(decoded?.values) ? decoded.values : [];
  return values.map((value, index) => {
    const address = request.address + index;
    const bitMode = request.functionCode <= 2;
    const rawValue = bitMode ? (value ? 1 : 0) : Number(value);
    return Object.freeze({
      index,
      address,
      reference: referenceAddress(request.functionCode, address),
      rawValue,
      rawHex: bitMode ? (rawValue ? '0x1' : '0x0') : `0x${rawValue.toString(16).toUpperCase().padStart(4, '0')}`,
      value: bitMode ? Boolean(value) : rawValue,
      quality: 'GOOD',
    });
  });
}

function defaultTransportFactory(config) {
  if (config.type === 'tcp') {
    return new TcpClientTransport({
      host: config.host,
      port: config.port,
      connectTimeoutMs: Math.min(config.timeoutMs * 3, 10000),
      writeTimeoutMs: Math.min(config.timeoutMs * 3, 10000),
      reconnect: { enabled: false },
    });
  }
  return new SerialTransport({
    path: config.path,
    baudRate: config.baudRate,
    dataBits: config.dataBits,
    stopBits: config.stopBits,
    parity: config.parity,
    framing: config.type,
    echoSuppression: config.echoSuppression,
    writeTimeoutMs: Math.min(config.timeoutMs * 3, 10000),
  });
}

class MasterRuntime {
  constructor({
    transportFactory = defaultTransportFactory,
    brokerFactory = () => new ConnectionBroker(),
    engineFactory = (options) => new MasterEngine(options),
    now = () => Date.now(),
  } = {}) {
    this.transportFactory = transportFactory;
    this.brokerFactory = brokerFactory;
    this.engineFactory = engineFactory;
    this.now = now;
    this.broker = this.brokerFactory();
    this.engine = null;
    this.config = null;
    this.connectionId = null;
    this.stats = this._newStats();
  }

  _newStats() {
    return {
      txRequests: 0,
      rxResponses: 0,
      errors: 0,
      timeouts: 0,
      rttSamples: 0,
      rttTotalMs: 0,
      lastRttMs: null,
      lastReadAt: null,
      connectedAt: null,
      lastError: null,
    };
  }

  status() {
    let connection = null;
    if (this.connectionId) {
      try { connection = this.broker.getConnection(this.connectionId); } catch { connection = null; }
    }
    const s = this.stats;
    return Object.freeze({
      connected: Boolean(connection && connection.state === 'open'),
      connection,
      config: this.config ? Object.freeze({ ...this.config }) : null,
      stats: Object.freeze({
        ...s,
        avgRttMs: s.rttSamples ? s.rttTotalMs / s.rttSamples : null,
      }),
      writeState: connection?.writeLock || 'LOCKED',
    });
  }

  async connect(input) {
    const config = normalizeConnectionConfig(input);
    await this.disconnect();

    const broker = this.brokerFactory();
    const transport = this.transportFactory(config);
    const connectionId = `master-${config.type}`;
    const resourceKey = config.type === 'tcp'
      ? `tcp-client:${config.host}:${config.port}`
      : `serial:${config.path}`;
    const transportKind = config.type === 'tcp' ? 'tcp-client' : `serial-${config.type}`;

    broker.defineConnection({
      connectionId,
      resourceKey,
      transportKind,
      transport,
      metadata: config.type === 'tcp'
        ? { host: config.host, port: config.port }
        : { path: config.path, baudRate: config.baudRate, framing: config.type },
      exclusive: true,
    });

    const engine = this.engineFactory({
      broker,
      connectionId,
      ownerId: 'stable-master',
      framing: config.type,
      timeoutMs: config.timeoutMs,
      maxTcpConcurrency: 1,
    });

    try {
      await engine.open();
    } catch (error) {
      try { await engine.close(); } catch { /* best effort */ }
      throw error;
    }

    this.broker = broker;
    this.engine = engine;
    this.config = config;
    this.connectionId = connectionId;
    this.stats = this._newStats();
    this.stats.connectedAt = this.now();
    return this.status();
  }

  async disconnect() {
    const engine = this.engine;
    this.engine = null;
    this.connectionId = null;
    this.config = null;
    if (engine) {
      try { await engine.close({ release: true }); } catch { /* best effort cleanup */ }
    }
    this.broker = this.brokerFactory();
    return this.status();
  }

  async read(input) {
    if (!this.engine || !this.connectionId) {
      throw new MasterRuntimeError('MASTER_NOT_CONNECTED', 'Connect the Modbus Master before reading');
    }
    const request = normalizeReadRequest(input);
    const pdu = protocol.encodeReadRequest({
      functionCode: request.functionCode,
      address: request.address,
      quantity: request.quantity,
    });
    this.stats.txRequests += 1;
    try {
      const result = await this.engine.request({
        unitId: request.unitId,
        pdu,
        timeoutMs: request.timeoutMs || this.config.timeoutMs,
      });
      this.stats.rxResponses += 1;
      this.stats.rttSamples += 1;
      this.stats.rttTotalMs += Number(result.rttMs || 0);
      this.stats.lastRttMs = result.rttMs ?? null;
      this.stats.lastReadAt = this.now();
      this.stats.lastError = null;
      return Object.freeze({
        ok: true,
        request,
        rows: Object.freeze(buildReadRows(request, result.decoded)),
        rttMs: result.rttMs,
        requestRawHex: result.requestRaw ? Buffer.from(result.requestRaw).toString('hex').toUpperCase() : null,
        responseRawHex: result.responseRaw ? Buffer.from(result.responseRaw).toString('hex').toUpperCase() : null,
        stats: this.status().stats,
      });
    } catch (error) {
      this.stats.errors += 1;
      if (error?.code === 'TIMEOUT') this.stats.timeouts += 1;
      this.stats.lastError = {
        code: error?.code || 'MASTER_READ_FAILED',
        message: String(error?.message || error),
        at: this.now(),
      };
      throw error;
    }
  }
}

module.exports = {
  READ_FUNCTIONS,
  MasterRuntime,
  MasterRuntimeError,
  normalizeConnectionConfig,
  normalizeReadRequest,
  referenceAddress,
  buildReadRows,
  defaultTransportFactory,
};
