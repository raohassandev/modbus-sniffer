'use strict';

const { EventEmitter } = require('node:events');

class VirtualLoopbackError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VirtualLoopbackError';
    this.code = code;
    Error.captureStackTrace?.(this, VirtualLoopbackError);
  }
}

class VirtualLoopbackEndpoint extends EventEmitter {
  constructor({ name, latencyMs = 0 }) {
    super();
    this.name = name;
    this.latencyMs = latencyMs;
    this.state = 'closed';
    this.peer = null;
    this.capabilities = Object.freeze({
      transport: 'virtual',
      duplex: true,
      datagram: true,
      supportsAbort: true,
    });
  }

  async open() {
    if (this.state === 'open') return;
    this.state = 'open';
    this.emit('state', { state: this.state, name: this.name });
  }

  async close() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.emit('state', { state: this.state, name: this.name });
  }

  async send(bytes) {
    if (this.state !== 'open') throw new VirtualLoopbackError('NOT_OPEN', `${this.name} is not open`);
    if (!this.peer || this.peer.state !== 'open') throw new VirtualLoopbackError('PEER_NOT_OPEN', `${this.name} peer is not open`);
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new VirtualLoopbackError('EMPTY_PAYLOAD', 'Virtual transport cannot send an empty payload');

    await new Promise((resolve) => {
      const deliver = () => {
        if (this.state === 'open' && this.peer?.state === 'open') {
          this.emit('tx', Buffer.from(payload));
          this.peer.emit('data', Buffer.from(payload));
          this.peer.emit('rx', Buffer.from(payload));
        }
        resolve();
      };
      if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs);
      else queueMicrotask(deliver);
    });
  }

  receive({ timeoutMs = 1000, signal = null } = {}) {
    if (this.state !== 'open') return Promise.reject(new VirtualLoopbackError('NOT_OPEN', `${this.name} is not open`));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new VirtualLoopbackError('INVALID_TIMEOUT', 'timeoutMs must be a non-negative finite number'));

    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        this.off('data', onData);
        signal?.removeEventListener?.('abort', onAbort);
        if (timer) clearTimeout(timer);
      };
      const onData = (data) => {
        cleanup();
        resolve(Buffer.from(data));
      };
      const onAbort = () => {
        cleanup();
        reject(new VirtualLoopbackError('ABORTED', 'Virtual receive was aborted'));
      };

      this.once('data', onData);
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new VirtualLoopbackError('TIMEOUT', `No virtual data received within ${timeoutMs} ms`));
        }, timeoutMs);
      }
    });
  }
}

function createVirtualLoopbackPair({ latencyMs = 0, names = ['virtual-a', 'virtual-b'] } = {}) {
  if (!Array.isArray(names) || names.length !== 2 || names.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('names must contain exactly two non-empty endpoint names');
  }
  const a = new VirtualLoopbackEndpoint({ name: names[0], latencyMs });
  const b = new VirtualLoopbackEndpoint({ name: names[1], latencyMs });
  a.peer = b;
  b.peer = a;
  return Object.freeze({ a, b });
}

module.exports = {
  VirtualLoopbackEndpoint,
  VirtualLoopbackError,
  createVirtualLoopbackPair,
};
