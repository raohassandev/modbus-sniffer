'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { appendCrc, hasValidCrc } = require('../../modbus/crc16');
const { createWorkbenchEvent } = require('../events');

const WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
  protocol.FC.MASK_WRITE_REGISTER,
  protocol.FC.READ_WRITE_MULTIPLE_REGISTERS,
  protocol.FC.WRITE_FILE_RECORD,
].filter(Number.isInteger));

const NORMAL_READ_FUNCTIONS = new Set([
  protocol.FC.READ_COILS,
  protocol.FC.READ_DISCRETE_INPUTS,
  protocol.FC.READ_HOLDING_REGISTERS,
  protocol.FC.READ_INPUT_REGISTERS,
  protocol.FC.READ_EXCEPTION_STATUS,
  protocol.FC.DIAGNOSTICS,
  protocol.FC.GET_COMM_EVENT_COUNTER,
  protocol.FC.GET_COMM_EVENT_LOG,
  protocol.FC.REPORT_SERVER_ID,
  protocol.FC.READ_FILE_RECORD,
  protocol.FC.READ_FIFO_QUEUE,
  protocol.FC.ENCAPSULATED_INTERFACE,
].filter(Number.isInteger));

class RawFrameStudioError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RawFrameStudioError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, RawFrameStudioError);
  }
}

function parseHexText(value) {
  if (typeof value !== 'string') throw new RawFrameStudioError('INVALID_HEX', 'HEX input must be a string');
  let text = value.trim().replace(/0x/gi, '').replace(/[\s,_:-]+/g, '');
  if (!text.length) throw new RawFrameStudioError('EMPTY_FRAME', 'Frame cannot be empty');
  if ((text.length & 1) !== 0 || !/^[0-9A-Fa-f]+$/.test(text)) {
    throw new RawFrameStudioError('INVALID_HEX', 'HEX input must contain complete hexadecimal byte pairs');
  }
  return Buffer.from(text, 'hex');
}

function inputBytes({ hex = null, ascii = null, bytes = null } = {}) {
  const supplied = [hex != null, ascii != null, bytes != null].filter(Boolean).length;
  if (supplied !== 1) throw new RawFrameStudioError('AMBIGUOUS_INPUT', 'Provide exactly one of hex, ascii or bytes');
  if (hex != null) return parseHexText(hex);
  if (ascii != null) {
    if (typeof ascii !== 'string' || !ascii.length) throw new RawFrameStudioError('EMPTY_FRAME', 'ASCII frame cannot be empty');
    return Buffer.from(ascii, 'ascii');
  }
  const out = Buffer.from(bytes ?? []);
  if (!out.length) throw new RawFrameStudioError('EMPTY_FRAME', 'Frame cannot be empty');
  return out;
}

function maskMatches(actual, expected, mask = null) {
  const left = Buffer.from(actual ?? []);
  const right = Buffer.from(expected ?? []);
  if (left.length !== right.length) return false;
  const effectiveMask = mask == null ? Buffer.alloc(right.length, 0xFF) : Buffer.from(mask);
  if (effectiveMask.length !== right.length) throw new RawFrameStudioError('INVALID_MASK', 'Expected-response mask length must match expected bytes');
  for (let i = 0; i < right.length; i += 1) {
    if ((left[i] & effectiveMask[i]) !== (right[i] & effectiveMask[i])) return false;
  }
  return true;
}
function decodeAdu(framing, raw) {
  if (framing === 'rtu') return protocol.decodeRtuAdu(raw);
  if (framing === 'ascii') return protocol.decodeAsciiAdu(raw);
  if (framing === 'tcp') return protocol.decodeTcpAdu(raw);
  throw new RawFrameStudioError('INVALID_FRAMING', 'framing must be rtu, ascii or tcp', { framing });
}

