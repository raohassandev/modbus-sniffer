'use strict';

const { EventEmitter } = require('node:events');
const {
  ConnectionBroker,
  MasterEngine,
  SerialTransport,
  TcpClientTransport,
  WriteAuditTrail,
  WriteSafetyController,
  protocol,
} = require('../modbusCore');

const READ_FUNCTIONS = new Set([1, 2, 3, 4]);
const WRITE_FUNCTIONS = new Set([5, 6, 15, 16, 21, 22, 23]);
const ADVANCED_READ_FUNCTIONS = new Set([7, 8, 11, 12, 17, 20, 24, 43]);
const SERIAL_ONLY_ADVANCED_FUNCTIONS = new Set([7, 8, 11, 12, 17]);

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

function normalizeAdvancedRequest(input = {}, framing = 'rtu') {
  const functionCode = intInRange(input.functionCode, 1, 255, 'functionCode');
  if (!ADVANCED_READ_FUNCTIONS.has(functionCode)) {
    throw new MasterRuntimeError('INVALID_FUNCTION_CODE', 'Advanced request supports FC07, FC08, FC11, FC12, FC17, FC20, FC24 and FC43/14', { functionCode });
  }
  if (framing === 'tcp' && SERIAL_ONLY_ADVANCED_FUNCTIONS.has(functionCode)) {
    throw new MasterRuntimeError('FUNCTION_NOT_APPLICABLE', `FC${String(functionCode).padStart(2, '0')} is exposed here only for serial RTU/ASCII diagnostics`, { functionCode, framing });
  }
  const unitMax = framing === 'tcp' ? 255 : 247;
  const unitId = intInRange(input.unitId ?? input.slaveId ?? 1, 1, unitMax, 'unitId');
  let pdu;
  let descriptor = { unitId, functionCode };

  if (functionCode === 7) {
    pdu = protocol.encodeReadExceptionStatusRequest();
  } else if (functionCode === 8) {
    const subFunction = intInRange(input.subFunction ?? 0, 0, 0xFFFF, 'subFunction');
    const data = intInRange(input.data ?? 0, 0, 0xFFFF, 'data');
    if (subFunction !== 0 && input.labConfirmed !== true) {
      throw new MasterRuntimeError('LAB_CONFIRMATION_REQUIRED', 'Non-zero FC08 diagnostic subfunctions require explicit LAB confirmation', { subFunction });
    }
    pdu = protocol.encodeDiagnosticsRequest({ subFunction, data });
    descriptor = { ...descriptor, subFunction, data, labConfirmed: input.labConfirmed === true };
  } else if (functionCode === 11) {
    pdu = protocol.encodeCommEventCounterRequest();
  } else if (functionCode === 12) {
    pdu = protocol.encodeCommEventLogRequest();
  } else if (functionCode === 17) {
    pdu = protocol.encodeReportServerIdRequest();
  } else if (functionCode === 20) {
    if (!Array.isArray(input.records) || !input.records.length) throw new MasterRuntimeError('INVALID_ARGUMENT', 'FC20 records must be a non-empty array');
    const records = input.records.map((record, index) => ({
      fileNumber: intInRange(record.fileNumber, 0, 0xFFFF, `records[${index}].fileNumber`),
      recordNumber: intInRange(record.recordNumber, 0, 0xFFFF, `records[${index}].recordNumber`),
      recordLength: intInRange(record.recordLength, 1, 125, `records[${index}].recordLength`),
    }));
    pdu = protocol.encodeReadFileRecordRequest({ records });
    descriptor = { ...descriptor, records };
  } else if (functionCode === 24) {
    const address = intInRange(input.address ?? 0, 0, 0xFFFF, 'address');
    pdu = protocol.encodeReadFifoQueueRequest({ address });
    descriptor = { ...descriptor, address };
  } else if (functionCode === 43) {
    const readDeviceIdCode = intInRange(input.readDeviceIdCode ?? 1, 1, 4, 'readDeviceIdCode');
    const objectId = intInRange(input.objectId ?? 0, 0, 0xFF, 'objectId');
    pdu = protocol.encodeDeviceIdRequest({ readDeviceIdCode, objectId });
    descriptor = { ...descriptor, meiType: 14, readDeviceIdCode, objectId };
  }
  return Object.freeze({ ...descriptor, pdu });
}

