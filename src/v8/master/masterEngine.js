'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');
const { AsyncSemaphore } = require('./asyncSemaphore');

const WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
  protocol.FC.MASK_WRITE_REGISTER,
  protocol.FC.READ_WRITE_MULTIPLE_REGISTERS,
]);

const SERIAL_BROADCAST_WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
]);

class MasterRequestError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MasterRequestError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, MasterRequestError);
  }
}

class MasterEngine extends EventEmitter {
  constructor({
    broker,
    connectionId,
    ownerId = 'v8-master',
    ownerMode = 'master',
    framing = 'rtu',
    timeoutMs = 1000,
    maxTcpConcurrency = 8,
  }) {
    super();
    if (!broker) throw new TypeError('broker is required');
    if (!connectionId) throw new TypeError('connectionId is required');
    if (!['master', 'test'].includes(ownerMode)) throw new TypeError('ownerMode must be master or test');
    if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new TypeError('framing must be rtu, ascii or tcp');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be > 0');
    if (!Number.isInteger(maxTcpConcurrency) || maxTcpConcurrency < 1 || maxTcpConcurrency > 256) throw new TypeError('maxTcpConcurrency must be 1..256');
    this.broker = broker;
    this.connectionId = connectionId;
    this.ownerId = ownerId;
    this.ownerMode = ownerMode;
    this.framing = framing;
    this.timeoutMs = timeoutMs;
    this.nextTransactionId = 1;
    this.serialQueue = Promise.resolve();
    this.tcpConcurrency = new AsyncSemaphore(maxTcpConcurrency);
  }

  async open() {
    const status = this.broker.getConnection(this.connectionId);
    if (status.owner && (status.owner.ownerMode !== this.ownerMode || status.owner.ownerId !== this.ownerId)) {
      throw new MasterRequestError('OWNER_MISMATCH', 'Connection is owned by a different runtime', { connectionId: this.connectionId });
    }
    if (status.state === 'open' && (status.transportState === 'open' || status.transportState === 'unknown')) return status;
    return this.broker.open(this.connectionId, { ownerMode: this.ownerMode, ownerId: this.ownerId });
  }

  async close({ release = true } = {}) {
    const status = this.broker.getConnection(this.connectionId);
    if (status.state === 'open' || status.state === 'error') await this.broker.close(this.connectionId, { ownerId: this.ownerId });
    const after = this.broker.getConnection(this.connectionId);
    if (release && after.owner?.ownerId === this.ownerId) this.broker.release(this.connectionId, { ownerId: this.ownerId });
  }

  setWriteEnabled(enabled) {
    return this.broker.setWriteLock(this.connectionId, { ownerId: this.ownerId, enabled: Boolean(enabled) });
  }

  request(options) {
    if (this.framing === 'tcp') {
      return this.tcpConcurrency.run(() => this._request(options), { signal: options?.signal || null });
    }
    const run = this.serialQueue.then(() => this._request(options));
    this.serialQueue = run.catch(() => undefined);
    return run;
  }

  status() {
    return Object.freeze({
      connectionId: this.connectionId,
      ownerId: this.ownerId,
      ownerMode: this.ownerMode,
      framing: this.framing,
      timeoutMs: this.timeoutMs,
      tcpConcurrency: this.tcpConcurrency.snapshot(),
      nextTransactionId: this.nextTransactionId,
    });
  }