function validateSuccessfulResponsePdu(requestPdu, responsePdu) {
  const request = Buffer.from(requestPdu ?? []);
  const response = Buffer.from(responsePdu ?? []);
  const fc = request[0];
  let decoded = null;

  switch (fc) {
    case protocol.FC.READ_COILS:
    case protocol.FC.READ_DISCRETE_INPUTS: {
      const req = protocol.decodeReadRequest(request);
      decoded = protocol.decodeReadBitsResponse(response, { expectedQuantity: req.quantity });
      break;
    }
    case protocol.FC.READ_HOLDING_REGISTERS:
    case protocol.FC.READ_INPUT_REGISTERS: {
      const req = protocol.decodeReadRequest(request);
      decoded = protocol.decodeReadRegistersResponse(response, { expectedQuantity: req.quantity });
      break;
    }
    case protocol.FC.WRITE_SINGLE_COIL:
    case protocol.FC.WRITE_SINGLE_REGISTER:
    case protocol.FC.DIAGNOSTICS:
    case protocol.FC.WRITE_FILE_RECORD:
    case protocol.FC.MASK_WRITE_REGISTER: {
      if (!response.equals(request)) {
        throw new RawFrameStudioError('RESPONSE_ECHO_MISMATCH', 'Successful Modbus response does not echo the request as required', { functionCode: fc });
      }
      if (fc === protocol.FC.DIAGNOSTICS) decoded = protocol.decodeDiagnosticsResponse(response);
      else if (fc === protocol.FC.WRITE_FILE_RECORD) decoded = protocol.decodeWriteFileRecordResponse(response);
      else if (fc === protocol.FC.MASK_WRITE_REGISTER) decoded = protocol.decodeMaskWriteRegisterRequest(response);
      else decoded = protocol.decodeWriteSingleRequest(response);
      break;
    }
    case protocol.FC.WRITE_MULTIPLE_COILS:
    case protocol.FC.WRITE_MULTIPLE_REGISTERS: {
      const req = protocol.decodeWriteMultipleRequest(request);
      decoded = protocol.decodeWriteMultipleResponse(response);
      if (decoded.address !== req.address || decoded.quantity !== req.quantity) {
        throw new RawFrameStudioError('RESPONSE_WRITE_MISMATCH', 'Write-multiple response address/quantity does not match the request', {
          functionCode: fc,
          requestAddress: req.address,
          responseAddress: decoded.address,
          requestQuantity: req.quantity,
          responseQuantity: decoded.quantity,
        });
      }
      break;
    }
    case protocol.FC.READ_WRITE_MULTIPLE_REGISTERS: {
      const req = protocol.decodeReadWriteMultipleRegistersRequest(request);
      decoded = protocol.decodeReadRegistersResponse(response, { expectedQuantity: req.readQuantity });
      break;
    }
    case protocol.FC.READ_EXCEPTION_STATUS:
      protocol.decodeReadExceptionStatusRequest(request);
      decoded = protocol.decodeReadExceptionStatusResponse(response);
      break;
    case protocol.FC.GET_COMM_EVENT_COUNTER:
      protocol.decodeCommEventCounterRequest(request);
      decoded = protocol.decodeCommEventCounterResponse(response);
      break;
    case protocol.FC.GET_COMM_EVENT_LOG:
      protocol.decodeCommEventLogRequest(request);
      decoded = protocol.decodeCommEventLogResponse(response);
      break;
    case protocol.FC.REPORT_SERVER_ID:
      protocol.decodeReportServerIdRequest(request);
      decoded = protocol.decodeReportServerIdResponse(response);
      break;
    case protocol.FC.READ_FILE_RECORD: {
      const req = protocol.decodeReadFileRecordRequest(request);
      decoded = protocol.decodeReadFileRecordResponse(response);
      if (decoded.records.length !== req.records.length) {
        throw new RawFrameStudioError('RESPONSE_QUANTITY_MISMATCH', 'File-record response count does not match the request', {
          requestRecords: req.records.length,
          responseRecords: decoded.records.length,
        });
      }
      for (let index = 0; index < req.records.length; index += 1) {
        if (decoded.records[index].values.length !== req.records[index].recordLength) {
          throw new RawFrameStudioError('RESPONSE_QUANTITY_MISMATCH', 'File-record response length does not match the request', {
            recordIndex: index,
            requestedLength: req.records[index].recordLength,
            responseLength: decoded.records[index].values.length,
          });
        }
      }
      break;
    }
    case protocol.FC.READ_FIFO_QUEUE:
      protocol.decodeReadFifoQueueRequest(request);
      decoded = protocol.decodeReadFifoQueueResponse(response);
      break;
    case protocol.FC.ENCAPSULATED_INTERFACE:
      protocol.decodeDeviceIdRequest(request);
      decoded = protocol.decodeDeviceIdResponse(response);
      break;
    default:
      protocol.validatePdu(response);
      decoded = { functionCode: response[0], vendorOrUnsupported: true };
      break;
  }

  return decoded;
}

