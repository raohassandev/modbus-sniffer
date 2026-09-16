'use strict';

const {
  SerialTransport,
  listSerialPorts,
} = require('./transports/serialTransport');
const { TcpClientTransport } = require('./transports/tcpClientTransport');
const { TcpServerTransport } = require('./transports/tcpServerTransport');
const { UdpClientTransport, UdpServerTransport } = require('./transports/udpTransport');
const { VirtualLoopbackEndpoint } = require('./transports/virtualLoopback');
const { listLocalAddresses, recommendLocalAddress } = require('./transports/networkAddresses');

const OWNER_MODES = Object.freeze(new Set([
  'analyzer',
  'master',
  'slave',
  'proxy',
  'discovery',
  'test',
  'replay',
]));

class ConnectionCenterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectionCenterError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ConnectionCenterError);
  }
}

function normalizeKind(profile) {
  const value = String(profile?.transportKind || profile?.transport || '').trim().toLowerCase();
  const aliases = {
    rtu: 'serial-rtu',
    'modbus-rtu': 'serial-rtu',
    ascii: 'serial-ascii',
    'modbus-ascii': 'serial-ascii',
    tcp: 'tcp-client',
    'modbus-tcp': 'tcp-client',
    tcpclient: 'tcp-client',
    tcpserver: 'tcp-server',
    udp: 'udp-client',
    'modbus-udp': 'udp-client',
    udpclient: 'udp-client',
    udpserver: 'udp-server',
  };
  return aliases[value] || value;
}

