'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');

class WriteSafetyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WriteSafetyError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, WriteSafetyError);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

class WriteAuditTrail {
  constructor({ maxEntries = 10000 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError('maxEntries must be a positive integer');
    this.maxEntries = maxEntries;
    this.entries = [];
    this.sequence = 0;
  }

  append(entry) {
    const record = deepFreeze({
      auditId: `write-${++this.sequence}`,
      timestamp: Date.now(),
      ...entry,
    });
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return record;
  }

  list({ limit = this.maxEntries } = {}) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, this.maxEntries) : this.maxEntries;
    return Object.freeze(this.entries.slice(-safeLimit));
  }

  clear() {
    // Audit records are append-only during a process lifetime. Explicit persistence/rotation owns deletion later.
    throw new WriteSafetyError('AUDIT_APPEND_ONLY', 'Write audit trail cannot be cleared through the runtime API');
  }
}

function describeWritePdu(pdu) {
  const raw = protocol.validatePdu(pdu);
  switch (raw[0]) {
    case protocol.FC.WRITE_SINGLE_COIL: {
      const decoded = protocol.decodeWriteSingleRequest(raw);
      return { functionCode: raw[0], area: 'coils', address: decoded.address, quantity: 1, values: [decoded.value], bulk: false };
    }
    case protocol.FC.WRITE_SINGLE_REGISTER: {
      const decoded = protocol.decodeWriteSingleRequest(raw);
      return { functionCode: raw[0], area: 'holdingRegisters', address: decoded.address, quantity: 1, values: [decoded.value], bulk: false };
    }
    case protocol.FC.WRITE_MULTIPLE_COILS: {
      const decoded = protocol.decodeWriteMultipleRequest(raw);
      return { functionCode: raw[0], area: 'coils', address: decoded.address, quantity: decoded.quantity, values: [...decoded.values], bulk: true };
    }
    case protocol.FC.WRITE_MULTIPLE_REGISTERS: {
      const decoded = protocol.decodeWriteMultipleRequest(raw);
      return { functionCode: raw[0], area: 'holdingRegisters', address: decoded.address, quantity: decoded.quantity, values: [...decoded.values], bulk: true };
    }
    case protocol.FC.WRITE_FILE_RECORD: {
      const decoded = protocol.decodeWriteFileRecordRequest(raw);
      const records = decoded.records.map((record) => ({
        referenceType: record.referenceType,
        fileNumber: record.fileNumber,
        recordNumber: record.recordNumber,
        values: [...record.values],
      }));
      return {
        functionCode: raw[0],
        area: 'fileRecords',
        address: null,
        quantity: records.reduce((sum, record) => sum + record.values.length, 0),
        values: records.flatMap((record) => record.values),
        bulk: true,
        fileRecords: records,
      };
    }
    case protocol.FC.MASK_WRITE_REGISTER: {
      const decoded = protocol.decodeMaskWriteRegisterRequest(raw);
      return {
        functionCode: raw[0],
        area: 'holdingRegisters',
        address: decoded.address,
        quantity: 1,
        values: null,
        bulk: false,
        maskWrite: true,
        andMask: decoded.andMask,
        orMask: decoded.orMask,
      };
    }
    case protocol.FC.READ_WRITE_MULTIPLE_REGISTERS: {
      const decoded = protocol.decodeReadWriteMultipleRegistersRequest(raw);
      return {
        functionCode: raw[0],
        area: 'holdingRegisters',
        address: decoded.writeAddress,
        quantity: decoded.writeQuantity,
        values: [...decoded.values],
        bulk: true,
        readAddress: decoded.readAddress,
        readQuantity: decoded.readQuantity,
      };
    }
    default:
      throw new WriteSafetyError('NOT_A_WRITE', `Function ${raw[0]} is not supported by the safe write service`, { functionCode: raw[0] });
  }
}