  async _request({ unitId, pdu, timeoutMs = this.timeoutMs, signal = null }) {
    const normalizedPdu = protocol.validatePdu(pdu);
    protocol.validateUnitId(unitId);
    if ((this.framing === 'rtu' || this.framing === 'ascii') && unitId > 247) {
      throw new MasterRequestError('INVALID_SERIAL_UNIT_ID', 'Serial Modbus Unit/Slave ID must be 0..247', {
        unitId,
        framing: this.framing,
      });
    }

    const functionCode = normalizedPdu[0];
    const isWrite = WRITE_FUNCTIONS.has(functionCode);
    const isSerialBroadcast = (this.framing === 'rtu' || this.framing === 'ascii') && unitId === 0;
    if (isSerialBroadcast && !SERIAL_BROADCAST_WRITE_FUNCTIONS.has(functionCode)) {
      throw new MasterRequestError('INVALID_BROADCAST', 'Serial Unit 0 broadcast is only supported for FC05, FC06, FC15 and FC16 write requests', {
        functionCode,
      });
    }

    const txContext = this._encodeRequest(unitId, normalizedPdu);
    const started = process.hrtime.bigint();
    await this.broker.transmit(this.connectionId, {
      ownerId: this.ownerId,
      bytes: txContext.raw,
      intent: isWrite ? 'write' : 'read',
    });
    this._emit('traffic.tx', unitId, functionCode, txContext.raw, { framing: this.framing, transactionId: txContext.transactionId ?? null });

    if (isSerialBroadcast) {
      return Object.freeze({
        ok: true,
        broadcast: true,
        unitId,
        functionCode,
        requestRaw: Buffer.from(txContext.raw),
        responseRaw: null,
        responsePdu: null,
        decoded: null,
        rttMs: null,
      });
    }

    let responseRaw;
    try {
      const match = this.framing === 'tcp'
        ? (raw) => Buffer.isBuffer(raw) && raw.length >= 7 && raw.readUInt16BE(0) === txContext.transactionId && raw[6] === unitId
        : null;
      responseRaw = await this.broker.receive(this.connectionId, { ownerId: this.ownerId, timeoutMs, signal, match });
    } catch (error) {
      const isTimeout = error?.code === 'TIMEOUT';
      this._emit(isTimeout ? 'master.timeout' : 'master.receive-error', unitId, functionCode, txContext.raw, {
        errorCode: error?.code || null,
        error: error.message,
        transactionId: txContext.transactionId ?? null,
      });
      if (isTimeout) {
        throw new MasterRequestError('TIMEOUT', `No Modbus response within ${timeoutMs} ms`, {
          timeoutMs,
          unitId,
          functionCode,
          transactionId: txContext.transactionId ?? null,
          requestRaw: Buffer.from(txContext.raw),
        });
      }
      if (error && typeof error === 'object') {
        error.details = { ...(error.details || {}), requestRaw: Buffer.from(txContext.raw) };
      }
      throw error;
    }

    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    let response;
    let decoded;
    try {
      response = this._decodeResponse(responseRaw);
      this._verifyResponse({ requestUnitId: unitId, requestFunctionCode: functionCode, txContext, response });
      decoded = this._decodeResponsePdu(normalizedPdu, response.pdu);
    } catch (error) {
      const evidence = {
        requestRaw: Buffer.from(txContext.raw),
        responseRaw: Buffer.from(responseRaw),
        rttMs: elapsed,
        transactionId: txContext.transactionId ?? null,
      };
      if (error instanceof MasterRequestError) {
        error.details = { ...error.details, ...evidence };
        throw error;
      }
      throw new MasterRequestError('INVALID_RESPONSE', String(error?.message || error), {
        causeCode: error?.code || null,
        ...evidence,
      });
    }

    this._emit('traffic.rx', response.unitId, response.pdu[0], responseRaw, {
      framing: this.framing,
      transactionId: response.transactionId ?? null,
      rttMs: elapsed,
      exception: Boolean(response.pdu[0] & 0x80),
    });

    if (response.pdu[0] & 0x80) {
      const exception = protocol.decodeExceptionPdu(response.pdu);
      throw new MasterRequestError('MODBUS_EXCEPTION', `Modbus exception ${exception.exceptionCode}`, {
        ...exception,
        requestRaw: Buffer.from(txContext.raw),
        responseRaw: Buffer.from(responseRaw),
        rttMs: elapsed,
        transactionId: response.transactionId ?? null,
      });
    }

    return Object.freeze({
      ok: true,
      broadcast: false,
      unitId,
      functionCode,
      requestRaw: Buffer.from(txContext.raw),
      responseRaw: Buffer.from(responseRaw),
      responsePdu: Buffer.from(response.pdu),
      decoded,
      rttMs: elapsed,
      transactionId: response.transactionId ?? null,
    });
  }

