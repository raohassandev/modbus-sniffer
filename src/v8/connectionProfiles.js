'use strict';

const { assertIpAddress } = require('./transports/networkAddresses');

const TRANSPORT_KINDS = Object.freeze([
  'serial-rtu',
  'serial-ascii',
  'tcp-client',
  'tcp-server',
  'virtual-rtu',
  'virtual-ascii',
  'virtual-tcp',
]);

const RUNTIME_ONLY_FIELDS = Object.freeze(new Set([
  'owner',
  'ownerId',
  'ownerMode',
  'state',
  'transportState',
  'writeLock',
  'writeEnabled',
  'faultInjectionEnabled',
  'openedAt',
  'connectedAt',
  'lastError',
  'runtimeMetrics',
]));

class ConnectionProfileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectionProfileError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ConnectionProfileError);
  }
}

function finiteInteger(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', `${field} must be an integer in ${min}..${max}`, { field, value });
  }
  return value;
}

function safeString(value, field, maxLength = 255, { allowEmpty = false } = {}) {
  if (value == null) value = '';
  const normalized = String(value).trim();
  if (!allowEmpty && !normalized) {
    throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', `${field} is required`, { field });
  }
  if (normalized.length > maxLength) {
    throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', `${field} exceeds ${maxLength} characters`, { field, maxLength });
  }
  return normalized;
}

function normalizeReconnect(input = {}) {
  if (input == null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'reconnect must be an object');
  const enabled = Boolean(input.enabled);
  const maxAttempts = input.maxAttempts == null ? 5 : finiteInteger(input.maxAttempts, 'reconnect.maxAttempts', 0, 1000);
  const initialDelayMs = input.initialDelayMs == null ? 100 : finiteInteger(input.initialDelayMs, 'reconnect.initialDelayMs', 0, 600000);
  const maxDelayMs = input.maxDelayMs == null ? 2000 : finiteInteger(input.maxDelayMs, 'reconnect.maxDelayMs', initialDelayMs, 3600000);
  return Object.freeze({ enabled, maxAttempts, initialDelayMs, maxDelayMs });
}

function normalizeSerialSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'serial settings must be an object');
  const path = safeString(input.path, 'serial.path', 512);
  const baudRate = input.baudRate == null ? 9600 : finiteInteger(input.baudRate, 'serial.baudRate', 50, 12000000);
  const dataBits = input.dataBits == null ? 8 : finiteInteger(input.dataBits, 'serial.dataBits', 5, 8);
  const stopBits = input.stopBits == null ? 1 : Number(input.stopBits);
  if (![1, 1.5, 2].includes(stopBits)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'serial.stopBits must be 1, 1.5 or 2');
  const parity = String(input.parity ?? 'none').toLowerCase();
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'serial.parity is unsupported', { parity });
  const rtsTxMode = String(input.rtsTxMode ?? 'none');
  if (!['none', 'high-during-tx', 'low-during-tx'].includes(rtsTxMode)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'serial.rtsTxMode is unsupported', { rtsTxMode });
  return Object.freeze({
    path,
    baudRate,
    dataBits,
    stopBits,
    parity,
    rtscts: Boolean(input.rtscts),
    xon: Boolean(input.xon),
    xoff: Boolean(input.xoff),
    xany: Boolean(input.xany),
    rtsTxMode,
    rtsSettleMs: input.rtsSettleMs == null ? 0 : finiteInteger(input.rtsSettleMs, 'serial.rtsSettleMs', 0, 60000),
    echoSuppression: Boolean(input.echoSuppression),
  });
}

function normalizeTcpClientSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'TCP client settings must be an object');
  const host = safeString(input.host, 'tcp.host', 255);
  const port = input.port == null ? 502 : finiteInteger(input.port, 'tcp.port', 1, 65535);
  let localAddress = null;
  if (input.localAddress != null && String(input.localAddress).trim()) localAddress = assertIpAddress(String(input.localAddress).trim(), 'tcp.localAddress');
  const family = input.family == null ? 0 : finiteInteger(input.family, 'tcp.family', 0, 6);
  if (![0, 4, 6].includes(family)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'tcp.family must be 0, 4 or 6');
  return Object.freeze({
    host,
    port,
    localAddress,
    family,
    connectTimeoutMs: input.connectTimeoutMs == null ? 3000 : finiteInteger(input.connectTimeoutMs, 'tcp.connectTimeoutMs', 1, 3600000),
    idleTimeoutMs: input.idleTimeoutMs == null ? 0 : finiteInteger(input.idleTimeoutMs, 'tcp.idleTimeoutMs', 0, 3600000),
    writeTimeoutMs: input.writeTimeoutMs == null ? 3000 : finiteInteger(input.writeTimeoutMs, 'tcp.writeTimeoutMs', 1, 3600000),
    reconnect: normalizeReconnect(input.reconnect),
  });
}

function normalizeTcpServerSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'TCP server settings must be an object');
  const host = input.host == null ? '127.0.0.1' : assertIpAddress(String(input.host).trim(), 'tcp.host');
  const port = input.port == null ? 502 : finiteInteger(input.port, 'tcp.port', 0, 65535);
  return Object.freeze({
    host,
    port,
    maxClients: input.maxClients == null ? 64 : finiteInteger(input.maxClients, 'tcp.maxClients', 1, 10000),
    idleTimeoutMs: input.idleTimeoutMs == null ? 0 : finiteInteger(input.idleTimeoutMs, 'tcp.idleTimeoutMs', 0, 3600000),
    writeTimeoutMs: input.writeTimeoutMs == null ? 3000 : finiteInteger(input.writeTimeoutMs, 'tcp.writeTimeoutMs', 1, 3600000),
  });
}

function normalizeConnectionProfile(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', 'Connection profile must be an object');
  const profileId = safeString(input.profileId ?? input.id, 'profileId', 180);
  const name = safeString(input.name ?? profileId, 'name', 120);
  const transportKind = String(input.transportKind ?? '').trim().toLowerCase();
  if (!TRANSPORT_KINDS.includes(transportKind)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILE', `Unsupported transportKind: ${transportKind}`, { transportKind });

  let settings;
  if (transportKind === 'serial-rtu' || transportKind === 'serial-ascii') settings = normalizeSerialSettings(input.settings ?? input.serial ?? {});
  else if (transportKind === 'tcp-client') settings = normalizeTcpClientSettings(input.settings ?? input.tcp ?? {});
  else if (transportKind === 'tcp-server') settings = normalizeTcpServerSettings(input.settings ?? input.tcp ?? {});
  else settings = Object.freeze({ name: safeString(input.settings?.name ?? input.virtualName ?? profileId, 'virtual.name', 180) });

  return Object.freeze({
    profileId,
    name,
    description: safeString(input.description ?? '', 'description', 2000, { allowEmpty: true }),
    transportKind,
    enabled: input.enabled !== false,
    settings,
    metadata: Object.freeze(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {}),
  });
}

function sanitizePersistentProfile(input) {
  const copy = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (RUNTIME_ONLY_FIELDS.has(key)) continue;
    copy[key] = value;
  }
  return normalizeConnectionProfile(copy);
}

function assertUniqueConnectionProfiles(profiles = []) {
  if (!Array.isArray(profiles)) throw new ConnectionProfileError('INVALID_CONNECTION_PROFILES', 'Connection profiles must be an array');
  const seen = new Set();
  const normalized = profiles.map((profile) => {
    const value = sanitizePersistentProfile(profile);
    if (seen.has(value.profileId)) throw new ConnectionProfileError('DUPLICATE_CONNECTION_PROFILE', `Duplicate connection profile ${value.profileId}`, { profileId: value.profileId });
    seen.add(value.profileId);
    return value;
  });
  return Object.freeze(normalized);
}

module.exports = {
  TRANSPORT_KINDS,
  RUNTIME_ONLY_FIELDS,
  ConnectionProfileError,
  normalizeReconnect,
  normalizeSerialSettings,
  normalizeTcpClientSettings,
  normalizeTcpServerSettings,
  normalizeConnectionProfile,
  sanitizePersistentProfile,
  assertUniqueConnectionProfiles,
};
