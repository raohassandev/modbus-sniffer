'use strict';

const { ReceiveQueueError } = require('./receiveQueue');
const { TcpClientTransport, TcpTransportError } = require('./tcpClientTransport');
const { TcpServerTransport } = require('./tcpServerTransport');
const protocol = require('../protocol');

class TunnelFramerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TunnelFramerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TunnelFramerError);
  }
}

class RtuCrcStreamFramer {
  constructor({ maxFrameBytes = 256, maxBufferedBytes = 64 * 1024 } = {}) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 4 || maxFrameBytes > 256) throw new TypeError('maxFrameBytes must be 4..256');
    if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < maxFrameBytes) throw new TypeError('maxBufferedBytes must be >= maxFrameBytes');
    this.maxFrameBytes = maxFrameBytes;
    this.maxBufferedBytes = maxBufferedBytes;
    this.buffer = Buffer.alloc(0);
    this.discardedBytes = 0;
  }

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!incoming.length) return [];
    if (this.buffer.length + incoming.length > this.maxBufferedBytes) {
      const details = { bufferedBytes: this.buffer.length, incomingBytes: incoming.length, maxBufferedBytes: this.maxBufferedBytes };
      this.reset();
      throw new TunnelFramerError('TUNNEL_BUFFER_OVERFLOW', 'RTU/TCP tunnel receive buffer capacity exceeded', details);
    }
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    const frames = [];
    while (this.buffer.length >= 4) {
      const limit = Math.min(this.buffer.length, this.maxFrameBytes);
      let frameLength = 0;
      for (let length = 4; length <= limit; length += 1) {
        try {
          protocol.decodeRtuAdu(this.buffer.subarray(0, length));
          frameLength = length;
          break;
        } catch {
          // Keep scanning until a CRC-valid complete RTU ADU is available.
        }
      }
      if (frameLength) {
        frames.push(Buffer.from(this.buffer.subarray(0, frameLength)));
        this.buffer = Buffer.from(this.buffer.subarray(frameLength));
        continue;
      }
      if (this.buffer.length < this.maxFrameBytes) break;
      this.buffer = Buffer.from(this.buffer.subarray(1));
      this.discardedBytes += 1;
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.discardedBytes = 0;
  }

  snapshot() {
    return Object.freeze({ bufferedBytes: this.buffer.length, discardedBytes: this.discardedBytes, maxFrameBytes: this.maxFrameBytes, maxBufferedBytes: this.maxBufferedBytes });
  }
}

class AsciiTunnelStreamFramer {
  constructor({ maxFrameBytes = 513, maxBufferedBytes = 64 * 1024 } = {}) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 9) throw new TypeError('maxFrameBytes must be >= 9');
    if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < maxFrameBytes) throw new TypeError('maxBufferedBytes must be >= maxFrameBytes');
    this.maxFrameBytes = maxFrameBytes;
    this.maxBufferedBytes = maxBufferedBytes;
    this.buffer = Buffer.alloc(0);
    this.discardedBytes = 0;
  }

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!incoming.length) return [];
    if (this.buffer.length + incoming.length > this.maxBufferedBytes) {
      const details = { bufferedBytes: this.buffer.length, incomingBytes: incoming.length, maxBufferedBytes: this.maxBufferedBytes };
      this.reset();
      throw new TunnelFramerError('TUNNEL_BUFFER_OVERFLOW', 'ASCII/TCP tunnel receive buffer capacity exceeded', details);
    }
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    const frames = [];
    while (this.buffer.length) {
      const colon = this.buffer.indexOf(0x3A);
      if (colon < 0) {
        this.discardedBytes += this.buffer.length;
        this.buffer = Buffer.alloc(0);
        break;
      }
      if (colon > 0) {
        this.discardedBytes += colon;
        this.buffer = Buffer.from(this.buffer.subarray(colon));
      }
      const end = this.buffer.indexOf(Buffer.from('\r\n'));
      if (end < 0) {
        if (this.buffer.length > this.maxFrameBytes) {
          this.buffer = Buffer.from(this.buffer.subarray(1));
          this.discardedBytes += 1;
        }
        break;
      }
      const frameLength = end + 2;
      if (frameLength > this.maxFrameBytes) {
        this.buffer = Buffer.from(this.buffer.subarray(frameLength));
        this.discardedBytes += frameLength;
        continue;
      }
      const frame = Buffer.from(this.buffer.subarray(0, frameLength));
      this.buffer = Buffer.from(this.buffer.subarray(frameLength));
      try {
        protocol.decodeAsciiAdu(frame);
        frames.push(frame);
      } catch {
        this.discardedBytes += frameLength;
      }
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.discardedBytes = 0;
  }

  snapshot() {
    return Object.freeze({ bufferedBytes: this.buffer.length, discardedBytes: this.discardedBytes, maxFrameBytes: this.maxFrameBytes, maxBufferedBytes: this.maxBufferedBytes });
  }
}

