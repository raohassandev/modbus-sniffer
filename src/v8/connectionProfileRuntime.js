'use strict';

const crypto = require('node:crypto');
const { SerialTransport } = require('./transports/serialTransport');
const { TcpClientTransport } = require('./transports/tcpClientTransport');
const { TcpServerTransport } = require('./transports/tcpServerTransport');
const { createVirtualLoopbackPair } = require('./transports/virtualLoopback');

class ConnectionProfileRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectionProfileRuntimeError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ConnectionProfileRuntimeError);
  }
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER, field = 'value' } = {}) {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', `${field} must be an integer in ${min}..${max}`, { field, value });
  }
  return n;
}

function num(value, fallback, { min = 0, max = Number.MAX_VALUE, field = 'value' } = {}) {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', `${field} must be in ${min}..${max}`, { field, value });
  }
  return n;
}

function transportKind(profile = {}) {
  const direct = text(profile.transportKind).toLowerCase();
  if (direct) return direct;
  const transport = text(profile.transport).toLowerCase();
  if (transport === 'rtu') return 'serial-rtu';
  if (transport === 'ascii') return 'serial-ascii';
  if (transport === 'tcp') return 'tcp-client';
  return transport;
}

function serialOptions(profile, kind) {
  const source = profile.serial && typeof profile.serial === 'object' ? profile.serial : {};
  const path = text(source.path || source.port || profile.endpoint);
  if (!path) throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', 'Serial profile requires a port/path', { connectionId: profile.connectionId });
  const parity = text(source.parity || 'none').toLowerCase();
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', `Unsupported parity ${parity}`);
  const stopBits = Number(source.stopBits ?? 1);
  if (![1, 1.5, 2].includes(stopBits)) throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', 'stopBits must be 1, 1.5 or 2');
  const rtsTxMode = text(source.rtsTxMode || 'none');
  if (!['none', 'high-during-tx', 'low-during-tx'].includes(rtsTxMode)) throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', `Unsupported RTS TX mode ${rtsTxMode}`);
  return {
    path,
    baudRate: int(source.baudRate, 9600, { min: 50, max: 12000000, field: 'baudRate' }),
    dataBits: int(source.dataBits, 8, { min: 5, max: 8, field: 'dataBits' }),
    stopBits,
    parity,
    framing: kind === 'serial-ascii' ? 'ascii' : 'rtu',
    rtscts: Boolean(source.rtscts),
    xon: Boolean(source.xon),
    xoff: Boolean(source.xoff),
    xany: Boolean(source.xany),
    rtsTxMode,
    rtsSettleMs: num(source.rtsSettleMs, 0, { min: 0, max: 60000, field: 'rtsSettleMs' }),
    echoSuppression: Boolean(source.echoSuppression),
    writeTimeoutMs: num(source.writeTimeoutMs, 3000, { min: 1, max: 3600000, field: 'writeTimeoutMs' }),
  };
}

function parseEndpoint(endpoint, fallbackPort) {
  const raw = text(endpoint);
  if (!raw) return { host: '', port: fallbackPort };
  if (raw.startsWith('[')) {
    const match = raw.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (match) return { host: match[1], port: match[2] ? Number(match[2]) : fallbackPort };
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && /^\d+$/.test(raw.slice(colon + 1))) return { host: raw.slice(0, colon), port: Number(raw.slice(colon + 1)) };
  return { host: raw, port: fallbackPort };
}

function tcpClientOptions(profile) {
  const source = profile.tcp && typeof profile.tcp === 'object' ? profile.tcp : {};
  const endpoint = parseEndpoint(profile.endpoint, 502);
  const host = text(source.host || source.targetHost || endpoint.host);
  if (!host) throw new ConnectionProfileRuntimeError('INVALID_PROFILE_CONFIG', 'TCP client profile requires a host', { connectionId: profile.connectionId });
  const reconnectSource = source.reconnect && typeof source.reconnect === 'object' ? source.reconnect : {};
  return {
    host,
    port: int(source.port ?? source.targetPort ?? endpoint.port, 502, { min: 1, max: 65535, field: 'port' }),
    localAddress: text(source.localAddress) || null,
    family: int(source.family, 0, { min: 0, max: 6, field: 'family' }),
    connectTimeoutMs: num(source.connectTimeoutMs, 3000, { min: 1, max: 3600000, field: 'connectTimeoutMs' }),
    idleTimeoutMs: num(source.idleTimeoutMs, 0, { min: 0, max: 3600000, field: 'idleTimeoutMs' }),
    writeTimeoutMs: num(source.writeTimeoutMs, 3000, { min: 1, max: 3600000, field: 'writeTimeoutMs' }),
    reconnect: {
      enabled: Boolean(reconnectSource.enabled),
      maxAttempts: int(reconnectSource.maxAttempts, 5, { min: 0, max: 1000, field: 'reconnect.maxAttempts' }),
      initialDelayMs: num(reconnectSource.initialDelayMs, 100, { min: 0, max: 600000, field: 'reconnect.initialDelayMs' }),
      maxDelayMs: num(reconnectSource.maxDelayMs, 2000, { min: 0, max: 3600000, field: 'reconnect.maxDelayMs' }),
    },
  };
}

