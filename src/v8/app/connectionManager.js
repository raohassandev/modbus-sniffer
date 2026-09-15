'use strict';

const { EventEmitter } = require('node:events');
const { ConnectionBroker } = require('../connectionBrokerSafety');
const { SerialTransport } = require('../transports/serialTransportSafety');
const { TcpClientTransport } = require('../transports/tcpClientTransport');
const { TcpServerTransport } = require('../transports/tcpServerTransport');
const { createVirtualLoopbackPair } = require('../transports/virtualLoopback');

class V8ConnectionManagerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V8ConnectionManagerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, V8ConnectionManagerError);
  }
}

const OWNER_POLICY = Object.freeze({
  'serial-rtu': Object.freeze(['analyzer', 'master', 'slave', 'discovery', 'test']),
  'serial-ascii': Object.freeze(['analyzer', 'master', 'slave', 'discovery', 'test']),
  'tcp-client': Object.freeze(['master', 'discovery', 'test']),
  'tcp-server': Object.freeze(['slave', 'test']),
  virtual: Object.freeze(['analyzer', 'master', 'slave', 'discovery', 'test']),
});

function safeRuntimeDefault(profile) {
  return Object.freeze({
    connectionId: profile.connectionId,
    resourceKey: null,
    transportKind: profile.transportKind,
    transportState: 'closed',
    transportCapabilities: null,
    metadata: Object.freeze({ sourceChannelId: profile.sourceChannelId || null }),
    exclusive: true,
    state: 'closed',
    owner: null,
    transmitCapability: 'none',
    writeLock: 'LOCKED',
    faultInjectionEnabled: false,
    openedAt: null,
    lastError: null,
  });
}

function serialResourceKey(profile) {
  const serial = profile.serial || {};
  const identity = serial.adapter || {};
  if (identity.serialNumber) return `serial:sn:${identity.serialNumber}`;
  if (identity.pnpId) return `serial:pnp:${identity.pnpId}`;
  const port = String(serial.port || profile.endpoint || '').trim();
  if (!port) throw new V8ConnectionManagerError('SERIAL_PORT_REQUIRED', `Connection ${profile.connectionId} has no serial port`);
  return `serial:${port}`;
}

function normalizeTcp(profile, { server = false } = {}) {
  const tcp = profile.tcp || {};
  const host = String(tcp.host || tcp.listenHost || '').trim() || (server ? '127.0.0.1' : '');
  const port = Number(tcp.port ?? tcp.listenPort ?? (server ? 502 : 502));
  if (!host) throw new V8ConnectionManagerError('TCP_HOST_REQUIRED', `Connection ${profile.connectionId} has no TCP host`);
  if (!Number.isInteger(port) || port < (server ? 0 : 1) || port > 65535) {
    throw new V8ConnectionManagerError('TCP_PORT_INVALID', `Connection ${profile.connectionId} has an invalid TCP port`, { port });
  }
  return { host, port };
}

class V8ConnectionManager extends EventEmitter {
  constructor({ store, broker = null } = {}) {
    super();
    if (!store || typeof store.getActiveProject !== 'function') throw new TypeError('store is required');
    this.store = store;
    this.broker = broker || new ConnectionBroker();
    this.runtime = new Map();
    this.broker.on('event', (event) => this.emit('event', event));
    this.broker.on('transmission-audit', (record) => this.emit('transmission-audit', record));
  }

  list() {
    const project = this.store.getActiveProject();
    if (!project) return Object.freeze([]);
    const runtimeById = new Map(this.broker.listConnections().map((status) => [status.connectionId, status]));
    return Object.freeze((project.connections || []).map((profile) => Object.freeze({
      profile: Object.freeze({ ...profile }),
      runtime: runtimeById.get(profile.connectionId) || safeRuntimeDefault(profile),
      allowedOwnerModes: Object.freeze([...(OWNER_POLICY[profile.transportKind] || [])]),
      supported: Boolean(OWNER_POLICY[profile.transportKind]),
    })));
  }

  get(connectionId) {
    const found = this.list().find((entry) => entry.profile.connectionId === connectionId);
    if (!found) throw new V8ConnectionManagerError('CONNECTION_PROFILE_NOT_FOUND', `Unknown connection profile: ${connectionId}`, { connectionId });
    return found;
  }