function integer(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function defaultTransportFactory(profile) {
  const kind = normalizeKind(profile);
  if (kind === 'serial-rtu' || kind === 'serial-ascii') {
    const serial = profile.serial || {};
    const path = String(serial.path || profile.endpoint || '').trim();
    if (!path) throw new ConnectionCenterError('SERIAL_PATH_REQUIRED', 'Serial profile requires a port path', { connectionId: profile.connectionId });
    return new SerialTransport({
      path,
      framing: kind === 'serial-ascii' ? 'ascii' : 'rtu',
      baudRate: integer(serial.baudRate, 9600),
      dataBits: integer(serial.dataBits, 8),
      stopBits: Number(serial.stopBits ?? 1),
      parity: String(serial.parity || 'none').toLowerCase(),
      rtscts: Boolean(serial.rtscts),
      xon: Boolean(serial.xon),
      xoff: Boolean(serial.xoff),
      xany: Boolean(serial.xany),
      rtsTxMode: serial.rtsTxMode || 'none',
      rtsSettleMs: Number(serial.rtsSettleMs || 0),
      echoSuppression: Boolean(serial.echoSuppression),
      writeTimeoutMs: Number(serial.writeTimeoutMs || 3000),
    });
  }
  if (kind === 'tcp-client') {
    const tcp = profile.tcp || {};
    const host = String(tcp.host || profile.endpoint || '').trim();
    if (!host) throw new ConnectionCenterError('TCP_HOST_REQUIRED', 'TCP client profile requires a host', { connectionId: profile.connectionId });
    return new TcpClientTransport({
      host,
      port: integer(tcp.port, 502),
      localAddress: tcp.localAddress || null,
      family: integer(tcp.family, 0),
      connectTimeoutMs: Number(tcp.connectTimeoutMs || 3000),
      idleTimeoutMs: Number(tcp.idleTimeoutMs || 0),
      writeTimeoutMs: Number(tcp.writeTimeoutMs || 3000),
      reconnect: tcp.reconnect || null,
    });
  }
  if (kind === 'tcp-server') {
    const tcp = profile.tcp || {};
    return new TcpServerTransport({
      host: String(tcp.host || profile.endpoint || '127.0.0.1').trim(),
      port: integer(tcp.port, 502),
      maxClients: integer(tcp.maxClients, 64),
      idleTimeoutMs: Number(tcp.idleTimeoutMs || 0),
      writeTimeoutMs: Number(tcp.writeTimeoutMs || 3000),
    });
  }
  if (kind === 'udp-client') {
    const udp = profile.udp || {};
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
  if (kind === 'udp-server') {
    const udp = profile.udp || {};
    return new UdpServerTransport({
      host: String(udp.host || profile.endpoint || '127.0.0.1').trim(),
      port: integer(udp.port, 502),
      family: udp.family ?? 4,
      maxPeers: integer(udp.maxPeers, 256),
      receiveTimeoutMs: Number(udp.receiveTimeoutMs ?? 1000),
    });
  }
  if (kind === 'virtual') {
    return new VirtualLoopbackEndpoint({ name: profile.connectionId });
  }
  throw new ConnectionCenterError('UNSUPPORTED_TRANSPORT', `Unsupported connection transport: ${kind || '(empty)'}`, {
    connectionId: profile?.connectionId || null,
    transportKind: kind,
  });
}

function resourceKey(profile) {
  const kind = normalizeKind(profile);
  if (kind === 'serial-rtu' || kind === 'serial-ascii') {
    return `serial:${String(profile.serial?.path || profile.endpoint || '').trim()}`;
  }
  if (kind === 'tcp-server') {
    return `tcp-listen:${String(profile.tcp?.host || profile.endpoint || '127.0.0.1').trim()}:${integer(profile.tcp?.port, 502)}`;
  }
  if (kind === 'tcp-client') {
    return `tcp-connect:${String(profile.tcp?.host || profile.endpoint || '').trim()}:${integer(profile.tcp?.port, 502)}:${profile.connectionId}`;
  }
  if (kind === 'udp-server') {
    return `udp-listen:${String(profile.udp?.host || profile.endpoint || '127.0.0.1').trim()}:${integer(profile.udp?.port, 502)}`;
  }
  if (kind === 'udp-client') {
    return `udp-connect:${String(profile.udp?.host || profile.endpoint || '').trim()}:${integer(profile.udp?.port, 502)}:${profile.connectionId}`;
  }
  return `virtual:${profile.connectionId}`;
}

function isExclusive(profile) {
  const kind = normalizeKind(profile);
  return !['tcp-client', 'udp-client'].includes(kind);
}

class ConnectionCenterService {
  constructor({ store, broker, transportFactory = defaultTransportFactory } = {}) {
    if (!store) throw new TypeError('store is required');
    if (!broker) throw new TypeError('broker is required');
    if (typeof transportFactory !== 'function') throw new TypeError('transportFactory must be a function');
    this.store = store;
    this.broker = broker;
    this.transportFactory = transportFactory;
    this.transports = new Map();
  }

  activeProjectId() {
    return this.store.exportAll().activeProjectId;
  }

  listProfiles(projectId = this.activeProjectId()) {
    return this.store.listConnectionProfiles(projectId);
  }

  inventory(projectId = this.activeProjectId()) {
    this.sync(projectId);
    return this.listProfiles(projectId).map((profile) => {
      const runtime = this.broker.getConnection(profile.connectionId);
      const transport = this.transports.get(profile.connectionId);
      return Object.freeze({
        profile,
        runtime,
        diagnostics: typeof transport?.status === 'function' ? transport.status() : null,
      });
    });
  }

  sync(projectId = this.activeProjectId()) {
    const profiles = this.listProfiles(projectId);
    const wanted = new Set(profiles.map((profile) => profile.connectionId));
    for (const profile of profiles) {
      if (!this._hasRuntime(profile.connectionId)) this._define(profile);
    }
    for (const runtime of this.broker.listConnections()) {
      if (!wanted.has(runtime.connectionId) && !runtime.owner && !['open', 'opening', 'closing'].includes(runtime.state)) {
        this.broker.removeConnection(runtime.connectionId);
        this.transports.delete(runtime.connectionId);
      }
    }
    return this.inventoryShallow(projectId);
  }

  inventoryShallow(projectId = this.activeProjectId()) {
    return this.listProfiles(projectId).map((profile) => ({
      profile,
      runtime: this._hasRuntime(profile.connectionId) ? this.broker.getConnection(profile.connectionId) : null,
    }));
  }

  saveProfile(input, projectId = this.activeProjectId()) {
    const connectionId = String(input?.connectionId || input?.id || '').trim();
    if (connectionId && this._hasRuntime(connectionId)) {
      const runtime = this.broker.getConnection(connectionId);
      if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
        throw new ConnectionCenterError('CONNECTION_ACTIVE', 'Close the connection before editing its profile', { connectionId });
      }
      this.broker.removeConnection(connectionId);
      this.transports.delete(connectionId);
    }
    const saved = this.store.upsertConnectionProfile(projectId, input);
    this._define(saved);
    return this.get(saved.connectionId, projectId);
  }

  removeProfile(connectionId, projectId = this.activeProjectId()) {
    if (this._hasRuntime(connectionId)) {
      const runtime = this.broker.getConnection(connectionId);
      if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
        throw new ConnectionCenterError('CONNECTION_ACTIVE', 'Close the connection before deleting its profile', { connectionId });
      }
      this.broker.removeConnection(connectionId);
      this.transports.delete(connectionId);
    }
    return this.store.removeConnectionProfile(projectId, connectionId);
  }

  duplicateProfile(connectionId, { connectionId: nextId = null, name = null } = {}, projectId = this.activeProjectId()) {
    const source = this._profile(connectionId, projectId);
    const copyId = String(nextId || `${connectionId}-copy`).trim();
    if (!copyId) throw new ConnectionCenterError('INVALID_CONNECTION_ID', 'Duplicate profile requires a connection ID');
    return this.saveProfile({
      ...source,
      connectionId: copyId,
      id: copyId,
      sourceChannelId: null,
      name: name || `${source.name || connectionId} Copy`,
    }, projectId);
  }

  exportProfiles(projectId = this.activeProjectId()) {
    return Object.freeze({
      format: 'modbus-workbench-v8-connections',
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: this.listProfiles(projectId),
    });
  }

  importProfiles(payload, projectId = this.activeProjectId()) {
    const profiles = Array.isArray(payload) ? payload : payload?.profiles;
    if (!Array.isArray(profiles)) throw new ConnectionCenterError('INVALID_IMPORT', 'Connection import must contain a profiles array');
    const results = [];
    for (const profile of profiles) results.push(this.saveProfile(profile, projectId));
    return results;
  }

  get(connectionId, projectId = this.activeProjectId()) {
    this.sync(projectId);
    const profile = this._profile(connectionId, projectId);
    const transport = this.transports.get(connectionId);
    return Object.freeze({
      profile,
      runtime: this.broker.getConnection(connectionId),
      diagnostics: typeof transport?.status === 'function' ? transport.status() : null,
    });
  }

  async activate(connectionId, { ownerMode = 'master', ownerId = null } = {}, projectId = this.activeProjectId()) {
    if (!OWNER_MODES.has(ownerMode)) throw new ConnectionCenterError('INVALID_OWNER_MODE', `Unsupported owner mode: ${ownerMode}`, { ownerMode });
    this.sync(projectId);
    const runtime = this.broker.getConnection(connectionId);
    const resolvedOwnerId = String(ownerId || `v8-ui:${ownerMode}:${connectionId}`);
    if (runtime.owner && (runtime.owner.ownerMode !== ownerMode || runtime.owner.ownerId !== resolvedOwnerId)) {
      throw new ConnectionCenterError('OWNERSHIP_CONFLICT', `Connection ${connectionId} is already owned`, {
        connectionId,
        currentOwner: runtime.owner,
        requestedOwner: { ownerMode, ownerId: resolvedOwnerId },
      });
    }
    await this.broker.open(connectionId, { ownerMode, ownerId: resolvedOwnerId });
    return this.get(connectionId, projectId);
  }

  async deactivate(connectionId, projectId = this.activeProjectId()) {
    this.sync(projectId);
    const runtime = this.broker.getConnection(connectionId);
    if (!runtime.owner) return this.get(connectionId, projectId);
    if (['open', 'error'].includes(runtime.state)) await this.broker.close(connectionId, { ownerId: runtime.owner.ownerId });
    const after = this.broker.getConnection(connectionId);
    if (after.owner) this.broker.release(connectionId, { ownerId: after.owner.ownerId });
    return this.get(connectionId, projectId);
  }

  async testConnection(connectionId, projectId = this.activeProjectId()) {
    this.sync(projectId);
    const runtime = this.broker.getConnection(connectionId);
    if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
      throw new ConnectionCenterError('CONNECTION_ACTIVE', 'Connection test requires an inactive profile', { connectionId });
    }
    const ownerId = `v8-test:${connectionId}:${Date.now()}`;
    const startedAt = Date.now();
    try {
      await this.broker.open(connectionId, { ownerMode: 'test', ownerId });
      const openState = this.get(connectionId, projectId);
      return Object.freeze({ ok: true, elapsedMs: Date.now() - startedAt, state: openState });
    } finally {
      const current = this.broker.getConnection(connectionId);
      if (['open', 'error'].includes(current.state)) {
        try { await this.broker.close(connectionId, { ownerId }); } catch { /* preserve original test error */ }
      }
      const closed = this.broker.getConnection(connectionId);
      if (closed.owner?.ownerId === ownerId) {
        try { this.broker.release(connectionId, { ownerId }); } catch { /* preserve original test error */ }
      }
    }
  }

  listSerialPorts() {
    return listSerialPorts();
  }

  listNetworkInterfaces() {
    return listLocalAddresses();
  }

  recommendLocalInterface(targetAddress) {
    return recommendLocalAddress(targetAddress, this.listNetworkInterfaces());
  }

  _profile(connectionId, projectId) {
    const profile = this.listProfiles(projectId).find((entry) => entry.connectionId === connectionId);
    if (!profile) throw new ConnectionCenterError('PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { connectionId, projectId });
    return profile;
  }

  _hasRuntime(connectionId) {
    return this.broker.listConnections().some((entry) => entry.connectionId === connectionId);
  }

  _define(profile) {
    const transport = this.transportFactory(profile);
    this.broker.defineConnection({
      connectionId: profile.connectionId,
      resourceKey: resourceKey(profile),
      transportKind: normalizeKind(profile),
      transport,
      exclusive: isExclusive(profile),
      metadata: {
        profileName: profile.name,
        sourceChannelId: profile.sourceChannelId || null,
      },
    });
    this.transports.set(profile.connectionId, transport);
  }
}

module.exports = {
  OWNER_MODES,
  ConnectionCenterError,
  ConnectionCenterService,
  defaultTransportFactory,
  normalizeKind,
  resourceKey,
  isExclusive,
};
