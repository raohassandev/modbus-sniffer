'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');

const WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
  protocol.FC.READ_WRITE_MULTIPLE_REGISTERS,
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
  constructor({ broker, connectionId, ownerId = 'v8-master', framing = 'rtu', timeoutMs = 1000 }) {
    super();
    if (!broker) throw new TypeError('broker is required');
    if (!connectionId) throw new TypeError('connectionId is required');
    if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new TypeError('framing must be rtu, ascii or tcp');
    this.broker = broker;
    this.connectionId = connectionId;
    this.ownerId = ownerId;
    this.framing = framing;
    this.timeoutMs = timeoutMs;
    this.nextTransactionId = 1;
    this.serialQueue = Promise.resolve();
  }

  async open() {
    const status = this.broker.getConnection(this.connectionId);
    if (status.state === 'open') {
      if (status.owner?.ownerMode !== 'master' || status.owner?.ownerId !== this.ownerId) {
        throw new MasterRequestError('OWNER_MISMATCH', 'Connection is open under a different owner', { connectionId: this.connectionId });
      }
      return status;
    }
    return this.broker.open(this.connectionId, { ownerMode: 'master', ownerId: this.ownerId });
  }

  async close({ release = true } = {}) {
    const status = this.broker.getConnection(this.connectionId);
    if (status.state === 'open') await this.broker.close(this.connectionId, { ownerId: this.ownerId });
    const after = this.broker.getConnection(this.connectionId);
    if (release && after.owner?.ownerId === this.ownerId) this.broker.release(this.connectionId, { ownerId: this.ownerId });
  }

  setWriteEnabled(enabled) {
    return this.broker.setWriteLock(this.connectionId, { ownerId: this.ownerId, enabled: Boolean(enabled) });
  }

  request(options) {
    if (this.framing === 'tcp') return this._request(options);
    const run = this.serialQueue.then(() => this._request(options));
    this.serialQueue = run.catch(() => undefined);
    return run;
  }

  async _request({ unitId, pdu, timeoutMs = this.timeoutMs, signal = null }) {
    const normalizedPdu = protocol.validatePdu(pdu);
    protocol.validateUnitId(unitId);
    const functionCode = normalizedPdu[0];
    const isWrite = WRITE_FUNCTIONS.has(functionCode);
    const isSerialBroadcast = (this.framing === 'rtu' || this.framing === 'ascii') && unitId === 0;
    if (isSerialBroadcast && !isWrite) {
      throw new MasterRequestError('INVALID_BROADCAST', 'Serial Unit 0 broadcast is only valid for supported write requests', { functionCode });
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
      responseRaw = await this.broker.receive(this.connectionId, { ownerId: this.ownerId, timeoutMs, signal });
    } catch (error) {
      this._emit('master.timeout', unitId, functionCode, txContext.raw, { errorCode: error?.code || null, error: error.message });
      if (error?.code === 'TIMEOUT') throw new MasterRequestError('TIMEOUT', `No Modbus response within ${timeoutMs} ms`, { timeoutMs, unitId, functionCode });
      throw error;
    }

    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    const response = this._decodeResponse(responseRaw);
    this._verifyResponse({ requestUnitId: unitId, requestFunctionCode: functionCode, txContext, response });
    const decoded = this._decodeResponsePdu(normalizedPdu, response.pdu);
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
        responseRaw: Buffer.from(responseRaw),
        rttMs: elapsed,
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
      source: 'master-engine',
      connectionId: this.connectionId,
      ownerMode: 'master',
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
  MasterEngine,
  MasterRequestError,
};
