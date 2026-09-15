'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { BoundedReceiveQueue, ReceiveQueueError } = require('./receiveQueue');
const { ModbusTcpStreamFramer } = require('./tcpStreamFramer');
const { assertLocalAddress } = require('./networkAddresses');
const { TcpTransportError } = require('./tcpClientTransport');

class TcpServerTransport extends EventEmitter {
  constructor({
    host = '127.0.0.1',
    port = 502,
    maxClients = 64,
    idleTimeoutMs = 0,
    writeTimeoutMs = 3000,
    maxQueuedFrames = 4096,
    maxQueuedBytes = 8 * 1024 * 1024,
    maxPendingWriteBytes = 1024 * 1024,
  } = {}) {
    super();
    this.host = assertLocalAddress(host, { allowWildcard: true, field: 'host' });
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('port must be 0..65535');
    if (!Number.isInteger(maxClients) || maxClients < 1) throw new TypeError('maxClients must be positive');
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) throw new TypeError('idleTimeoutMs must be >= 0');
    if (!Number.isFinite(writeTimeoutMs) || writeTimeoutMs <= 0) throw new TypeError('writeTimeoutMs must be > 0');
    if (!Number.isInteger(maxPendingWriteBytes) || maxPendingWriteBytes < 1) throw new TypeError('maxPendingWriteBytes must be positive');

    this.port = port;
    this.maxClients = maxClients;
    this.idleTimeoutMs = idleTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.maxPendingWriteBytes = maxPendingWriteBytes;
    this.maxQueuedFrames = maxQueuedFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.server = null;
    this.clients = new Map();
    this.nextClientId = 1;
    this.state = 'closed';
    this.inbox = new BoundedReceiveQueue({ maxFrames: maxQueuedFrames, maxBytes: maxQueuedBytes });
    this.stats = {
      acceptedClients: 0,
      rejectedClients: 0,
      disconnectedClients: 0,
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      parserErrors: 0,
      queueOverflows: 0,
      lastError: null,
      listeningAt: null,
    };
    this.capabilities = Object.freeze({
      transport: 'tcp-server',
      duplex: true,
      stream: true,
      supportsAbort: true,
      supportsMatchedReceive: true,
      supportsRouteMetadata: true,
      multipleClients: true,
      ipv4: true,
      ipv6: true,
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.state === 'opening') throw new TcpTransportError('ALREADY_OPENING', 'TCP server is already opening');
    this._prepareInbox();
    this.state = 'opening';
    this._emitState();
    const server = net.createServer((socket) => this._accept(socket));
    this.server = server;

    return new Promise((resolve, reject) => {
      let settled = false;
      const onError = (error) => {
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        if (!settled) {
          settled = true;
          this.state = 'error';
          reject(new TcpTransportError('LISTEN_FAILED', error.message, { cause: error.code || null, host: this.host, port: this.port }));
        }
      };
      server.on('error', onError);
      server.once('listening', () => {
        if (settled) return;
        settled = true;
        this.state = 'open';
        this.stats.listeningAt = Date.now();
        this.stats.lastError = null;
        this._emitState();
        resolve(this.status());
      });
      server.listen({ host: this.host, port: this.port });
    });
  }