function readPduForDescriptor(descriptor) {
  if (descriptor.area === 'fileRecords') {
    return protocol.encodeReadFileRecordRequest({
      records: descriptor.fileRecords.map((record) => ({
        referenceType: record.referenceType,
        fileNumber: record.fileNumber,
        recordNumber: record.recordNumber,
        recordLength: record.values.length,
      })),
    });
  }
  return protocol.encodeReadRequest({
    functionCode: descriptor.area === 'coils' ? protocol.FC.READ_COILS : protocol.FC.READ_HOLDING_REGISTERS,
    address: descriptor.address,
    quantity: descriptor.quantity,
  });
}

function maskWriteResult(current, andMask, orMask) {
  return ((current & andMask) | (orMask & (~andMask & 0xFFFF))) & 0xFFFF;
}

function expectedWriteValues(descriptor, oldValues) {
  if (!descriptor.maskWrite) return [...descriptor.values];
  if (!Array.isArray(oldValues) || oldValues.length !== 1) return null;
  return [maskWriteResult(Number(oldValues[0]), descriptor.andMask, descriptor.orMask)];
}

function decodedValues(descriptor, decoded) {
  if (descriptor.area === 'fileRecords') {
    return Array.isArray(decoded?.records) ? decoded.records.flatMap((record) => Array.isArray(record.values) ? record.values : []) : [];
  }
  return [...(decoded?.values || [])];
}

function valuesEqual(expected, actual) {
  return expected.length === actual.length && expected.every((value, index) => Boolean(value) === Boolean(actual[index]) && (typeof value === 'boolean' || Number(value) === Number(actual[index])));
}

class WriteSafetyController extends EventEmitter {
  constructor({ master, auditTrail = new WriteAuditTrail(), userId = 'local-user', sessionId = null, defaultAutoLockMs = 0 } = {}) {
    super();
    if (!master || typeof master.request !== 'function' || typeof master.setWriteEnabled !== 'function') throw new TypeError('master with request() and setWriteEnabled() is required');
    if (!Number.isFinite(defaultAutoLockMs) || defaultAutoLockMs < 0) throw new TypeError('defaultAutoLockMs must be >= 0');
    this.master = master;
    this.auditTrail = auditTrail;
    this.userId = String(userId || 'local-user');
    this.sessionId = sessionId == null ? null : String(sessionId);
    this.defaultAutoLockMs = defaultAutoLockMs;
    this.lockTimer = null;
    this.unlockedUntil = null;
  }

  unlock({ durationMs = this.defaultAutoLockMs, confirmation = null } = {}) {
    if (!confirmation?.confirmed) throw new WriteSafetyError('CONFIRMATION_REQUIRED', 'Explicit confirmation is required before enabling writes');
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new WriteSafetyError('INVALID_AUTO_LOCK', 'durationMs must be >= 0');
    const status = this.master.setWriteEnabled(true);
    this._clearTimer();
    this.unlockedUntil = durationMs > 0 ? Date.now() + durationMs : null;
    if (durationMs > 0) {
      this.lockTimer = setTimeout(() => {
        this.lockTimer = null;
        try { this.lock({ reason: 'auto-lock' }); } catch (error) { this.emit('safety-error', error); }
      }, durationMs);
      this.lockTimer.unref?.();
    }
    this._emit('write.unlocked', { durationMs, unlockedUntil: this.unlockedUntil });
    return status;
  }

  lock({ reason = 'manual' } = {}) {
    this._clearTimer();
    this.unlockedUntil = null;
    const status = this.master.setWriteEnabled(false);
    this._emit('write.locked', { reason });
    return status;
  }

  status() {
    const connection = this.master.broker?.getConnection?.(this.master.connectionId) || null;
    return Object.freeze({
      writeLock: connection?.writeLock || 'UNKNOWN',
      unlockedUntil: this.unlockedUntil,
      autoLockActive: Boolean(this.lockTimer),
      userId: this.userId,
      sessionId: this.sessionId,
    });
  }

