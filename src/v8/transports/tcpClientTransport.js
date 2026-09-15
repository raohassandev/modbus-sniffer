'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');
const { BoundedReceiveQueue, ReceiveQueueError } = require('./receiveQueue');
const { ModbusTcpStreamFramer } = require('./tcpStreamFramer');
const { assertLocalAddress } = require('./networkAddresses');

class TcpTransportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TcpTransportError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TcpTransportError);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeReconnect(value) {
  const src = value && typeof value === 'object' ? value : {};
  const enabled = Boolean(src.enabled);
  const maxAttempts = Number.isInteger(src.maxAttempts) && src.maxAttempts >= 0 ? src.maxAttempts : 5;
  const initialDelayMs = Number.isFinite(src.initialDelayMs) && src.initialDelayMs >= 0 ? src.initialDelayMs : 100;
  const maxDelayMs = Number.isFinite(src.maxDelayMs) && src.maxDelayMs >= initialDelayMs ? src.maxDelayMs : 2000;
  return Object.freeze({ enabled, maxAttempts, initialDelayMs, maxDelayMs });
}

class TcpClientTransport extends EventEmitter {
  constructor({
    host,
    port = 502,
    localAddress = null,
    family = 0,
    connectTimeoutMs = 3000,
    idleTimeoutMs = 0,
    writeTimeoutMs = 3000,
    maxQueuedFrames = 2048,
    maxQueuedBytes = 4 * 1024 * 1024,
    maxPendingWriteBytes = 1024 * 1024,
    reconnect = null,
  } = {}) {
    super();
    if (typeof host !== 'string' || !host.trim()) throw new TypeError('host is required');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('port must be 1..65535');
    if (![0, 4, 6].includes(family)) throw new TypeError('family must be 0, 4 or 6');
    if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0) throw new TypeError('connectTimeoutMs must be > 0');
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) throw new TypeError('idleTimeoutMs must be >= 0');
    if (!Number.isFinite(writeTimeoutMs) || writeTimeoutMs <= 0) throw new TypeError('writeTimeoutMs must be > 0');
    if (!Number.isInteger(maxPendingWriteBytes) || maxPendingWriteBytes < 1) throw new TypeError('maxPendingWriteBytes must be positive');

    this.host = host.trim();
    this.port = port;
    this.localAddress = localAddress == null ? null : assertLocalAddress(localAddress, { field: 'localAddress' });
    this.family = family;
    this.connectTimeoutMs = connectTimeoutMs;
    this.idleTimeoutMs = idleTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.maxPendingWriteBytes = maxPendingWriteBytes;
    this.reconnectPolicy = normalizeReconnect(reconnect);
    this.maxQueuedFrames = maxQueuedFrames;
    this.maxQueuedBytes = maxQueuedBytes;
    this.socket = null;
    this.framer = new ModbusTcpStreamFramer();
    this.inbox = new BoundedReceiveQueue({ maxFrames: maxQueuedFrames, maxBytes: maxQueuedBytes });
    this.state = 'closed';
    this.openPromise = null;
    this.closing = false;
    this.reconnectTask = null;
    this.stats = {
      connects: 0,
      reconnects: 0,
      disconnects: 0,
      framesRx: 0,
      framesTx: 0,
      bytesRx: 0,
      bytesTx: 0,
      parserErrors: 0,
      queueOverflows: 0,
      lastError: null,
      connectedAt: null,
    };
    this.capabilities = Object.freeze({
      transport: 'tcp-client',
      duplex: true,
      stream: true,
      supportsAbort: true,
      supportsMatchedReceive: true,
      supportsReconnect: true,
      multipleClients: false,
      ipv4: true,
      ipv6: true,
    });
  }

  async open() {
    if (this.state === 'open') return this.status();
    if (this.openPromise) return this.openPromise;
    this.closing = false;
    this._prepareInbox();
    this.openPromise = this._connectOnce(false).finally(() => { this.openPromise = null; });
    return this.openPromise;
  }

  async close() {
    this.closing = true;
    this.state = 'closing';
    this._emitState();
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        socket.once('close', finish);
        socket.end();
        setTimeout(() => {
          if (!socket.destroyed) socket.destroy();
          finish();
        }, 250).unref?.();
      });
    }
    this.inbox.close(new TcpTransportError('CLOSED', 'TCP client transport is closed'));
    this.framer.reset();
    this.state = 'closed';
    this._emitState();
    return this.status();
  }

  async send(bytes) {
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new TcpTransportError('EMPTY_PAYLOAD', 'Cannot send an empty TCP payload');
    const socket = this.socket;
    if (this.state !== 'open' || !socket || socket.destroyed) {
      throw new TcpTransportError(this.state === 'reconnecting' ? 'RECONNECTING' : 'NOT_OPEN', 'TCP client is not connected', { state: this.state });
    }
    if (socket.writableLength + payload.length > this.maxPendingWriteBytes) {
      throw new TcpTransportError('TX_BACKPRESSURE', 'TCP pending write buffer limit exceeded', {
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
        reject(new TcpTransportError('WRITE_FAILED', error.message, { cause: error.code || null }));
      };
      socket.once('error', onError);
      timer = setTimeout(() => {
        cleanup();
        reject(new TcpTransportError('WRITE_TIMEOUT', `TCP write did not complete within ${this.writeTimeoutMs} ms`));
      }, this.writeTimeoutMs);
      const accepted = socket.write(payload, (error) => {
        if (error) return onError(error);
        cleanup();
        resolve();
      });
      if (!accepted && socket.writableLength > this.maxPendingWriteBytes) {
        cleanup();
        reject(new TcpTransportError('TX_BACKPRESSURE', 'TCP socket entered excessive backpressure', { writableLength: socket.writableLength }));
      }
    });

    this.stats.framesTx += 1;
    this.stats.bytesTx += payload.length;
    this.emit('tx', Buffer.from(payload));
  }

  receive(options = {}) {
    return this.inbox.receive(options);
  }

  status() {
    const socket = this.socket;
    return Object.freeze({
      state: this.state,
      host: this.host,
      port: this.port,
      localAddress: this.localAddress,
      remoteAddress: socket?.remoteAddress || null,
      remotePort: socket?.remotePort || null,
      localSocketAddress: socket?.localAddress || null,
      localPort: socket?.localPort || null,
      capabilities: this.capabilities,
      reconnectPolicy: this.reconnectPolicy,
      queue: this.inbox.snapshot(),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  async _connectOnce(isReconnect) {
    this.state = isReconnect ? 'reconnecting' : 'opening';
    this._emitState();
    const socket = new net.Socket();
    this.socket = socket;
    this.framer.reset();

    return new Promise((resolve, reject) => {
      let settled = false;
      let connectTimer = null;
      const failConnect = (error) => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        socket.destroy();
        const wrapped = error instanceof TcpTransportError ? error : new TcpTransportError('CONNECT_FAILED', error.message || String(error), { cause: error.code || null });
        this.stats.lastError = wrapped.message;
        this.state = 'error';
        this._emitState({ error: wrapped.message });
        reject(wrapped);
      };

      socket.setNoDelay(true);
      socket.setKeepAlive(true);
      if (this.idleTimeoutMs > 0) {
        socket.setTimeout(this.idleTimeoutMs, () => {
          socket.destroy(new TcpTransportError('IDLE_TIMEOUT', `TCP connection idle for ${this.idleTimeoutMs} ms`));
        });
      }

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('close', (hadError) => this._onClose(socket, hadError));
      socket.on('error', (error) => {
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        if (!settled) failConnect(error);
      });

      socket.once('connect', () => {
        if (settled) return;
        settled = true;
        if (connectTimer) clearTimeout(connectTimer);
        this.state = 'open';
        this.stats.connects += 1;
        if (isReconnect) this.stats.reconnects += 1;
        this.stats.connectedAt = Date.now();
        this.stats.lastError = null;
        this._emitState();
        resolve(this.status());
      });

      connectTimer = setTimeout(() => {
        failConnect(new TcpTransportError('CONNECT_TIMEOUT', `TCP connect timed out after ${this.connectTimeoutMs} ms`, { host: this.host, port: this.port }));
      }, this.connectTimeoutMs);

      const options = { host: this.host, port: this.port };
      if (this.localAddress) options.localAddress = this.localAddress;
      if (this.family) options.family = this.family;
      socket.connect(options);
    });
  }

  _onData(chunk) {
    this.stats.bytesRx += chunk.length;
    let frames;
    try {
      frames = this.framer.push(chunk);
    } catch (error) {
      this.stats.parserErrors += 1;
      this.stats.lastError = error.message;
      this.emit('transport-error', error);
      this.socket?.destroy(error);
      return;
    }
    for (const frame of frames) {
      try {
        this.inbox.push(frame, {
          transactionId: frame.readUInt16BE(0),
          unitId: frame[6],
          receivedAt: Date.now(),
        });
      } catch (error) {
        if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        this.socket?.destroy(error);
        return;
      }
      this.stats.framesRx += 1;
      this.emit('rx', Buffer.from(frame));
    }
  }

  _onClose(socket, hadError) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.stats.disconnects += 1;
    this.stats.connectedAt = null;
    this.inbox.close(new TcpTransportError('CONNECTION_LOST', 'TCP connection closed', { hadError: Boolean(hadError) }));
    if (this.closing) return;
    this.state = 'closed';
    this._emitState({ hadError: Boolean(hadError) });
    if (this.reconnectPolicy.enabled) this._startReconnectLoop();
  }

  _startReconnectLoop() {
    if (this.reconnectTask || this.closing) return;
    this.reconnectTask = (async () => {
      let delay = this.reconnectPolicy.initialDelayMs;
      for (let attempt = 1; attempt <= this.reconnectPolicy.maxAttempts && !this.closing; attempt += 1) {
        this.state = 'reconnecting';
        this._emitState({ attempt });
        if (delay > 0) await sleep(delay);
        if (this.closing) break;
        this._prepareInbox();
        try {
          await this._connectOnce(true);
          return;
        } catch (error) {
          this.stats.lastError = error.message;
          delay = Math.min(Math.max(1, delay * 2), this.reconnectPolicy.maxDelayMs);
        }
      }
      if (!this.closing) {
        this.state = 'error';
        this._emitState({ error: this.stats.lastError || 'Reconnect attempts exhausted' });
      }
    })().finally(() => { this.reconnectTask = null; });
  }

  _prepareInbox() {
    if (!this.inbox || this.inbox.snapshot().closed) {
      this.inbox = new BoundedReceiveQueue({ maxFrames: this.maxQueuedFrames, maxBytes: this.maxQueuedBytes });
    }
  }

  _emitState(details = {}) {
    this.emit('state', Object.freeze({ state: this.state, host: this.host, port: this.port, ...details }));
  }
}

module.exports = {
  TcpClientTransport,
  TcpTransportError,
  normalizeReconnect,
};
