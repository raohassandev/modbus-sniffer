'use strict';

const { EventEmitter } = require('node:events');
const { createWorkbenchEvent } = require('./events');

const OWNER_CAPABILITIES = Object.freeze({
  analyzer: 'none',
  replay: 'none',
  discovery: 'read-only',
  proxy: 'forward-only',
  master: 'active',
  slave: 'active',
  test: 'active',
});

const INTENT_POLICY = Object.freeze({
  analyzer: new Set(),
  replay: new Set(),
  discovery: new Set(['read']),
  proxy: new Set(['forward']),
  master: new Set(['read', 'write']),
  slave: new Set(['response']),
  test: new Set(['read', 'write', 'raw']),
});

class ConnectionBrokerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectionBrokerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ConnectionBrokerError);
  }
}

function ensureNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConnectionBrokerError('INVALID_ARGUMENT', `${field} must be a non-empty string`, { field, value });
  }
  return value.trim();
}

class ConnectionBroker extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.resourceClaims = new Map();
  }

  defineConnection({
    connectionId,
    resourceKey,
    transportKind,
    transport = null,
    metadata = {},
    exclusive = true,
  }) {
    connectionId = ensureNonEmptyString(connectionId, 'connectionId');
    resourceKey = ensureNonEmptyString(resourceKey, 'resourceKey');
    transportKind = ensureNonEmptyString(transportKind, 'transportKind');
    if (this.connections.has(connectionId)) {
      throw new ConnectionBrokerError('CONNECTION_EXISTS', `Connection ${connectionId} already exists`, { connectionId });
    }
    if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new ConnectionBrokerError('INVALID_ARGUMENT', 'metadata must be an object');
    }

    const entry = {
      connectionId,
      resourceKey,
      transportKind,
      transport,
      metadata: { ...metadata },
      exclusive: Boolean(exclusive),
      state: 'defined',
      owner: null,
      transmitCapability: 'none',
      writeLock: 'LOCKED',
      faultInjectionEnabled: false,
      openedAt: null,
      lastError: null,
    };
    this.connections.set(connectionId, entry);
    this._emitState('connection.defined', entry);
    return this.getConnection(connectionId);
  }

  removeConnection(connectionId) {
    const entry = this._get(connectionId);
    if (entry.owner || entry.state === 'open' || entry.state === 'opening' || entry.state === 'closing') {
      throw new ConnectionBrokerError('CONNECTION_BUSY', 'Connection must be released and closed before removal', { connectionId });
    }
    this.connections.delete(connectionId);
    this._emitState('connection.removed', entry);
  }

  acquire(connectionId, { ownerMode, ownerId }) {
    const entry = this._get(connectionId);
    ownerMode = ensureNonEmptyString(ownerMode, 'ownerMode');
    ownerId = ensureNonEmptyString(ownerId, 'ownerId');
    const capability = OWNER_CAPABILITIES[ownerMode];
    if (!capability) {
      throw new ConnectionBrokerError('INVALID_OWNER_MODE', `Unsupported owner mode: ${ownerMode}`, { ownerMode });
    }

    if (entry.owner) {
      if (entry.owner.ownerMode === ownerMode && entry.owner.ownerId === ownerId) return this.getConnection(connectionId);
      throw new ConnectionBrokerError('CONNECTION_OWNED', 'Connection already has an active owner', {
        connectionId,
        currentOwner: { ...entry.owner },
      });
    }

    if (entry.exclusive) {
      const claimedBy = this.resourceClaims.get(entry.resourceKey);
      if (claimedBy && claimedBy !== connectionId) {
        const other = this.connections.get(claimedBy);
        throw new ConnectionBrokerError('RESOURCE_BUSY', `Resource ${entry.resourceKey} is already owned`, {
          connectionId,
          resourceKey: entry.resourceKey,
          claimedBy,
          claimedByOwner: other?.owner ? { ...other.owner } : null,
        });
      }
      this.resourceClaims.set(entry.resourceKey, connectionId);
    }

    entry.owner = { ownerMode, ownerId, acquiredAt: Date.now() };
    entry.transmitCapability = capability;
    entry.writeLock = 'LOCKED';
    entry.faultInjectionEnabled = false;
    this._emitState('connection.acquired', entry);
    return this.getConnection(connectionId);
  }

  release(connectionId, { ownerId = null } = {}) {
    const entry = this._get(connectionId);
    if (!entry.owner) return this.getConnection(connectionId);
    if (ownerId != null && entry.owner.ownerId !== ownerId) {
      throw new ConnectionBrokerError('OWNER_MISMATCH', 'Only the current owner may release this connection', {
        connectionId,
        expectedOwnerId: entry.owner.ownerId,
        ownerId,
      });
    }
    if (entry.state === 'open' || entry.state === 'opening' || entry.state === 'closing') {
      throw new ConnectionBrokerError('CONNECTION_OPEN', 'Close the connection before releasing ownership', { connectionId, state: entry.state });
    }

    if (entry.exclusive && this.resourceClaims.get(entry.resourceKey) === connectionId) {
      this.resourceClaims.delete(entry.resourceKey);
    }
    entry.owner = null;
    entry.transmitCapability = 'none';
    entry.writeLock = 'LOCKED';
    entry.faultInjectionEnabled = false;
    this._emitState('connection.released', entry);
    return this.getConnection(connectionId);
  }

  async open(connectionId, { ownerMode, ownerId }) {
    const entry = this._get(connectionId);
    if (!entry.owner) this.acquire(connectionId, { ownerMode, ownerId });
    else if (entry.owner.ownerMode !== ownerMode || entry.owner.ownerId !== ownerId) {
      throw new ConnectionBrokerError('OWNER_MISMATCH', 'Open request does not match the active owner', { connectionId });
    }

    if (entry.state === 'open') return this.getConnection(connectionId);
    if (entry.state !== 'defined' && entry.state !== 'closed' && entry.state !== 'error') {
      throw new ConnectionBrokerError('INVALID_STATE', `Cannot open connection from state ${entry.state}`, { connectionId, state: entry.state });
    }

    entry.state = 'opening';
    entry.lastError = null;
    this._emitState('connection.opening', entry);
    try {
      if (typeof entry.transport?.open === 'function') await entry.transport.open();
      entry.state = 'open';
      entry.openedAt = Date.now();
      this._emitState('connection.opened', entry);
      return this.getConnection(connectionId);
    } catch (error) {
      entry.state = 'error';
      entry.lastError = String(error?.message || error);
      this._emitState('connection.error', entry, { error: entry.lastError });
      throw error;
    }
  }

  async close(connectionId, { ownerId = null } = {}) {
    const entry = this._get(connectionId);
    if (ownerId != null && entry.owner && entry.owner.ownerId !== ownerId) {
      throw new ConnectionBrokerError('OWNER_MISMATCH', 'Only the current owner may close this connection', { connectionId });
    }
    if (entry.state === 'defined' || entry.state === 'closed') {
      entry.state = 'closed';
      return this.getConnection(connectionId);
    }
    if (entry.state !== 'open' && entry.state !== 'error') {
      throw new ConnectionBrokerError('INVALID_STATE', `Cannot close connection from state ${entry.state}`, { connectionId, state: entry.state });
    }

    entry.state = 'closing';
    this._emitState('connection.closing', entry);
    try {
      if (typeof entry.transport?.close === 'function') await entry.transport.close();
    } finally {
      entry.state = 'closed';
      entry.openedAt = null;
      entry.writeLock = 'LOCKED';
      entry.faultInjectionEnabled = false;
      this._emitState('connection.closed', entry);
    }
    return this.getConnection(connectionId);
  }

  setWriteLock(connectionId, { ownerId, enabled }) {
    const entry = this._get(connectionId);
    this._assertOwner(entry, ownerId);
    if (!['master', 'test'].includes(entry.owner.ownerMode)) {
      throw new ConnectionBrokerError('WRITE_NOT_ALLOWED', `Owner mode ${entry.owner.ownerMode} cannot arm writes`, {
        connectionId,
        ownerMode: entry.owner.ownerMode,
      });
    }
    entry.writeLock = enabled ? 'ENABLED' : 'LOCKED';
    this._emitState('connection.write-lock', entry);
    return this.getConnection(connectionId);
  }

  async transmit(connectionId, { ownerId, bytes, intent }) {
    const entry = this._get(connectionId);
    this._assertReady(entry, ownerId);
    intent = ensureNonEmptyString(intent, 'intent');
    const allowed = INTENT_POLICY[entry.owner.ownerMode];
    if (!allowed?.has(intent)) {
      throw new ConnectionBrokerError('TRANSMIT_NOT_ALLOWED', `Owner mode ${entry.owner.ownerMode} cannot transmit with intent ${intent}`, {
        connectionId,
        ownerMode: entry.owner.ownerMode,
        intent,
      });
    }
    if (intent === 'write' && entry.writeLock !== 'ENABLED') {
      throw new ConnectionBrokerError('WRITE_LOCKED', 'Write transmission is locked for this connection', { connectionId });
    }
    if (typeof entry.transport?.send !== 'function') {
      throw new ConnectionBrokerError('TRANSPORT_SEND_UNAVAILABLE', 'Connection transport does not implement send()', { connectionId });
    }
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new ConnectionBrokerError('EMPTY_PAYLOAD', 'Cannot transmit an empty payload', { connectionId });
    await entry.transport.send(payload);
    return payload.length;
  }

  async receive(connectionId, { ownerId, timeoutMs = 1000, signal = null } = {}) {
    const entry = this._get(connectionId);
    this._assertReady(entry, ownerId);
    if (typeof entry.transport?.receive !== 'function') {
      throw new ConnectionBrokerError('TRANSPORT_RECEIVE_UNAVAILABLE', 'Connection transport does not implement receive()', { connectionId });
    }
    return Buffer.from(await entry.transport.receive({ timeoutMs, signal }));
  }

  getConnection(connectionId) {
    const entry = this._get(connectionId);
    return Object.freeze({
      connectionId: entry.connectionId,
      resourceKey: entry.resourceKey,
      transportKind: entry.transportKind,
      metadata: Object.freeze({ ...entry.metadata }),
      exclusive: entry.exclusive,
      state: entry.state,
      owner: entry.owner ? Object.freeze({ ...entry.owner }) : null,
      transmitCapability: entry.transmitCapability,
      writeLock: entry.writeLock,
      faultInjectionEnabled: entry.faultInjectionEnabled,
      openedAt: entry.openedAt,
      lastError: entry.lastError,
    });
  }

  listConnections() {
    return [...this.connections.keys()].map((id) => this.getConnection(id));
  }

  _assertOwner(entry, ownerId) {
    if (!entry.owner) throw new ConnectionBrokerError('NO_OWNER', 'Connection has no active owner', { connectionId: entry.connectionId });
    if (entry.owner.ownerId !== ownerId) {
      throw new ConnectionBrokerError('OWNER_MISMATCH', 'Operation does not match the active owner', {
        connectionId: entry.connectionId,
        expectedOwnerId: entry.owner.ownerId,
        ownerId,
      });
    }
  }

  _assertReady(entry, ownerId) {
    this._assertOwner(entry, ownerId);
    if (entry.state !== 'open') {
      throw new ConnectionBrokerError('CONNECTION_NOT_OPEN', 'Connection must be open for transport I/O', {
        connectionId: entry.connectionId,
        state: entry.state,
      });
    }
  }

  _get(connectionId) {
    connectionId = ensureNonEmptyString(connectionId, 'connectionId');
    const entry = this.connections.get(connectionId);
    if (!entry) throw new ConnectionBrokerError('CONNECTION_NOT_FOUND', `Unknown connection: ${connectionId}`, { connectionId });
    return entry;
  }

  _emitState(type, entry, details = {}) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'connection-broker',
      connectionId: entry.connectionId,
      ownerMode: entry.owner?.ownerMode ?? null,
      details: {
        resourceKey: entry.resourceKey,
        transportKind: entry.transportKind,
        state: entry.state,
        transmitCapability: entry.transmitCapability,
        writeLock: entry.writeLock,
        ...details,
      },
    }));
  }
}

module.exports = {
  OWNER_CAPABILITIES,
  INTENT_POLICY,
  ConnectionBroker,
  ConnectionBrokerError,
};