  async open(connectionId, { ownerMode } = {}) {
    const entry = this.get(connectionId);
    const profile = entry.profile;
    const allowed = OWNER_POLICY[profile.transportKind];
    if (!allowed) {
      throw new V8ConnectionManagerError('TRANSPORT_NOT_YET_INTEGRATED', `Transport ${profile.transportKind || '(unset)'} is not available in the v8 Connection Center yet`, {
        connectionId,
        transportKind: profile.transportKind,
      });
    }
    if (!allowed.includes(ownerMode)) {
      throw new V8ConnectionManagerError('OWNER_MODE_NOT_ALLOWED', `Mode ${ownerMode || '(missing)'} is not valid for ${profile.transportKind}`, {
        connectionId,
        ownerMode: ownerMode || null,
        allowedOwnerModes: [...allowed],
      });
    }

    const existing = this._brokerStatus(connectionId);
    if (existing) {
      if (existing.state === 'open' && existing.owner?.ownerMode === ownerMode) return existing;
      if (existing.owner || existing.state === 'open' || existing.state === 'opening' || existing.state === 'closing') {
        throw new V8ConnectionManagerError('CONNECTION_BUSY', `Connection ${connectionId} is already active`, {
          connectionId,
          state: existing.state,
          owner: existing.owner,
        });
      }
      this.broker.removeConnection(connectionId);
      await this._cleanupRuntime(connectionId);
    }

    const built = await this._build(profile);
    const ownerId = `v8-shell:${this.store.getActiveProject()?.id || 'project'}:${connectionId}:${ownerMode}`;
    this.runtime.set(connectionId, built);
    this.broker.defineConnection({
      connectionId,
      resourceKey: built.resourceKey,
      transportKind: profile.transportKind,
      transport: built.transport,
      exclusive: true,
      metadata: {
        sourceChannelId: profile.sourceChannelId || null,
        profileName: profile.name,
        shellManaged: true,
      },
    });

    try {
      return await this.broker.open(connectionId, { ownerMode, ownerId });
    } catch (error) {
      await this._teardownFailedOpen(connectionId, ownerId);
      throw error;
    }
  }

  async close(connectionId) {
    this.get(connectionId);
    const status = this._brokerStatus(connectionId);
    if (!status) return safeRuntimeDefault(this.get(connectionId).profile);
    const ownerId = status.owner?.ownerId || null;
    try {
      if (status.state === 'open' || status.state === 'error') {
        await this.broker.close(connectionId, { ownerId });
      }
      const afterClose = this._brokerStatus(connectionId);
      if (afterClose?.owner) this.broker.release(connectionId, { ownerId: afterClose.owner.ownerId });
      const releasable = this._brokerStatus(connectionId);
      if (releasable && !releasable.owner && !['open', 'opening', 'closing'].includes(releasable.state)) {
        this.broker.removeConnection(connectionId);
      }
    } finally {
      await this._cleanupRuntime(connectionId);
    }
    return safeRuntimeDefault(this.get(connectionId).profile);
  }

  async closeAll() {
    const ids = this.broker.listConnections().map((entry) => entry.connectionId);
    for (const connectionId of ids) {
      const status = this._brokerStatus(connectionId);
      const ownerId = status?.owner?.ownerId || null;
      try {
        if (status && (status.state === 'open' || status.state === 'error')) await this.broker.close(connectionId, { ownerId });
      } catch { /* continue teardown */ }
      try {
        const next = this._brokerStatus(connectionId);
        if (next?.owner) this.broker.release(connectionId, { ownerId: next.owner.ownerId });
      } catch { /* continue teardown */ }
      try {
        const next = this._brokerStatus(connectionId);
        if (next && !next.owner && !['open', 'opening', 'closing'].includes(next.state)) this.broker.removeConnection(connectionId);
      } catch { /* continue teardown */ }
      await this._cleanupRuntime(connectionId);
    }
  }

  _brokerStatus(connectionId) {
    try { return this.broker.getConnection(connectionId); } catch (error) {
      if (error?.code === 'CONNECTION_NOT_FOUND') return null;
      throw error;
    }
  }