function createTunnelFramer(framing, options = {}) {
  if (framing === 'rtu') return new RtuCrcStreamFramer(options);
  if (framing === 'ascii') return new AsciiTunnelStreamFramer(options);
  throw new TypeError('tunnel framing must be rtu or ascii');
}

function unitIdFromFrame(frame, framing) {
  try {
    return framing === 'rtu' ? protocol.decodeRtuAdu(frame).unitId : protocol.decodeAsciiAdu(frame).unitId;
  } catch {
    return null;
  }
}

class TunnelTcpClientTransport extends TcpClientTransport {
  constructor({ framing = 'rtu', ...options } = {}) {
    super(options);
    if (!['rtu', 'ascii'].includes(framing)) throw new TypeError('framing must be rtu or ascii');
    this.tunnelFraming = framing;
    this.framer = createTunnelFramer(framing);
    this.capabilities = Object.freeze({
      ...this.capabilities,
      transport: `${framing}-tcp-client`,
      modbusFraming: framing,
      tunnel: true,
      nativeMbap: false,
    });
  }

  status() {
    return Object.freeze({ ...super.status(), tunnelFraming: this.tunnelFraming, framer: this.framer.snapshot() });
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
      const meta = { unitId: unitIdFromFrame(frame, this.tunnelFraming), receivedAt: Date.now(), tunnelFraming: this.tunnelFraming };
      try {
        this.inbox.push(frame, meta);
      } catch (error) {
        if (error instanceof ReceiveQueueError && error.code === 'RX_QUEUE_OVERFLOW') this.stats.queueOverflows += 1;
        this.stats.lastError = error.message;
        this.emit('transport-error', error);
        this.socket?.destroy(error);
        return;
      }
      this.stats.framesRx += 1;
      this.emit('rx', Buffer.from(frame), Object.freeze(meta));
    }
  }
}

class TunnelTcpServerTransport extends TcpServerTransport {
  constructor({ framing = 'rtu', ...options } = {}) {
    super(options);
    if (!['rtu', 'ascii'].includes(framing)) throw new TypeError('framing must be rtu or ascii');
    this.tunnelFraming = framing;
    this.capabilities = Object.freeze({
      ...this.capabilities,
      transport: `${framing}-tcp-server`,
      modbusFraming: framing,
      tunnel: true,
      nativeMbap: false,
    });
  }

  status() {
    return Object.freeze({ ...super.status(), tunnelFraming: this.tunnelFraming });
  }

  _accept(socket) {
    if (this.state !== 'open' || this.clients.size >= this.maxClients) {
      this.stats.rejectedClients += 1;
      socket.destroy();
      return;
    }
    const clientId = `tunnel-client-${this.nextClientId++}`;
    const client = {
      clientId,
      socket,
      framer: createTunnelFramer(this.tunnelFraming),
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
    if (this.idleTimeoutMs > 0) socket.setTimeout(this.idleTimeoutMs, () => socket.destroy(new TcpTransportError('IDLE_TIMEOUT', `Tunnel client idle for ${this.idleTimeoutMs} ms`, { clientId })));
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
      client.framesRx += 1;
      this.stats.framesRx += 1;
      const meta = {
        ...this._clientMeta(client),
        unitId: unitIdFromFrame(frame, this.tunnelFraming),
        receivedAt: Date.now(),
        tunnelFraming: this.tunnelFraming,
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
}

module.exports = {
  TunnelFramerError,
  RtuCrcStreamFramer,
  AsciiTunnelStreamFramer,
  TunnelTcpClientTransport,
  TunnelTcpServerTransport,
  createTunnelFramer,
};