  _encodeRequest(unitId, pdu) {
    if (this.framing === 'rtu') return { raw: protocol.encodeRtuAdu(unitId, pdu) };
    if (this.framing === 'ascii') return { raw: protocol.encodeAsciiAdu(unitId, pdu) };
    const transactionId = this.nextTransactionId;
    this.nextTransactionId = (this.nextTransactionId + 1) & 0xFFFF;
    return {
      transactionId,
      raw: protocol.encodeTcpAdu({ transactionId, unitId, pdu }),
    };
  }

  _decodeResponse(raw) {
    if (this.framing === 'rtu') return protocol.decodeRtuAdu(raw);
    if (this.framing === 'ascii') return protocol.decodeAsciiAdu(raw);
    return protocol.decodeTcpAdu(raw);
  }

  _verifyResponse({ requestUnitId, requestFunctionCode, txContext, response }) {
    if (response.unitId !== requestUnitId) {
      throw new MasterRequestError('UNIT_MISMATCH', 'Response Unit ID does not match request', {
        requestUnitId,
        responseUnitId: response.unitId,
      });
    }
    if (this.framing === 'tcp' && response.transactionId !== txContext.transactionId) {
      throw new MasterRequestError('TID_MISMATCH', 'Response Transaction ID does not match request', {
        requestTransactionId: txContext.transactionId,
        responseTransactionId: response.transactionId,
      });
    }
    const responseFunction = response.pdu[0] & 0x7F;
    if (responseFunction !== requestFunctionCode) {
      throw new MasterRequestError('FUNCTION_MISMATCH', 'Response function does not match request', {
        requestFunctionCode,
        responseFunctionCode: response.pdu[0],
      });
    }
  }

  _decodeResponsePdu(requestPdu, responsePdu) {
    const fc = requestPdu[0];
    if (responsePdu[0] & 0x80) return protocol.decodeExceptionPdu(responsePdu);
    switch (fc) {
      case protocol.FC.READ_COILS:
      case protocol.FC.READ_DISCRETE_INPUTS: {
        const request = protocol.decodeReadRequest(requestPdu);
        return protocol.decodeReadBitsResponse(responsePdu, { expectedQuantity: request.quantity });
      }
      case protocol.FC.READ_HOLDING_REGISTERS:
      case protocol.FC.READ_INPUT_REGISTERS: {
        const request = protocol.decodeReadRequest(requestPdu);
        return protocol.decodeReadRegistersResponse(responsePdu, { expectedQuantity: request.quantity });
      }
      case protocol.FC.WRITE_SINGLE_COIL:
      case protocol.FC.WRITE_SINGLE_REGISTER:
        return protocol.decodeWriteSingleRequest(responsePdu);
      case protocol.FC.WRITE_MULTIPLE_COILS:
      case protocol.FC.WRITE_MULTIPLE_REGISTERS:
        return protocol.decodeWriteMultipleResponse(responsePdu);
      case protocol.FC.MASK_WRITE_REGISTER:
        return protocol.decodeMaskWriteRegisterRequest(responsePdu);
      case protocol.FC.READ_WRITE_MULTIPLE_REGISTERS: {
        const request = protocol.decodeReadWriteMultipleRegistersRequest(requestPdu);
        return protocol.decodeReadRegistersResponse(responsePdu, { expectedQuantity: request.readQuantity });
      }
      case protocol.FC.ENCAPSULATED_INTERFACE:
        return protocol.decodeDeviceIdResponse(responsePdu);
      default:
        return { functionCode: responsePdu[0], data: Buffer.from(responsePdu.subarray(1)), pdu: Buffer.from(responsePdu) };
    }
  }

  _emit(type, unitId, functionCode, raw, details) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: this.ownerMode === 'test' ? 'test-center' : 'master-engine',
      connectionId: this.connectionId,
      ownerMode: this.ownerMode,
      direction: type === 'traffic.tx' ? 'tx' : type === 'traffic.rx' ? 'rx' : null,
      unitId,
      functionCode,
      raw,
      details,
    }));
  }
}

module.exports = {
  WRITE_FUNCTIONS,
  SERIAL_BROADCAST_WRITE_FUNCTIONS,
  MasterEngine,
  MasterRequestError,
};
