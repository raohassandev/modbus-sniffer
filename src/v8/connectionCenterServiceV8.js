'use strict';

const fs = require('node:fs');
const {
  ConnectionCenterService: BaseConnectionCenterService,
  ConnectionCenterError,
  defaultTransportFactory,
  normalizeKind: normalizeBaseKind,
} = require('./connectionCenterService');
const { UdpClientTransport, UdpServerTransport } = require('./transports/udpTransport');
const { TunnelTcpClientTransport, TunnelTcpServerTransport } = require('./transports/tunnelTransport');
const { TlsClientTransport, TlsServerTransport } = require('./transports/tlsTransport');

const TRANSPORT_ALIASES = Object.freeze({
  udp: 'udp-client',
  'modbus-udp': 'udp-client',
  udpclient: 'udp-client',
  udpserver: 'udp-server',
  tls: 'tls-client',
  'modbus-tls': 'tls-client',
  'modbus-tcp-security': 'tls-client',
  tlsclient: 'tls-client',
  tlsserver: 'tls-server',
  'rtu-over-tcp': 'rtu-tcp-client',
  'rtu-tcp': 'rtu-tcp-client',
  'rtu-tcp-client': 'rtu-tcp-client',
  'rtu-tcp-server': 'rtu-tcp-server',
  'ascii-over-tcp': 'ascii-tcp-client',
  'ascii-tcp': 'ascii-tcp-client',
  'ascii-tcp-client': 'ascii-tcp-client',
  'ascii-tcp-server': 'ascii-tcp-server',
  'rtu-over-udp': 'rtu-udp-client',
  'rtu-udp': 'rtu-udp-client',
  'rtu-udp-client': 'rtu-udp-client',
  'rtu-udp-server': 'rtu-udp-server',
  'ascii-over-udp': 'ascii-udp-client',
  'ascii-udp': 'ascii-udp-client',
  'ascii-udp-client': 'ascii-udp-client',
  'ascii-udp-server': 'ascii-udp-server',
});

