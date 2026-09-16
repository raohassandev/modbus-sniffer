'use strict';

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const { BoundedReceiveQueue, ReceiveQueueError } = require('./receiveQueue');
const { assertLocalAddress } = require('./networkAddresses');

const MAX_MODBUS_DATAGRAM_BYTES = 260;

class UdpTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'UdpTransportError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, UdpTransportError);
  }
}

function normalizeFamily(value) {
  if (value === 4 || value === 'udp4') return 'udp4';
  if (value === 6 || value === 'udp6') return 'udp6';
  if (value == null || value === 0) return 'udp4';
  throw new TypeError('family must be 4, 6, udp4 or udp6');
}

function validateDatagram(bytes) {
  const payload = Buffer.from(bytes ?? []);
  if (!payload.length) throw new UdpTransportError('EMPTY_PAYLOAD', 'Cannot send an empty UDP payload');
  if (payload.length > MAX_MODBUS_DATAGRAM_BYTES) {
    throw new UdpTransportError('DATAGRAM_TOO_LARGE', `Modbus UDP datagram cannot exceed ${MAX_MODBUS_DATAGRAM_BYTES} bytes`, {
      byteLength: payload.length,
      maxBytes: MAX_MODBUS_DATAGRAM_BYTES,
    });
  }
  return payload;
}

function routeKey(address, port) {
  return `${String(address)}:${Number(port)}`;
}

