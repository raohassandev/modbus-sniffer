'use strict';

class FaultLabError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FaultLabError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, FaultLabError);
  }
}

function boundedInt(value, field, { min = 0, max = 65535, fallback = 0 } = {}) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new FaultLabError('INVALID_FAULT_POLICY', `${field} must be an integer between ${min} and ${max}`, { field, value });
  }
  return number;
}

function normalizePolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FaultLabError('INVALID_FAULT_POLICY', 'Fault policy must be an object');
  const policy = {
    responseDelayMs: boundedInt(input.responseDelayMs, 'responseDelayMs', { max: 60_000 }),
    jitterMs: boundedInt(input.jitterMs, 'jitterMs', { max: 60_000 }),
    dropEveryN: boundedInt(input.dropEveryN, 'dropEveryN', { max: 1_000_000 }),
    forceExceptionCode: boundedInt(input.forceExceptionCode, 'forceExceptionCode', { min: 0, max: 255 }),
    forceExceptionEveryN: boundedInt(input.forceExceptionEveryN, 'forceExceptionEveryN', { max: 1_000_000 }),
    wrongUnitId: input.wrongUnitId == null || input.wrongUnitId === '' ? null : boundedInt(input.wrongUnitId, 'wrongUnitId', { max: 255 }),
    wrongFunctionCode: input.wrongFunctionCode == null || input.wrongFunctionCode === '' ? null : boundedInt(input.wrongFunctionCode, 'wrongFunctionCode', { min: 1, max: 255 }),
    corruptChecksumEveryN: boundedInt(input.corruptChecksumEveryN, 'corruptChecksumEveryN', { max: 1_000_000 }),
    truncateBytes: boundedInt(input.truncateBytes, 'truncateBytes', { max: 250 }),
    duplicateEveryN: boundedInt(input.duplicateEveryN, 'duplicateEveryN', { max: 1_000_000 }),
  };
  if (policy.forceExceptionEveryN > 0 && policy.forceExceptionCode === 0) {
    throw new FaultLabError('INVALID_FAULT_POLICY', 'forceExceptionCode is required when forceExceptionEveryN is enabled');
  }
  return Object.freeze(policy);
}

class FaultInjectionLab {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.enabled = false;
    this.policy = normalizePolicy({});
    this.sequence = 0;
    this.armedAt = null;
  }

  arm(policy, { confirmed = false } = {}) {
    if (!confirmed) throw new FaultLabError('LAB_CONFIRMATION_REQUIRED', 'Fault injection requires explicit LAB confirmation');
    this.policy = normalizePolicy(policy);
    this.enabled = true;
    this.sequence = 0;
    this.armedAt = Date.now();
    return this.snapshot();
  }

  disarm() {
    this.enabled = false;
    this.policy = normalizePolicy({});
    this.sequence = 0;
    this.armedAt = null;
    return this.snapshot();
  }

  decide() {
    if (!this.enabled) return Object.freeze({ enabled: false, sequence: null, delayMs: 0, drop: false, duplicate: false, forceExceptionCode: null, wrongUnitId: null, wrongFunctionCode: null, corruptChecksum: false, truncateBytes: 0 });
    const sequence = ++this.sequence;
    const policy = this.policy;
    const jitter = policy.jitterMs ? Math.floor(this.random() * (policy.jitterMs + 1)) : 0;
    return Object.freeze({
      enabled: true,
      sequence,
      delayMs: policy.responseDelayMs + jitter,
      drop: policy.dropEveryN > 0 && sequence % policy.dropEveryN === 0,
      duplicate: policy.duplicateEveryN > 0 && sequence % policy.duplicateEveryN === 0,
      forceExceptionCode: policy.forceExceptionEveryN > 0 && sequence % policy.forceExceptionEveryN === 0 ? policy.forceExceptionCode : null,
      wrongUnitId: policy.wrongUnitId,
      wrongFunctionCode: policy.wrongFunctionCode,
      corruptChecksum: policy.corruptChecksumEveryN > 0 && sequence % policy.corruptChecksumEveryN === 0,
      truncateBytes: policy.truncateBytes,
    });
  }

  snapshot() {
    return Object.freeze({
      enabled: this.enabled,
      armedAt: this.armedAt,
      sequence: this.sequence,
      policy: this.policy,
    });
  }
}

function corruptChecksum(raw, framing) {
  const bytes = Buffer.from(raw);
  if (framing === 'rtu') {
    if (bytes.length >= 2) bytes[bytes.length - 1] ^= 0xFF;
    return bytes;
  }
  if (framing === 'ascii') {
    // ASCII ADU ends with two LRC hex characters followed by CRLF.
    if (bytes.length >= 5) bytes[bytes.length - 4] = bytes[bytes.length - 4] === 0x30 ? 0x31 : 0x30;
    return bytes;
  }
  // Modbus TCP has no checksum; corrupt one PDU byte instead so the LAB fault is still explicit.
  if (bytes.length >= 8) bytes[7] ^= 0x01;
  return bytes;
}

module.exports = {
  FaultInjectionLab,
  FaultLabError,
  normalizePolicy,
  corruptChecksum,
};