function normalizeKind(profile) {
  const raw = String(profile?.transportKind || profile?.transport || '').trim().toLowerCase();
  return TRANSPORT_ALIASES[raw] || normalizeBaseKind(profile);
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function optionsFor(profile, group) {
  const direct = profile?.[group];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return { ...direct };
  const nested = profile?.metadata?.transportOptions?.[group];
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? { ...nested } : {};
}

function readPemPath(filePath, field, { required = false } = {}) {
  const value = filePath == null ? '' : String(filePath).trim();
  if (!value) {
    if (required) throw new ConnectionCenterError('TLS_MATERIAL_REQUIRED', `${field} path is required`, { field });
    return undefined;
  }
  try {
    return fs.readFileSync(value);
  } catch (error) {
    throw new ConnectionCenterError('TLS_MATERIAL_READ_FAILED', `Cannot read ${field} from ${value}`, {
      field,
      path: value,
      cause: error.code || null,
    });
  }
}

function normalizePersistentTransportOptions(input) {
  const metadata = input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? { ...input.metadata } : {};
  const transportOptions = metadata.transportOptions && typeof metadata.transportOptions === 'object' && !Array.isArray(metadata.transportOptions)
    ? { ...metadata.transportOptions }
    : {};
  for (const group of ['udp', 'tunnel']) {
    if (input?.[group] && typeof input[group] === 'object' && !Array.isArray(input[group])) transportOptions[group] = { ...input[group] };
  }
  if (input?.tls && typeof input.tls === 'object' && !Array.isArray(input.tls)) {
    const tls = input.tls;
    transportOptions.tls = {
      host: tls.host ?? null,
      port: tls.port ?? null,
      localAddress: tls.localAddress ?? null,
      family: tls.family ?? null,
      caPath: tls.caPath ?? null,
      certPath: tls.certPath ?? null,
      keyPath: tls.keyPath ?? null,
      servername: tls.servername ?? null,
      rejectUnauthorized: tls.rejectUnauthorized !== false,
      requestCert: Boolean(tls.requestCert),
      minVersion: tls.minVersion || 'TLSv1.2',
      maxClients: tls.maxClients ?? null,
      idleTimeoutMs: tls.idleTimeoutMs ?? null,
      connectTimeoutMs: tls.connectTimeoutMs ?? null,
      writeTimeoutMs: tls.writeTimeoutMs ?? null,
      reconnect: tls.reconnect ?? null,
    };
  }
  return { ...input, metadata: { ...metadata, transportOptions } };
}

function defaultTransportFactoryV8(profile) {
  const kind = normalizeKind(profile);
  if (['serial-rtu', 'serial-ascii', 'tcp-client', 'tcp-server', 'virtual'].includes(kind)) return defaultTransportFactory({ ...profile, transportKind: kind });

  if (kind === 'udp-client' || kind === 'rtu-udp-client' || kind === 'ascii-udp-client') {
    const udp = { ...optionsFor(profile, 'udp'), ...optionsFor(profile, 'tunnel') };
    const host = String(udp.host || profile.endpoint || '').trim();
    if (!host) throw new ConnectionCenterError('UDP_HOST_REQUIRED', 'UDP client profile requires a host', { connectionId: profile.connectionId });
    return new UdpClientTransport({
      host,
      port: integer(udp.port, 502),
      family: udp.family ?? 4,
      localAddress: udp.localAddress || null,
      localPort: integer(udp.localPort, 0),
      receiveTimeoutMs: Number(udp.receiveTimeoutMs ?? 1000),
    });
  }

  if (kind === 'udp-server' || kind === 'rtu-udp-server' || kind === 'ascii-udp-server') {
    const udp = { ...optionsFor(profile, 'udp'), ...optionsFor(profile, 'tunnel') };
    return new UdpServerTransport({
      host: String(udp.host || profile.endpoint || '127.0.0.1').trim(),
      port: integer(udp.port, 502),
      family: udp.family ?? 4,
      maxPeers: integer(udp.maxPeers, 256),
      receiveTimeoutMs: Number(udp.receiveTimeoutMs ?? 1000),
    });
  }

  if (['rtu-tcp-client', 'ascii-tcp-client'].includes(kind)) {
    const tunnel = optionsFor(profile, 'tunnel');
    const tcp = profile.tcp && typeof profile.tcp === 'object' ? profile.tcp : {};
    const host = String(tunnel.host || tcp.host || profile.endpoint || '').trim();
    if (!host) throw new ConnectionCenterError('TUNNEL_HOST_REQUIRED', 'TCP tunnel client profile requires a host', { connectionId: profile.connectionId });
    return new TunnelTcpClientTransport({
      framing: kind.startsWith('ascii-') ? 'ascii' : 'rtu',
      host,
      port: integer(tunnel.port ?? tcp.port, 502),
      localAddress: tunnel.localAddress || tcp.localAddress || null,
      family: integer(tunnel.family ?? tcp.family, 0),
      connectTimeoutMs: Number(tunnel.connectTimeoutMs ?? tcp.connectTimeoutMs ?? 3000),
      idleTimeoutMs: Number(tunnel.idleTimeoutMs ?? tcp.idleTimeoutMs ?? 0),
      writeTimeoutMs: Number(tunnel.writeTimeoutMs ?? tcp.writeTimeoutMs ?? 3000),
      reconnect: tunnel.reconnect || tcp.reconnect || null,
    });
  }

  if (['rtu-tcp-server', 'ascii-tcp-server'].includes(kind)) {
    const tunnel = optionsFor(profile, 'tunnel');
    const tcp = profile.tcp && typeof profile.tcp === 'object' ? profile.tcp : {};
    return new TunnelTcpServerTransport({
      framing: kind.startsWith('ascii-') ? 'ascii' : 'rtu',
      host: String(tunnel.host || tcp.host || profile.endpoint || '127.0.0.1').trim(),
      port: integer(tunnel.port ?? tcp.port, 502),
      maxClients: integer(tunnel.maxClients ?? tcp.maxClients, 64),
      idleTimeoutMs: Number(tunnel.idleTimeoutMs ?? tcp.idleTimeoutMs ?? 0),
      writeTimeoutMs: Number(tunnel.writeTimeoutMs ?? tcp.writeTimeoutMs ?? 3000),
    });
  }

  if (kind === 'tls-client') {
    const tls = optionsFor(profile, 'tls');
    const host = String(tls.host || profile.endpoint || '').trim();
    if (!host) throw new ConnectionCenterError('TLS_HOST_REQUIRED', 'TLS client profile requires a host', { connectionId: profile.connectionId });
    const certPath = tls.certPath == null ? '' : String(tls.certPath).trim();
    const keyPath = tls.keyPath == null ? '' : String(tls.keyPath).trim();
    if (Boolean(certPath) !== Boolean(keyPath)) throw new ConnectionCenterError('TLS_CLIENT_CERT_INCOMPLETE', 'Client certificate and key paths must be supplied together');
    return new TlsClientTransport({
      host,
      port: integer(tls.port, 802),
      localAddress: tls.localAddress || null,
      family: integer(tls.family, 0),
      ca: readPemPath(tls.caPath, 'CA certificate'),
      cert: readPemPath(certPath, 'client certificate'),
      key: readPemPath(keyPath, 'client private key'),
      servername: tls.servername || null,
      rejectUnauthorized: tls.rejectUnauthorized !== false,
      minVersion: tls.minVersion || 'TLSv1.2',
      connectTimeoutMs: Number(tls.connectTimeoutMs ?? 3000),
      idleTimeoutMs: Number(tls.idleTimeoutMs ?? 0),
      writeTimeoutMs: Number(tls.writeTimeoutMs ?? 3000),
      reconnect: tls.reconnect || null,
    });
  }

  if (kind === 'tls-server') {
    const tls = optionsFor(profile, 'tls');
    return new TlsServerTransport({
      host: String(tls.host || profile.endpoint || '127.0.0.1').trim(),
      port: integer(tls.port, 802),
      ca: readPemPath(tls.caPath, 'CA certificate'),
      cert: readPemPath(tls.certPath, 'server certificate', { required: true }),
      key: readPemPath(tls.keyPath, 'server private key', { required: true }),
      requestCert: Boolean(tls.requestCert),
      rejectUnauthorized: Boolean(tls.rejectUnauthorized),
      minVersion: tls.minVersion || 'TLSv1.2',
      maxClients: integer(tls.maxClients, 64),
      idleTimeoutMs: Number(tls.idleTimeoutMs ?? 0),
      writeTimeoutMs: Number(tls.writeTimeoutMs ?? 3000),
    });
  }

  throw new ConnectionCenterError('UNSUPPORTED_TRANSPORT', `Unsupported connection transport: ${kind || '(empty)'}`, {
    connectionId: profile?.connectionId || null,
    transportKind: kind,
  });
}

function resourceKeyV8(profile) {
  const kind = normalizeKind(profile);
  if (['serial-rtu', 'serial-ascii'].includes(kind)) return `serial:${String(profile.serial?.path || profile.endpoint || '').trim()}`;
  const opts = ['tls-client', 'tls-server'].includes(kind) ? optionsFor(profile, 'tls') : ['udp-client', 'udp-server', 'rtu-udp-client', 'rtu-udp-server', 'ascii-udp-client', 'ascii-udp-server'].includes(kind) ? { ...optionsFor(profile, 'udp'), ...optionsFor(profile, 'tunnel') } : { ...(profile.tcp || {}), ...optionsFor(profile, 'tunnel') };
  const host = String(opts.host || profile.endpoint || (kind.endsWith('-server') ? '127.0.0.1' : '')).trim();
  const defaultPort = kind.startsWith('tls-') ? 802 : 502;
  const port = integer(opts.port, defaultPort);
  if (kind.endsWith('-server')) return `${kind}:listen:${host}:${port}`;
  if (kind.endsWith('-client')) return `${kind}:connect:${host}:${port}:${profile.connectionId}`;
  return `virtual:${profile.connectionId}`;
}

function isExclusiveV8(profile) {
  const kind = normalizeKind(profile);
  if (kind === 'virtual' || kind.startsWith('serial-')) return true;
  return kind.endsWith('-server');
}

class ConnectionCenterServiceV8 extends BaseConnectionCenterService {
  constructor(options = {}) {
    super({ ...options, transportFactory: options.transportFactory || defaultTransportFactoryV8 });
  }

  saveProfile(input, projectId = this.activeProjectId()) {
    return super.saveProfile(normalizePersistentTransportOptions(input), projectId);
  }

  _define(profile) {
    const transport = this.transportFactory(profile);
    this.broker.defineConnection({
      connectionId: profile.connectionId,
      resourceKey: resourceKeyV8(profile),
      transportKind: normalizeKind(profile),
      transport,
      exclusive: isExclusiveV8(profile),
      metadata: {
        profileName: profile.name,
        sourceChannelId: profile.sourceChannelId || null,
      },
    });
    this.transports.set(profile.connectionId, transport);
  }
}

module.exports = {
  ConnectionCenterService: ConnectionCenterServiceV8,
  ConnectionCenterServiceV8,
  ConnectionCenterError,
  defaultTransportFactory: defaultTransportFactoryV8,
  defaultTransportFactoryV8,
  normalizeKind,
  resourceKey: resourceKeyV8,
  resourceKeyV8,
  isExclusiveV8,
  normalizePersistentTransportOptions,
};