function coilValue(value, field) {
  if ([true, 1, '1', 'true', 'TRUE', 'on', 'ON'].includes(value)) return true;
  if ([false, 0, '0', 'false', 'FALSE', 'off', 'OFF'].includes(value)) return false;
  throw new MasterRuntimeError('INVALID_ARGUMENT', `${field} must be boolean/0/1`, { field, value });
}

function normalizeWriteRequest(input = {}, framing = 'rtu') {
  const functionCode = intInRange(input.functionCode, 1, 255, 'functionCode');
  if (!WRITE_FUNCTIONS.has(functionCode)) {
    throw new MasterRuntimeError('INVALID_FUNCTION_CODE', 'Guarded writes support FC05, FC06, FC15, FC16, FC22 and FC23', { functionCode });
  }
  const unitMin = framing === 'tcp' ? 1 : 0;
  const unitMax = framing === 'tcp' ? 255 : 247;
  const unitId = intInRange(input.unitId ?? input.slaveId ?? 1, unitMin, unitMax, 'unitId');
  if (unitId === 0 && ![5, 6, 15, 16].includes(functionCode)) {
    throw new MasterRuntimeError('INVALID_BROADCAST_FUNCTION', 'Serial broadcast is supported only for FC05, FC06, FC15 and FC16', { functionCode });
  }

  const address = intInRange(input.address ?? 0, 0, 65535, 'address');
  let pdu;
  let descriptor = { functionCode, unitId, address };

  if (functionCode === 5) {
    const value = coilValue(input.value, 'value');
    pdu = protocol.encodeWriteSingleCoilRequest({ address, value });
    descriptor = { ...descriptor, value };
  } else if (functionCode === 6) {
    const value = intInRange(input.value, 0, 0xFFFF, 'value');
    pdu = protocol.encodeWriteSingleRegisterRequest({ address, value });
    descriptor = { ...descriptor, value };
  } else if (functionCode === 15) {
    if (!Array.isArray(input.values) || !input.values.length) throw new MasterRuntimeError('INVALID_ARGUMENT', 'values must be a non-empty array for FC15');
    const values = input.values.map((value, index) => coilValue(value, `values[${index}]`));
    pdu = protocol.encodeWriteMultipleCoilsRequest({ address, values });
    descriptor = { ...descriptor, values };
  } else if (functionCode === 16) {
    if (!Array.isArray(input.values) || !input.values.length) throw new MasterRuntimeError('INVALID_ARGUMENT', 'values must be a non-empty array for FC16');
    const values = input.values.map((value, index) => intInRange(value, 0, 0xFFFF, `values[${index}]`));
    pdu = protocol.encodeWriteMultipleRegistersRequest({ address, values });
    descriptor = { ...descriptor, values };
  } else if (functionCode === 21) {
    if (!Array.isArray(input.records) || !input.records.length) throw new MasterRuntimeError('INVALID_ARGUMENT', 'FC21 records must be a non-empty array');
    const records = input.records.map((record, index) => ({
      fileNumber: intInRange(record.fileNumber, 0, 0xFFFF, `records[${index}].fileNumber`),
      recordNumber: intInRange(record.recordNumber, 0, 0xFFFF, `records[${index}].recordNumber`),
      values: Array.isArray(record.values) && record.values.length
        ? record.values.map((value, valueIndex) => intInRange(value, 0, 0xFFFF, `records[${index}].values[${valueIndex}]`))
        : (() => { throw new MasterRuntimeError('INVALID_ARGUMENT', `records[${index}].values must be a non-empty array`); })(),
    }));
    pdu = protocol.encodeWriteFileRecordRequest({ records });
    descriptor = { ...descriptor, records };
  } else if (functionCode === 22) {
    const andMask = intInRange(input.andMask, 0, 0xFFFF, 'andMask');
    const orMask = intInRange(input.orMask, 0, 0xFFFF, 'orMask');
    pdu = protocol.encodeMaskWriteRegisterRequest({ address, andMask, orMask });
    descriptor = { ...descriptor, andMask, orMask };
  } else if (functionCode === 23) {
    const readAddress = intInRange(input.readAddress ?? address, 0, 0xFFFF, 'readAddress');
    const readQuantity = intInRange(input.readQuantity ?? 1, 1, 125, 'readQuantity');
    const writeAddress = intInRange(input.writeAddress ?? address, 0, 0xFFFF, 'writeAddress');
    if (!Array.isArray(input.values) || !input.values.length) throw new MasterRuntimeError('INVALID_ARGUMENT', 'values must be a non-empty array for FC23');
    const values = input.values.map((value, index) => intInRange(value, 0, 0xFFFF, `values[${index}]`));
    pdu = protocol.encodeReadWriteMultipleRegistersRequest({ readAddress, readQuantity, writeAddress, values });
    descriptor = { functionCode, unitId, address: writeAddress, readAddress, readQuantity, writeAddress, values };
  }

  return Object.freeze({ ...descriptor, pdu });
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

class MasterRuntime extends EventEmitter {
  constructor({
    transportFactory = defaultTransportFactory,
    brokerFactory = () => new ConnectionBroker(),
    engineFactory = (options) => new MasterEngine(options),
    now = () => Date.now(),
  } = {}) {
    super();
    this.transportFactory = transportFactory;
    this.brokerFactory = brokerFactory;
    this.engineFactory = engineFactory;
    this.now = now;
    this.broker = this.brokerFactory();
    this.engine = null;
    this.config = null;
    this.connectionId = null;
    this.writeAudit = new WriteAuditTrail();
    this.safety = null;
    this._engineEventRelay = null;
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
      writeOperations: 0,
      writeFailures: 0,
      advancedOperations: 0,
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
      writeSafety: this.safety?.status?.() || null,
      writeAuditCount: this.writeAudit.list().length,
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

    const safety = new WriteSafetyController({ master: engine, auditTrail: this.writeAudit, userId: 'stable-local-user', sessionId: 'stable-master' });
    const relay = (event) => this.emit('event', event);
    engine.on('event', relay);
    this._engineEventRelay = relay;
    this.broker = broker;
    this.engine = engine;
    this.safety = safety;
    this.config = config;
    this.connectionId = connectionId;
    this.stats = this._newStats();
    this.stats.connectedAt = this.now();
    return this.status();
  }

  async disconnect() {
    const engine = this.engine;
    const safety = this.safety;
    const relay = this._engineEventRelay;
    if (engine && relay) engine.off('event', relay);
    this._engineEventRelay = null;
    if (safety && engine) { try { safety.lock({ reason: 'disconnect' }); } catch { /* already locked/offline */ } }
    this.engine = null;
    this.safety = null;
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

  resetStats() {
    const connectedAt = this.stats.connectedAt;
    this.stats = this._newStats();
    this.stats.connectedAt = connectedAt;
    return this.status();
  }

  writeAuditEntries({ limit = 200 } = {}) {
    return this.writeAudit.list({ limit: Math.max(1, Math.min(5000, Number(limit) || 200)) });
  }

  async writePdu({
    unitId,
    pdu,
    confirmation = null,
    readBack = true,
    captureOldValue = true,
    autoLockMs = 10000,
    comment = '',
    source = 'stable-master',
  } = {}) {
    if (!this.engine || !this.connectionId || !this.safety) {
      throw new MasterRuntimeError('MASTER_NOT_CONNECTED', 'Connect the Modbus Master before writing');
    }
    const framing = this.config?.type || 'rtu';
    const minUnit = framing === 'tcp' ? 1 : 0;
    const maxUnit = framing === 'tcp' ? 255 : 247;
    const normalizedUnitId = intInRange(unitId, minUnit, maxUnit, 'unitId');
    const rawPdu = protocol.validatePdu(pdu);
    const resolvedConfirmation = confirmation && typeof confirmation === 'object' ? { ...confirmation } : {};
    const lockMs = positiveNumber(autoLockMs, 'autoLockMs', { min: 250, max: 60000 });
    const broadcast = normalizedUnitId === 0;
    let unlocked = false;

    try {
      this.safety.unlock({ durationMs: lockMs, confirmation: { confirmed: resolvedConfirmation.confirmed === true } });
      unlocked = true;
      const result = await this.safety.execute({
        unitId: normalizedUnitId,
        pdu: rawPdu,
        confirmation: resolvedConfirmation,
        captureOldValue: broadcast ? false : Boolean(captureOldValue),
        readBack: broadcast ? false : Boolean(readBack),
        context: {
          source: String(source || 'stable-master').slice(0, 100),
          comment: String(comment || '').slice(0, 500),
        },
      });
      this.stats.writeOperations += 1;
      this.stats.lastError = null;
      const audit = this.writeAudit.list({ limit: 1 })[0] || null;
      return Object.freeze({
        ...result,
        verification: audit?.verification || null,
        audit,
      });
    } catch (error) {
      this.stats.writeFailures += 1;
      this.stats.lastError = { code: error?.code || 'MASTER_WRITE_FAILED', message: String(error?.message || error), at: this.now() };
      throw error;
    } finally {
      if (unlocked) {
        try { this.safety.lock({ reason: 'operation-complete' }); } catch { /* connection loss already locks */ }
      }
    }
  }

  async write(input = {}) {
    const request = normalizeWriteRequest(input, this.config?.type || 'rtu');
    const result = await this.writePdu({
      unitId: request.unitId,
      pdu: request.pdu,
      confirmation: input.confirmation,
      readBack: input.readBack !== false,
      captureOldValue: input.captureOldValue !== false,
      autoLockMs: input.autoLockMs ?? 10000,
      comment: input.comment,
      source: 'stable-master',
    });
    return Object.freeze({
      ok: true,
      request: Object.freeze({ ...request, pdu: undefined }),
      rttMs: result?.rttMs ?? null,
      requestRawHex: result?.requestRaw ? Buffer.from(result.requestRaw).toString('hex').toUpperCase() : null,
      responseRawHex: result?.responseRaw ? Buffer.from(result.responseRaw).toString('hex').toUpperCase() : null,
      decoded: result?.decoded ?? null,
      verification: result?.verification || null,
      audit: result?.audit || null,
      writeState: this.status().writeState,
    });
  }


  async advanced(input = {}) {
    if (!this.engine || !this.connectionId) {
      throw new MasterRuntimeError('MASTER_NOT_CONNECTED', 'Connect the Modbus Master before sending an advanced request');
    }
    const request = normalizeAdvancedRequest(input, this.config?.type || 'rtu');
    this.stats.txRequests += 1;
    try {
      const result = await this.engine.request({
        unitId: request.unitId,
        pdu: request.pdu,
        timeoutMs: input.timeoutMs == null ? this.config.timeoutMs : positiveNumber(input.timeoutMs, 'timeoutMs', { min: 50, max: 60000 }),
      });
      this.stats.rxResponses += 1;
      this.stats.rttSamples += 1;
      this.stats.rttTotalMs += Number(result.rttMs || 0);
      this.stats.lastRttMs = result.rttMs ?? null;
      this.stats.lastReadAt = this.now();
      this.stats.advancedOperations += 1;
      this.stats.lastError = null;
      return Object.freeze({
        ok: true,
        request: Object.freeze({ ...request, pdu: undefined }),
        decoded: result.decoded ?? null,
        rttMs: result.rttMs ?? null,
        requestRawHex: result.requestRaw ? Buffer.from(result.requestRaw).toString('hex').toUpperCase() : null,
        responseRawHex: result.responseRaw ? Buffer.from(result.responseRaw).toString('hex').toUpperCase() : null,
        responsePduHex: result.responsePdu ? Buffer.from(result.responsePdu).toString('hex').toUpperCase() : null,
        stats: this.status().stats,
      });
    } catch (error) {
      this.stats.errors += 1;
      if (error?.code === 'TIMEOUT') this.stats.timeouts += 1;
      this.stats.lastError = { code: error?.code || 'MASTER_ADVANCED_FAILED', message: String(error?.message || error), at: this.now() };
      throw error;
    }
  }


}

module.exports = {
  READ_FUNCTIONS,
  WRITE_FUNCTIONS,
  ADVANCED_READ_FUNCTIONS,
  SERIAL_ONLY_ADVANCED_FUNCTIONS,
  MasterRuntime,
  MasterRuntimeError,
  normalizeConnectionConfig,
  normalizeReadRequest,
  normalizeWriteRequest,
  normalizeAdvancedRequest,
  referenceAddress,
  buildReadRows,
  defaultTransportFactory,
};