  async close() {
    if (this.state === 'closed') return this.status();
    this.state = 'closing';
    this._emitState();
    for (const client of this.clients.values()) client.socket.destroy();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise((resolve) => {
        try { server.close(() => resolve()); } catch { resolve(); }
      });
    }
    this.inbox.close(new TcpTransportError('CLOSED', 'TCP server transport is closed'));
    this.state = 'closed';
    this.stats.listeningAt = null;
    this._emitState();
    return this.status();
  }

  async send(bytes, { route = null } = {}) {
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new TcpTransportError('EMPTY_PAYLOAD', 'Cannot send an empty TCP payload');
    if (this.state !== 'open') throw new TcpTransportError('NOT_OPEN', 'TCP server is not listening', { state: this.state });
    const client = this._resolveRoute(route);
    const socket = client.socket;
    if (socket.destroyed) throw new TcpTransportError('CLIENT_DISCONNECTED', `TCP client ${client.clientId} is disconnected`, { clientId: client.clientId });
    if (socket.writableLength + payload.length > this.maxPendingWriteBytes) {
      throw new TcpTransportError('TX_BACKPRESSURE', 'TCP client pending write buffer limit exceeded', {
        clientId: client.clientId,
        writableLength: socket.writableLength,
        payloadBytes: payload.length,
        maxPendingWriteBytes: this.maxPendingWriteBytes,
      });
    }

    await new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        socket.off('error', onError);
        if (timer) clearTimeout(timer);
      };
      const onError = (error) => {
        cleanup();
        reject(new TcpTransportError('WRITE_FAILED', error.message, { clientId: client.clientId, cause: error.code || null }));
      };
      socket.once('error', onError);
      timer = setTimeout(() => {
        cleanup();
        reject(new TcpTransportError('WRITE_TIMEOUT', `TCP write did not complete within ${this.writeTimeoutMs} ms`, { clientId: client.clientId }));
      }, this.writeTimeoutMs);
      socket.write(payload, (error) => {
        if (error) return onError(error);
        cleanup();
        resolve();
      });
    });

    client.framesTx += 1;
    client.bytesTx += payload.length;
    client.lastTransactionId = payload.length >= 2 ? payload.readUInt16BE(0) : client.lastTransactionId;
    this.stats.framesTx += 1;
    this.stats.bytesTx += payload.length;
    this.emit('tx', Buffer.from(payload), this._clientMeta(client));
  }

  receive({ timeoutMs = 1000, signal = null, match = null, withMeta = false } = {}) {
    return this.inbox.receive({ timeoutMs, signal, match, withMeta });
  }

  address() {
    const value = this.server?.address?.();
    if (!value || typeof value === 'string') return null;
    return Object.freeze({ address: value.address, family: value.family, port: value.port });
  }

  listClients() {
    return Object.freeze([...this.clients.values()].map((client) => Object.freeze({
      ...this._clientMeta(client),
      connectedAt: client.connectedAt,
      framesRx: client.framesRx,
      framesTx: client.framesTx,
      bytesRx: client.bytesRx,
      bytesTx: client.bytesTx,
      lastTransactionId: client.lastTransactionId,
    })));
  }

  status() {
    return Object.freeze({
      state: this.state,
      configuredHost: this.host,
      configuredPort: this.port,
      listenAddress: this.address(),
      connectedClients: this.clients.size,
      maxClients: this.maxClients,
      capabilities: this.capabilities,
      queue: this.inbox.snapshot(),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  _accept(socket) {
    if (this.state !== 'open' || this.clients.size >= this.maxClients) {
      this.stats.rejectedClients += 1;
      socket.destroy();
      return;
    }
    const clientId = `tcp-client-${this.nextClientId++}`;
    const client = {
      clientId,
      socket,
      framer: new ModbusTcpStreamFramer(),
      connectedAt: Date.now(),
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      lastTransactionId: null,
    };
    this.clients.set(clientId, client);
    this.stats.acceptedClients += 1;
    socket.setNoDelay(true);
    socket.setKeepAlive(true);
    if (this.idleTimeoutMs > 0) socket.setTimeout(this.idleTimeoutMs, () => socket.destroy(new TcpTransportError('IDLE_TIMEOUT', `TCP client idle for ${this.idleTimeoutMs} ms`, { clientId })));
    socket.on('data', (chunk) => this._onClientData(client, chunk));
    socket.on('error', (error) => {
      this.stats.lastError = error.message;
      this.emit('transport-error', error, this._clientMeta(client));
    });
    socket.on('close', () => {
      if (this.clients.delete(clientId)) this.stats.disconnectedClients += 1;
      this.emit('client-state', Object.freeze({ type: 'disconnected', ...this._clientMeta(client) }));
    });
    this.emit('client-state', Object.freeze({ type: 'connected', ...this._clientMeta(client) }));
  }

  _onClientData(client, chunk) {
    client.bytesRx += chunk.length;
    this.stats.bytesRx += chunk.length;
    let frames;
    try {
      frames = client.framer.push(chunk);
    } catch (error) {
      this.stats.parserErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error, this._clientMeta(client));
      client.socket.destroy(error);
      return;
    }

    for (const frame of frames) {
      const transactionId = frame.readUInt16BE(0);
      client.framesRx += 1;
      client.lastTransactionId = transactionId;
      this.stats.framesRx += 1;
      const meta = {
        ...this._clientMeta(client),
        transactionId,
        unitId: frame[6],
        receivedAt: Date.now(),
      };
      try {
        this.inbox.push(frame, meta);
      } catch (error) {
        if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
        this.stats.lastError = error.message;
        this.emit('transport-error', error, meta);
        client.socket.destroy(error);
        return;
      }
      this.emit('rx', Buffer.from(frame), Object.freeze(meta));
    }
  }

  _resolveRoute(route) {
    const clientId = route?.clientId || null;
    if (clientId) {
      const client = this.clients.get(clientId);
      if (!client) throw new TcpTransportError('ROUTE_NOT_FOUND', `TCP response route ${clientId} is no longer connected`, { clientId });
      return client;
    }
    if (this.clients.size === 1) return this.clients.values().next().value;
    if (this.clients.size === 0) throw new TcpTransportError('NO_CLIENTS', 'TCP server has no connected clients');
    throw new TcpTransportError('ROUTE_REQUIRED', 'TCP server has multiple clients; response route metadata is required', { connectedClients: this.clients.size });
  }

  _clientMeta(client) {
    return {
      clientId: client.clientId,
      remoteAddress: client.socket.remoteAddress || null,
      remotePort: client.socket.remotePort || null,
      localAddress: client.socket.localAddress || null,
      localPort: client.socket.localPort || null,
    };
  }

  _prepareInbox() {
    if (!this.inbox || this.inbox.snapshot().closed) {
      this.inbox = new BoundedReceiveQueue({ maxFrames: this.maxQueuedFrames, maxBytes: this.maxQueuedBytes });
    }
  }

  _emitState(details = {}) {
    this.emit('state', Object.freeze({ state: this.state, ...this.address(), ...details }));
  }
}

module.exports = {
  TcpServerTransport,
};