function validateResponseSemantics({ framing, requestRaw, responseRaw, policy = 'matching' } = {}) {
  if (!['matching', 'success'].includes(policy)) {
    throw new RawFrameStudioError('INVALID_RESPONSE_POLICY', 'responsePolicy must be any, matching or success', { policy });
  }
  let request;
  let response;
  try {
    request = decodeAdu(framing, Buffer.from(requestRaw ?? []));
  } catch (error) {
    throw new RawFrameStudioError('INVALID_REQUEST_FRAME', 'Cannot semantically validate a malformed request frame', {
      causeCode: error?.code || null,
      cause: String(error?.message || error),
    });
  }
  try {
    response = decodeAdu(framing, Buffer.from(responseRaw ?? []));
  } catch (error) {
    throw new RawFrameStudioError('INVALID_RESPONSE_FRAME', 'Response failed Modbus framing/checksum validation', {
      causeCode: error?.code || null,
      cause: String(error?.message || error),
    });
  }

  if (response.unitId !== request.unitId) {
    throw new RawFrameStudioError('RESPONSE_UNIT_MISMATCH', 'Response Unit ID does not match the request', {
      requestUnitId: request.unitId,
      responseUnitId: response.unitId,
    });
  }
  if (framing === 'tcp' && response.transactionId !== request.transactionId) {
    throw new RawFrameStudioError('RESPONSE_TID_MISMATCH', 'Response Transaction ID does not match the request', {
      requestTransactionId: request.transactionId,
      responseTransactionId: response.transactionId,
    });
  }

  const requestFunctionCode = request.pdu[0];
  const responseFunctionCode = response.pdu[0];
  if ((responseFunctionCode & 0x7F) !== requestFunctionCode) {
    throw new RawFrameStudioError('RESPONSE_FUNCTION_MISMATCH', 'Response function does not match the request', {
      requestFunctionCode,
      responseFunctionCode,
    });
  }

  const exception = Boolean(responseFunctionCode & 0x80);
  let exceptionCode = null;
  let decoded = null;
  if (exception) {
    exceptionCode = protocol.decodeExceptionPdu(response.pdu).exceptionCode;
    if (policy === 'success') {
      throw new RawFrameStudioError('MODBUS_EXCEPTION', `Modbus exception ${exceptionCode} returned instead of a successful response`, {
        requestFunctionCode,
        responseFunctionCode,
        exceptionCode,
      });
    }
  } else {
    try {
      decoded = validateSuccessfulResponsePdu(request.pdu, response.pdu);
    } catch (error) {
      if (error instanceof RawFrameStudioError) throw error;
      throw new RawFrameStudioError('INVALID_RESPONSE_PDU', 'Response PDU is structurally inconsistent with the request', {
        requestFunctionCode,
        causeCode: error?.code || null,
        cause: String(error?.message || error),
      });
    }
  }

  return Object.freeze({
    policy,
    unitId: response.unitId,
    functionCode: responseFunctionCode,
    requestFunctionCode,
    exception,
    exceptionCode,
    structureValid: true,
    decoded,
    transactionId: response.transactionId ?? null,
    pduHex: Buffer.from(response.pdu).toString('hex').toUpperCase(),
  });
}