function tcpServerOptions(profile) {
  const source = profile.tcp && typeof profile.tcp === 'object' ? profile.tcp : {};
  const endpoint = parseEndpoint(profile.endpoint, 502);
  const host = text(source.host || source.listenHost || endpoint.host || '127.0.0.1');
  return {
    host,
    port: int(source.port ?? source.listenPort ?? endpoint.port, 502, { min: 0, max: 65535, field: 'port' }),
    maxClients: int(source.maxClients, 64, { min: 1, max: 10000, field: 'maxClients' }),
    idleTimeoutMs: num(source.idleTimeoutMs, 0, { min: 0, max: 3600000, field: 'idleTimeoutMs' }),
    writeTimeoutMs: num(source.writeTimeoutMs, 3000, { min: 1, max: 3600000, field: 'writeTimeoutMs' }),
  };
}

function profileFingerprint(profile) {
  return crypto.createHash('sha256').update(JSON.stringify(profile || {})).digest('hex');
}

function describeProfileRuntime(profile) {
  const kind = transportKind(profile);
  if (['serial-rtu', 'serial-ascii'].includes(kind)) {
    const options = serialOptions(profile, kind);
    return Object.freeze({ kind, resourceKey: `serial:${options.path}`, exclusive: true, options: Object.freeze({ ...options }) });
  }
  if (kind === 'tcp-client') {
    const options = tcpClientOptions(profile);
    const local = options.localAddress || 'auto';
    return Object.freeze({ kind, resourceKey: `tcp-client:${local}:${options.host}:${options.port}`, exclusive: false, options: Object.freeze({ ...options, reconnect: Object.freeze({ ...options.reconnect }) }) });
  }
  if (kind === 'tcp-server') {
    const options = tcpServerOptions(profile);
    return Object.freeze({ kind, resourceKey: `tcp-listen:${options.host}:${options.port}`, exclusive: true, options: Object.freeze({ ...options }) });
  }
  if (kind === 'virtual' || kind.startsWith('virtual-')) {
    const name = text(profile.name || profile.connectionId || 'virtual');
    return Object.freeze({ kind, resourceKey: `virtual:${profile.connectionId || name}`, exclusive: true, options: Object.freeze({ name }) });
  }
  throw new ConnectionProfileRuntimeError('UNSUPPORTED_TRANSPORT_KIND', `Connection Center does not yet support transport kind ${kind || '(empty)'}`, { transportKind: kind || null });
}

async function buildProfileRuntime(profile) {
  const descriptor = describeProfileRuntime(profile);
  if (descriptor.kind === 'serial-rtu' || descriptor.kind === 'serial-ascii') {
    return Object.freeze({ ...descriptor, transport: new SerialTransport(descriptor.options), cleanup: async () => {} });
  }
  if (descriptor.kind === 'tcp-client') {
    return Object.freeze({ ...descriptor, transport: new TcpClientTransport(descriptor.options), cleanup: async () => {} });
  }
  if (descriptor.kind === 'tcp-server') {
    return Object.freeze({ ...descriptor, transport: new TcpServerTransport(descriptor.options), cleanup: async () => {} });
  }
  const pair = createVirtualLoopbackPair({ names: [`${descriptor.options.name}-runtime`, `${descriptor.options.name}-peer`] });
  await pair.b.open();
  return Object.freeze({
    ...descriptor,
    transport: pair.a,
    peer: pair.b,
    cleanup: async () => { await pair.b.close(); },
  });
}

module.exports = {
  ConnectionProfileRuntimeError,
  transportKind,
  serialOptions,
  tcpClientOptions,
  tcpServerOptions,
  profileFingerprint,
  describeProfileRuntime,
  buildProfileRuntime,
};