  async execute({ unitId, pdu, confirmation = null, captureOldValue = true, readBack = false, context = {} } = {}) {
    const descriptor = describeWritePdu(pdu);
    this._validateConfirmation({ unitId, descriptor, confirmation });
    const startedAt = Date.now();
    let oldValues = null;
    let expectedValues = descriptor.values ? [...descriptor.values] : null;
    let writeResult = null;
    let verification = null;
    let failure = null;

    try {
      const needsOldValue = unitId !== 0 && (captureOldValue || (descriptor.maskWrite && readBack));
      if (needsOldValue) {
        const oldResult = await this.master.request({ unitId, pdu: readPduForDescriptor(descriptor) });
        oldValues = decodedValues(descriptor, oldResult.decoded);
        expectedValues = expectedWriteValues(descriptor, oldValues);
      }

      writeResult = await this.master.request({ unitId, pdu });

      if (readBack && unitId !== 0) {
        if (!expectedValues) {
          throw new WriteSafetyError('READBACK_EXPECTATION_UNAVAILABLE', 'Read-back verification requires the pre-write value for this write operation');
        }
        const verifyResult = await this.master.request({ unitId, pdu: readPduForDescriptor(descriptor) });
        const actualValues = decodedValues(descriptor, verifyResult.decoded);
        verification = {
          requested: true,
          matched: valuesEqual(expectedValues, actualValues),
          expectedValues: [...expectedValues],
          actualValues,
          responseRawHex: verifyResult.responseRaw?.toString('hex').toUpperCase() || null,
        };
        if (!verification.matched) {
          throw new WriteSafetyError('READBACK_MISMATCH', 'Read-back verification does not match the requested write', {
            expectedValues,
            actualValues,
          });
        }
      }

      return writeResult;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      const record = this.auditTrail.append({
        userId: this.userId,
        sessionId: this.sessionId,
        connectionId: this.master.connectionId || null,
        unitId,
        broadcast: unitId === 0,
        functionCode: descriptor.functionCode,
        area: descriptor.area,
        address: descriptor.address,
        quantity: descriptor.quantity,
        requestedValues: expectedValues ? [...expectedValues] : null,
        maskWrite: descriptor.maskWrite ? { andMask: descriptor.andMask, orMask: descriptor.orMask } : null,
        oldValues,
        pduHex: Buffer.from(pdu).toString('hex').toUpperCase(),
        requestRawHex: writeResult?.requestRaw?.toString('hex').toUpperCase()
          || failure?.details?.requestRaw?.toString?.('hex')?.toUpperCase?.()
          || null,
        responseRawHex: writeResult?.responseRaw?.toString('hex').toUpperCase()
          || failure?.details?.responseRaw?.toString?.('hex')?.toUpperCase?.()
          || null,
        verification,
        result: failure ? 'failed' : 'success',
        error: failure ? { code: failure.code || null, message: String(failure.message || failure) } : null,
        elapsedMs: Date.now() - startedAt,
        context: context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {},
      });
      this.emit('audit', record);
      this._emit('write.audit', { auditId: record.auditId, result: record.result, unitId, functionCode: descriptor.functionCode });
    }
  }

  _validateConfirmation({ unitId, descriptor, confirmation }) {
    if (!confirmation?.confirmed) throw new WriteSafetyError('CONFIRMATION_REQUIRED', 'Explicit write confirmation is required');
    if (descriptor.bulk && confirmation.bulk !== true) {
      throw new WriteSafetyError('BULK_CONFIRMATION_REQUIRED', 'Bulk Modbus writes require explicit bulk-write confirmation', { functionCode: descriptor.functionCode });
    }
    if (unitId === 0 && confirmation.broadcast !== true) {
      throw new WriteSafetyError('BROADCAST_CONFIRMATION_REQUIRED', 'Broadcast writes require explicit broadcast confirmation');
    }
  }

  _clearTimer() {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
  }

  _emit(type, details) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'write-safety',
      connectionId: this.master.connectionId || null,
      ownerMode: 'master',
      details,
    }));
  }
}

module.exports = {
  WriteAuditTrail,
  WriteSafetyController,
  WriteSafetyError,
  describeWritePdu,
  readPduForDescriptor,
  maskWriteResult,
  expectedWriteValues,
  decodedValues,
};