function sleep(ms, signal = null) {
  if (!ms) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new RawFrameStudioError('ABORTED', 'Operation was aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      reject(new RawFrameStudioError('ABORTED', 'Operation was aborted'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

class RawFrameStudio extends EventEmitter {
  constructor({ broker, connectionId, ownerId = 'v8-test-center', framing = 'rtu', maxAuditEntries = 5000 } = {}) {
    super();
    if (!broker) throw new TypeError('broker is required');
    if (typeof connectionId !== 'string' || !connectionId) throw new TypeError('connectionId is required');
    if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new TypeError('framing must be rtu, ascii or tcp');
    if (!Number.isInteger(maxAuditEntries) || maxAuditEntries < 1) throw new TypeError('maxAuditEntries must be positive');
    this.broker = broker;
    this.connectionId = connectionId;
    this.ownerId = ownerId;
    this.framing = framing;
    this.maxAuditEntries = maxAuditEntries;
    this.audit = [];
    this.sequence = 0;
    this.labArmed = false;
    this.labTimer = null;
  }

  async open() {
    const current = this.broker.getConnection(this.connectionId);
    if (current.state === 'open') {
      if (current.owner?.ownerMode !== 'test' || current.owner?.ownerId !== this.ownerId) {
        throw new RawFrameStudioError('OWNER_MISMATCH', 'Connection is already owned by another runtime', { owner: current.owner });
      }
      return current;
    }
    return this.broker.open(this.connectionId, { ownerMode: 'test', ownerId: this.ownerId });
  }

  async close({ release = true } = {}) {
    this.disarmLab('close');
    const status = this.broker.getConnection(this.connectionId);
    if (status.state === 'open' || status.state === 'error') await this.broker.close(this.connectionId, { ownerId: this.ownerId });
    const after = this.broker.getConnection(this.connectionId);
    if (release && after.owner?.ownerId === this.ownerId) this.broker.release(this.connectionId, { ownerId: this.ownerId });
  }

  armLab({ confirmation = null, durationMs = 0 } = {}) {
    if (!confirmation?.confirmed || confirmation.raw !== true) {
      throw new RawFrameStudioError('LAB_CONFIRMATION_REQUIRED', 'LAB/raw transmission requires explicit raw-frame confirmation');
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RawFrameStudioError('INVALID_DURATION', 'durationMs must be >= 0');
    this.disarmLab('rearm');
    this.labArmed = true;
    if (durationMs > 0) {
      this.labTimer = setTimeout(() => this.disarmLab('auto-lock'), durationMs);
      this.labTimer.unref?.();
    }
    this._emit('test.lab-armed', { durationMs });
    return this.status();
  }

  disarmLab(reason = 'manual') {
    if (this.labTimer) clearTimeout(this.labTimer);
    this.labTimer = null;
    const changed = this.labArmed;
    this.labArmed = false;
    if (changed) this._emit('test.lab-disarmed', { reason });
    return this.status();
  }

  setWriteEnabled(enabled) {
    return this.broker.setWriteLock(this.connectionId, { ownerId: this.ownerId, enabled: Boolean(enabled) });
  }

  status() {
    let connection = null;
    try { connection = this.broker.getConnection(this.connectionId); } catch { /* not defined */ }
    return Object.freeze({
      connectionId: this.connectionId,
      ownerId: this.ownerId,
      framing: this.framing,
      labArmed: this.labArmed,
      writeLock: connection?.writeLock || 'UNKNOWN',
      connectionState: connection?.state || 'unknown',
      auditEntries: this.audit.length,
    });
  }

  prepare({ hex = null, ascii = null, bytes = null, autoChecksum = false } = {}) {
    let raw = inputBytes({ hex, ascii, bytes });
    if (autoChecksum && this.framing === 'rtu' && !hasValidCrc(raw)) raw = appendCrc(raw);
    if (autoChecksum && this.framing === 'ascii') {
      const literalAscii = raw[0] === 0x3A;
      if (!literalAscii) {
        const withLrc = protocol.hasValidLrc(raw) ? raw : protocol.appendLrc(raw);
        raw = Buffer.from(`:${withLrc.toString('hex').toUpperCase()}\r\n`, 'ascii');
      }
    }
    return Buffer.from(raw);
  }

  classify(raw) {
    const bytes = Buffer.from(raw ?? []);
    try {
      const decoded = this.framing === 'rtu'
        ? protocol.decodeRtuAdu(bytes)
        : this.framing === 'ascii'
          ? protocol.decodeAsciiAdu(bytes)
          : protocol.decodeTcpAdu(bytes);
      const functionCode = decoded.pdu[0];
      const category = WRITE_FUNCTIONS.has(functionCode) ? 'write' : NORMAL_READ_FUNCTIONS.has(functionCode) ? 'read' : 'raw';
      return Object.freeze({ category, valid: true, functionCode, unitId: decoded.unitId, transactionId: decoded.transactionId ?? null, decoded });
    } catch (error) {
      return Object.freeze({ category: 'raw', valid: false, functionCode: null, unitId: null, transactionId: null, errorCode: error?.code || null, error: error.message });
    }
  }

  async send({
    hex = null,
    ascii = null,
    bytes = null,
    autoChecksum = false,
    expectResponse = true,
    timeoutMs = 1000,
    confirmation = null,
    expectedHex = null,
    expectedMaskHex = null,
    responsePolicy = 'any',
    signal = null,
  } = {}) {
    if (signal?.aborted) throw new RawFrameStudioError('ABORTED', 'Operation was aborted');
    if (!['any', 'matching', 'success'].includes(responsePolicy)) {
      throw new RawFrameStudioError('INVALID_RESPONSE_POLICY', 'responsePolicy must be any, matching or success', { responsePolicy });
    }
    const raw = this.prepare({ hex, ascii, bytes, autoChecksum });
    const classification = this.classify(raw);
    let intent = classification.category;
    if (intent === 'raw') {
      if (!this.labArmed || confirmation?.raw !== true) {
        throw new RawFrameStudioError('LAB_NOT_ARMED', 'Malformed, vendor or manual raw frames require armed LAB mode and per-send raw confirmation');
      }
      intent = 'raw';
    }
    if (intent === 'write' && confirmation?.write !== true) {
      throw new RawFrameStudioError('WRITE_CONFIRMATION_REQUIRED', 'Validated write frames require explicit write confirmation');
    }

    const transmittedAt = Date.now();
    const started = process.hrtime.bigint();
    let response = null;
    let responseValidation = null;
    let failure = null;
    try {
      await this.broker.transmit(this.connectionId, { ownerId: this.ownerId, bytes: raw, intent });
      this._emit('traffic.tx', { rawHex: raw.toString('hex').toUpperCase(), intent, classification });

      const serialBroadcast = (this.framing === 'rtu' || this.framing === 'ascii') && classification.valid && classification.unitId === 0 && intent === 'write';
      if (expectResponse && !serialBroadcast) {
        const match = this.framing === 'tcp' && classification.transactionId != null
          ? (candidate) => Buffer.isBuffer(candidate) && candidate.length >= 7 && candidate.readUInt16BE(0) === classification.transactionId
          : null;
        response = await this.broker.receive(this.connectionId, { ownerId: this.ownerId, timeoutMs, signal, match });
        this._emit('traffic.rx', { rawHex: response.toString('hex').toUpperCase(), intent, classification });
      }

      if (response && responsePolicy !== 'any') {
        responseValidation = validateResponseSemantics({
          framing: this.framing,
          requestRaw: raw,
          responseRaw: response,
          policy: responsePolicy,
        });
      }

      if (expectedHex != null) {
        if (!response) throw new RawFrameStudioError('EXPECTED_RESPONSE_MISSING', 'Expected-response validation requested but no response was captured');
        const expected = parseHexText(expectedHex);
        const mask = expectedMaskHex == null ? null : parseHexText(expectedMaskHex);
        if (!maskMatches(response, expected, mask)) {
          throw new RawFrameStudioError('EXPECTED_RESPONSE_MISMATCH', 'Response bytes do not match the expected bytes/mask', {
            expectedHex: expected.toString('hex').toUpperCase(),
            maskHex: mask?.toString('hex').toUpperCase() || null,
            actualHex: response.toString('hex').toUpperCase(),
          });
        }
      }

      return Object.freeze({
        ok: true,
        intent,
        classification,
        requestRaw: Buffer.from(raw),
        responseRaw: response ? Buffer.from(response) : null,
        responseValidation,
        rttMs: response ? Number(process.hrtime.bigint() - started) / 1e6 : null,
      });
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      this._appendAudit({
        transmittedAt,
        intent,
        classification,
        requestRawHex: raw.toString('hex').toUpperCase(),
        responseRawHex: response?.toString('hex').toUpperCase() || null,
        responseValidation,
        result: failure ? 'failed' : 'success',
        error: failure ? { code: failure.code || null, message: String(failure.message || failure) } : null,
      });
    }
  }

  async repeat(options = {}) {
    const count = options.count ?? 1;
    const intervalMs = options.intervalMs ?? 0;
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new RawFrameStudioError('INVALID_REPEAT_COUNT', 'count must be 1..10000');
    if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new RawFrameStudioError('INVALID_REPEAT_INTERVAL', 'intervalMs must be >= 0');
    const results = [];
    for (let index = 0; index < count; index += 1) {
      if (options.signal?.aborted) throw new RawFrameStudioError('ABORTED', 'Repeat operation was aborted', { completed: index });
      results.push(await this.send(options));
      if (index + 1 < count) await sleep(intervalMs, options.signal || null);
    }
    return Object.freeze(results);
  }

  listAudit({ limit = this.maxAuditEntries } = {}) {
    const safe = Number.isInteger(limit) && limit > 0 ? Math.min(limit, this.maxAuditEntries) : this.maxAuditEntries;
    return Object.freeze(this.audit.slice(-safe));
  }

  _appendAudit(entry) {
    const record = Object.freeze({ auditId: `raw-${++this.sequence}`, ...entry });
    this.audit.push(record);
    if (this.audit.length > this.maxAuditEntries) this.audit.splice(0, this.audit.length - this.maxAuditEntries);
    this.emit('audit', record);
    return record;
  }

  _emit(type, details) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'raw-frame-studio',
      connectionId: this.connectionId,
      ownerMode: 'test',
      details,
    }));
  }
}

module.exports = {
  RawFrameStudio,
  RawFrameStudioError,
  WRITE_FUNCTIONS,
  NORMAL_READ_FUNCTIONS,
  parseHexText,
  maskMatches,
  decodeAdu,
  validateSuccessfulResponsePdu,
  validateResponseSemantics,
};