  async _build(profile) {
    if (profile.transportKind === 'serial-rtu' || profile.transportKind === 'serial-ascii') {
      const serial = profile.serial || {};
      const transport = new SerialTransport({
        path: String(serial.port || profile.endpoint || '').trim(),
        baudRate: Number(serial.baudRate) || 9600,
        dataBits: Number(serial.dataBits) || 8,
        stopBits: Number(serial.stopBits) || 1,
        parity: String(serial.parity || 'none').toLowerCase(),
        framing: profile.transportKind === 'serial-ascii' ? 'ascii' : 'rtu',
        rtscts: Boolean(serial.rtscts),
        rtsTxMode: serial.rtsTxMode || 'none',
        rtsSettleMs: Number(serial.rtsSettleMs) || 0,
        echoSuppression: Boolean(serial.echoSuppression),
        writeTimeoutMs: Number(serial.writeTimeoutMs) || 3000,
      });
      return { transport, resourceKey: serialResourceKey(profile), cleanup: null };
    }

    if (profile.transportKind === 'tcp-client') {
      const { host, port } = normalizeTcp(profile);
      const transport = new TcpClientTransport({
        host,
        port,
        localAddress: profile.tcp?.localAddress || null,
        connectTimeoutMs: Number(profile.tcp?.connectTimeoutMs) || 3000,
        idleTimeoutMs: Number(profile.tcp?.idleTimeoutMs) || 0,
        writeTimeoutMs: Number(profile.tcp?.writeTimeoutMs) || 3000,
        reconnect: profile.tcp?.reconnect || null,
      });
      return { transport, resourceKey: `tcp-client:${host}:${port}`, cleanup: null };
    }

    if (profile.transportKind === 'tcp-server') {
      const { host, port } = normalizeTcp(profile, { server: true });
      const transport = new TcpServerTransport({
        host,
        port,
        maxClients: Number(profile.tcp?.maxClients) || 64,
        idleTimeoutMs: Number(profile.tcp?.idleTimeoutMs) || 0,
        writeTimeoutMs: Number(profile.tcp?.writeTimeoutMs) || 3000,
      });
      return { transport, resourceKey: `tcp-server:${host}:${port}`, cleanup: null };
    }

    if (profile.transportKind === 'virtual') {
      const pair = createVirtualLoopbackPair({ names: [`${profile.connectionId}-local`, `${profile.connectionId}-peer`] });
      await pair.b.open();
      return {
        transport: pair.a,
        resourceKey: String(profile.metadata?.resourceKey || `virtual:${profile.connectionId}`),
        cleanup: async () => pair.b.close(),
      };
    }

    throw new V8ConnectionManagerError('TRANSPORT_NOT_YET_INTEGRATED', `Transport ${profile.transportKind} is not available`, {
      connectionId: profile.connectionId,
      transportKind: profile.transportKind,
    });
  }

  async _cleanupRuntime(connectionId) {
    const runtime = this.runtime.get(connectionId);
    this.runtime.delete(connectionId);
    if (typeof runtime?.cleanup === 'function') {
      try { await runtime.cleanup(); } catch { /* cleanup is best effort */ }
    }
  }

  async _teardownFailedOpen(connectionId, ownerId) {
    const status = this._brokerStatus(connectionId);
    try {
      if (status && (status.state === 'open' || status.state === 'error')) await this.broker.close(connectionId, { ownerId });
    } catch { /* preserve original open error */ }
    try {
      const after = this._brokerStatus(connectionId);
      if (after?.owner) this.broker.release(connectionId, { ownerId: after.owner.ownerId });
    } catch { /* preserve original open error */ }
    try {
      const after = this._brokerStatus(connectionId);
      if (after && !after.owner && !['open', 'opening', 'closing'].includes(after.state)) this.broker.removeConnection(connectionId);
    } catch { /* preserve original open error */ }
    await this._cleanupRuntime(connectionId);
  }
}

module.exports = {
  OWNER_POLICY,
  V8ConnectionManager,
  V8ConnectionManagerError,
  safeRuntimeDefault,
};