class UdpClientTransport extends EventEmitter {
  constructor({
    host,
    port = 502,
    family = 4,
    localAddress = null,
    localPort = 0,
    receiveTimeoutMs = 1000,
    maxQueuedFrames = 2048,
    maxQueuedBytes = 4 * 1024 * 1024,
  } = {}) {
    super();
    if (typeof host !== 'string' || !host.trim()) throw new TypeError('host is required');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('port must be 1..65535');
    if (!Number.isInteger(localPort) || localPort < 0 || localPort > 65535) throw new TypeError('localPort must be 0..65535');
    if (!Number.isFinite(receiveTimeoutMs) || receiveTimeoutMs < 0) throw new TypeError('receiveTimeoutMs must be >= 0');

    this.host = host.trim();
    this.port = port;
    this.family = normalizeFamily(family);
    this.localAddress = localAddress == null ? null : assertLocalAddress(localAddress, { field: 'localAddress' });
    this.localPort = localPort;
    this.receiveTimeoutMs = receiveTimeoutMs;
    this.maxQueuedFrames = maxQueuedFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.socket = null;
    this.state = 'closed';
    this.inbox = new BoundedReceiveQueue({ maxFrames: maxQueuedFrames, maxBytes: maxQueuedBytes });
    this.stats = {
      opens: 0,
      closes: 0,
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      queueOverflows: 0,
      socketErrors: 0,
      lastError: null,
      openedAt: null,
    };
    this.capabilities = Object.freeze({
      transport: 'udp-client',
      duplex: true,
      datagram: true,
      stream: false,
      supportsAbort: true,
      supportsMatchedReceive: true,
      supportsRouteMetadata: false,
      multipleClients: false,
      ipv4: this.family === 'udp4',
      ipv6: this.family === 'udp6',
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.state === 'opening') throw new UdpTransportError('ALREADY_OPENING', 'UDP client is already opening');
    this._prepareInbox();
    this.state = 'opening';
    this._emitState();
    const socket = dgram.createSocket(this.family);
    this.socket = socket;

    socket.on('message', (message, rinfo) => this._onMessage(message, rinfo));
    socket.on('error', (error) => {
      this.stats.socketErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
    });
    socket.on('close', () => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (this.state !== 'closing') {
        this.state = 'error';
        this.stats.lastError = this.stats.lastError || 'UDP socket closed unexpectedly';
        this.inbox.close(new UdpTransportError('CONNECTION_LOST', 'UDP client socket closed unexpectedly'));
        this._emitState({ error: this.stats.lastError });
      }
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          socket.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          socket.off('error', onError);
          resolve();
        };
        socket.once('error', onError);
        socket.once('listening', onListening);
        const bindOptions = { port: this.localPort };
        if (this.localAddress) bindOptions.address = this.localAddress;
        socket.bind(bindOptions);
      });
      await new Promise((resolve, reject) => {
        socket.connect(this.port, this.host, (error) => error ? reject(error) : resolve());
      });
      this.state = 'open';
      this.stats.opens += 1;
      this.stats.openedAt = Date.now();
      this.stats.lastError = null;
      this._emitState();
      return this.status();
    } catch (error) {
      try { socket.close(); } catch { /* cleanup only */ }
      this.socket = null;
      this.state = 'error';
      this.stats.socketErrors += 1;
      this.stats.lastError = error.message;
      this._emitState({ error: error.message });
      throw new UdpTransportError('OPEN_FAILED', error.message, { cause: error.code || null, host: this.host, port: this.port });
    }
  }

  async close() {
    if (this.state === 'closed') return this.status();
    this.state = 'closing';
    this._emitState();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      await new Promise((resolve) => {
        socket.once('close', resolve);
        try { socket.close(); } catch { resolve(); }
      });
    }
    this.inbox.close(new UdpTransportError('CLOSED', 'UDP client transport is closed'));
    this.state = 'closed';
    this.stats.closes += 1;
    this.stats.openedAt = null;
    this._emitState();
    return this.status();
  }

  async send(bytes) {
    const payload = validateDatagram(bytes);
    const socket = this.socket;
    if (this.state !== 'open' || !socket) throw new UdpTransportError('NOT_OPEN', 'UDP client is not open', { state: this.state });
    await new Promise((resolve, reject) => {
      socket.send(payload, (error) => error ? reject(new UdpTransportError('SEND_FAILED', error.message, { cause: error.code || null })) : resolve());
    });
    this.stats.framesTx += 1;
    this.stats.bytesTx += payload.length;
    this.emit('tx', Buffer.from(payload));
  }

  receive(options = {}) {
    const timeoutMs = options.timeoutMs == null ? this.receiveTimeoutMs : options.timeoutMs;
    return this.inbox.receive({ ...options, timeoutMs });
  }

  status() {
    const address = this.socket?.address?.();
    return Object.freeze({
      state: this.state,
      host: this.host,
      port: this.port,
      family: this.family,
      localAddress: address && typeof address !== 'string' ? address.address : this.localAddress,
      localPort: address && typeof address !== 'string' ? address.port : this.localPort,
      capabilities: this.capabilities,
      queue: this.inbox.snapshot(),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  _onMessage(message, rinfo) {
    const payload = Buffer.from(message);
    if (!payload.length || payload.length > MAX_MODBUS_DATAGRAM_BYTES) {
      const error = new UdpTransportError('INVALID_DATAGRAM', 'Received UDP datagram is outside Modbus ADU size bounds', {
        byteLength: payload.length,
        maxBytes: MAX_MODBUS_DATAGRAM_BYTES,
      });
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
      return;
    }
    this.stats.framesRx += 1;
    this.stats.bytesRx += payload.length;
    const meta = Object.freeze({ remoteAddress: rinfo.address, remotePort: rinfo.port, family: rinfo.family, receivedAt: Date.now() });
    try {
      this.inbox.push(payload, meta);
    } catch (error) {
      if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
      return;
    }
    this.emit('rx', Buffer.from(payload), meta);
  }

  _prepareInbox() {
    if (!this.inbox || this.inbox.snapshot().closed) this.inbox = new BoundedReceiveQueue({ maxFrames: this.maxQueuedFrames, maxBytes: this.maxQueuedBytes });
  }

  _emitState(details = {}) {
    this.emit('state', Object.freeze({ state: this.state, host: this.host, port: this.port, ...details }));
  }
}

class UdpServerTransport extends EventEmitter {
  constructor({
    host = '127.0.0.1',
    port = 502,
    family = 4,
    maxPeers = 256,
    receiveTimeoutMs = 1000,
    maxQueuedFrames = 4096,
    maxQueuedBytes = 8 * 1024 * 1024,
  } = {}) {
    super();
    this.host = assertLocalAddress(host, { allowWildcard: true, field: 'host' });
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be 0..65535');
    if (!Number.isInteger(maxPeers) || maxPeers < 1) throw new TypeError('maxPeers must be positive');
    if (!Number.isFinite(receiveTimeoutMs) || receiveTimeoutMs < 0) throw new TypeError('receiveTimeoutMs must be >= 0');
    this.port = port;
    this.family = normalizeFamily(family);
    this.maxPeers = maxPeers;
    this.receiveTimeoutMs = receiveTimeoutMs;
    this.maxQueuedFrames = maxQueuedFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.socket = null;
    this.state = 'closed';
    this.inbox = new BoundedReceiveQueue({ maxFrames: maxQueuedFrames, maxBytes: maxQueuedBytes });
    this.peers = new Map();
    this.stats = {
      opens: 0,
      closes: 0,
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      queueOverflows: 0,
      rejectedPeers: 0,
      socketErrors: 0,
      lastError: null,
      openedAt: null,
    };
    this.capabilities = Object.freeze({
      transport: 'udp-server',
      duplex: true,
      datagram: true,
      stream: false,
      supportsAbort: true,
      supportsMatchedReceive: true,
      supportsRouteMetadata: true,
      multipleClients: true,
      ipv4: this.family === 'udp4',
      ipv6: this.family === 'udp6',
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.state === 'opening') throw new UdpTransportError('ALREADY_OPENING', 'UDP server is already opening');
    this._prepareInbox();
    this.state = 'opening';
    this._emitState();
    const socket = dgram.createSocket(this.family);
    this.socket = socket;
    socket.on('message', (message, rinfo) => this._onMessage(message, rinfo));
    socket.on('error', (error) => {
      this.stats.socketErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
    });

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          socket.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          socket.off('error', onError);
          resolve();
        };
        socket.once('error', onError);
        socket.once('listening', onListening);
        socket.bind({ address: this.host, port: this.port });
      });
      this.state = 'open';
      this.stats.opens += 1;
      this.stats.openedAt = Date.now();
      this.stats.lastError = null;
      this._emitState();
      return this.status();
    } catch (error) {
      try { socket.close(); } catch { /* cleanup only */ }
      this.socket = null;
      this.state = 'error';
      this.stats.socketErrors += 1;
      this.stats.lastError = error.message;
      this._emitState({ error: error.message });
      throw new UdpTransportError('BIND_FAILED', error.message, { cause: error.code || null, host: this.host, port: this.port });
    }
  }

  async close() {
    if (this.state === 'closed') return this.status();
    this.state = 'closing';
    this._emitState();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      await new Promise((resolve) => {
        socket.once('close', resolve);
        try { socket.close(); } catch { resolve(); }
      });
    }
    this.inbox.close(new UdpTransportError('CLOSED', 'UDP server transport is closed'));
    this.peers.clear();
    this.state = 'closed';
    this.stats.closes += 1;
    this.stats.openedAt = null;
    this._emitState();
    return this.status();
  }

  async send(bytes, { route = null } = {}) {
    const payload = validateDatagram(bytes);
    const socket = this.socket;
    if (this.state !== 'open' || !socket) throw new UdpTransportError('NOT_OPEN', 'UDP server is not open', { state: this.state });
    const address = route?.remoteAddress || route?.address || null;
    const port = route?.remotePort || route?.port || null;
    if (typeof address !== 'string' || !address || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new UdpTransportError('ROUTE_REQUIRED', 'UDP server response requires route metadata with remoteAddress/remotePort');
    }
    await new Promise((resolve, reject) => {
      socket.send(payload, port, address, (error) => error ? reject(new UdpTransportError('SEND_FAILED', error.message, { cause: error.code || null, address, port })) : resolve());
    });
    this.stats.framesTx += 1;
    this.stats.bytesTx += payload.length;
    this.emit('tx', Buffer.from(payload), Object.freeze({ remoteAddress: address, remotePort: port }));
  }

  receive(options = {}) {
    const timeoutMs = options.timeoutMs == null ? this.receiveTimeoutMs : options.timeoutMs;
    return this.inbox.receive({ ...options, timeoutMs });
  }

  address() {
    const value = this.socket?.address?.();
    if (!value || typeof value === 'string') return null;
    return Object.freeze({ address: value.address, family: value.family, port: value.port });
  }

  listPeers() {
    return Object.freeze([...this.peers.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((peer) => Object.freeze({ ...peer })));
  }

  status() {
    return Object.freeze({
      state: this.state,
      configuredHost: this.host,
      configuredPort: this.port,
      family: this.family,
      listenAddress: this.address(),
      peerCount: this.peers.size,
      maxPeers: this.maxPeers,
      capabilities: this.capabilities,
      queue: this.inbox.snapshot(),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  _onMessage(message, rinfo) {
    const payload = Buffer.from(message);
    if (!payload.length || payload.length > MAX_MODBUS_DATAGRAM_BYTES) {
      const error = new UdpTransportError('INVALID_DATAGRAM', 'Received UDP datagram is outside Modbus ADU size bounds', { byteLength: payload.length });
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
      return;
    }
    const key = routeKey(rinfo.address, rinfo.port);
    if (!this.peers.has(key) && this.peers.size >= this.maxPeers) {
      this.stats.rejectedPeers += 1;
      this.emit('transport-error', new UdpTransportError('PEER_LIMIT', 'UDP peer limit reached', { maxPeers: this.maxPeers, address: rinfo.address, port: rinfo.port }));
      return;
    }
    const previous = this.peers.get(key);
    const peer = {
      peerId: key,
      remoteAddress: rinfo.address,
      remotePort: rinfo.port,
      family: rinfo.family,
      firstSeenAt: previous?.firstSeenAt || Date.now(),
      lastSeenAt: Date.now(),
      framesRx: (previous?.framesRx || 0) + 1,
    };
    this.peers.set(key, peer);
    this.stats.framesRx += 1;
    this.stats.bytesRx += payload.length;
    const meta = Object.freeze({
      peerId: key,
      remoteAddress: rinfo.address,
      remotePort: rinfo.port,
      family: rinfo.family,
      receivedAt: Date.now(),
    });
    try {
      this.inbox.push(payload, meta);
    } catch (error) {
      if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error, meta);
      return;
    }
    this.emit('rx', Buffer.from(payload), meta);
  }

  _prepareInbox() {
    if (!this.inbox || this.inbox.snapshot().closed) this.inbox = new BoundedReceiveQueue({ maxFrames: this.maxQueuedFrames, maxBytes: this.maxQueuedBytes });
  }

  _emitState(details = {}) {
    this.emit('state', Object.freeze({ state: this.state, ...this.address(), ...details }));
  }
}

module.exports = {
  MAX_MODBUS_DATAGRAM_BYTES,
  UdpTransportError,
  UdpClientTransport,
  UdpServerTransport,
  normalizeFamily,
  validateDatagram,
};
