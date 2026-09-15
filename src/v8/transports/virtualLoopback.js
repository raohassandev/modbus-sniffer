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
  constructor({ name, latencyMs = 0, maxQueue = 1024 }) {
    super();
    this.name = name;
    this.latencyMs = latencyMs;
    this.maxQueue = maxQueue;
    this.state = 'closed';
    this.peer = null;
    this.rxQueue = [];
    this.waiters = [];
    this.capabilities = Object.freeze({
      transport: 'virtual',
      duplex: true,
      datagram: true,
      supportsAbort: true,
      bufferedReceive: true,
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
    const error = new VirtualLoopbackError('NOT_OPEN', `${this.name} was closed`);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.emit('state', { state: this.state, name: this.name });
  }

  async send(bytes) {
    if (this.state !== 'open') throw new VirtualLoopbackError('NOT_OPEN', `${this.name} is not open`);
    if (!this.peer || this.peer.state !== 'open') throw new VirtualLoopbackError('PEER_NOT_OPEN', `${this.name} peer is not open`);
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new VirtualLoopbackError('EMPTY_PAYLOAD', 'Virtual transport cannot send an empty payload');

    await new Promise((resolve, reject) => {
      const deliver = () => {
        try {
          if (this.state !== 'open' || this.peer?.state !== 'open') {
            throw new VirtualLoopbackError('PEER_NOT_OPEN', `${this.name} peer closed before delivery`);
          }
          this.emit('tx', Buffer.from(payload));
          this.peer._enqueue(Buffer.from(payload));
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      if (this.latencyMs > 0) setTimeout(deliver, this.latencyMs);
      else queueMicrotask(deliver);
    });
  }

  receive({ timeoutMs = 1000, signal = null } = {}) {
    if (this.state !== 'open') return Promise.reject(new VirtualLoopbackError('NOT_OPEN', `${this.name} is not open`));
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new VirtualLoopbackError('INVALID_TIMEOUT', 'timeoutMs must be a non-negative finite number'));
    if (this.rxQueue.length) return Promise.resolve(Buffer.from(this.rxQueue.shift()));

    return new Promise((resolve, reject) => {
      const waiter = { resolve: null, reject: null, timer: null, signal, onAbort: null };
      const cleanup = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener?.('abort', waiter.onAbort);
        if (waiter.timer) clearTimeout(waiter.timer);
      };
      waiter.resolve = (data) => {
        cleanup();
        resolve(Buffer.from(data));
      };
      waiter.reject = (error) => {
        cleanup();
        reject(error);
      };
      waiter.onAbort = () => waiter.reject(new VirtualLoopbackError('ABORTED', 'Virtual receive was aborted'));

      this.waiters.push(waiter);
      if (signal) {
        if (signal.aborted) return waiter.onAbort();
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          waiter.reject(new VirtualLoopbackError('TIMEOUT', `No virtual data received within ${timeoutMs} ms`));
        }, timeoutMs);
      }
    });
  }

  _enqueue(payload) {
    if (this.state !== 'open') return;
    const data = Buffer.from(payload);
    const waiter = this.waiters[0];
    if (waiter) waiter.resolve(data);
    else {
      if (this.rxQueue.length >= this.maxQueue) {
        this.emit('overflow', { name: this.name, maxQueue: this.maxQueue });
        throw new VirtualLoopbackError('RX_QUEUE_FULL', `${this.name} receive queue reached ${this.maxQueue} datagrams`);
      }
      this.rxQueue.push(data);
    }
    this.emit('data', Buffer.from(data));
    this.emit('rx', Buffer.from(data));
  }
}

function createVirtualLoopbackPair({ latencyMs = 0, maxQueue = 1024, names = ['virtual-a', 'virtual-b'] } = {}) {
  if (!Array.isArray(names) || names.length !== 2 || names.some((name) => typeof name !== 'string' || !name)) {
    throw new TypeError('names must contain exactly two non-empty endpoint names');
  }
  const a = new VirtualLoopbackEndpoint({ name: names[0], latencyMs, maxQueue });
  const b = new VirtualLoopbackEndpoint({ name: names[1], latencyMs, maxQueue });
  a.peer = b;
  b.peer = a;
  return Object.freeze({ a, b });
}

module.exports = {
  VirtualLoopbackEndpoint,
  VirtualLoopbackError,
  createVirtualLoopbackPair,
};
