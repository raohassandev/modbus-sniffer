'use strict';

class ReceiveQueueError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReceiveQueueError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ReceiveQueueError);
  }
}

class BoundedReceiveQueue {
  constructor({ maxFrames = 2048, maxBytes = 4 * 1024 * 1024 } = {}) {
    if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new TypeError('maxFrames must be a positive integer');
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive integer');
    this.maxFrames = maxFrames;
    this.maxBytes = maxBytes;
    this.items = [];
    this.waiters = [];
    this.queuedBytes = 0;
    this.closedError = null;
  }

  push(bytes, meta = null) {
    if (this.closedError) throw this.closedError;
    const payload = Buffer.from(bytes ?? []);
    if (!payload.length) throw new ReceiveQueueError('EMPTY_PAYLOAD', 'Receive queue cannot accept an empty payload');

    const item = { bytes: payload, meta: meta && typeof meta === 'object' ? { ...meta } : null };
    const waiterIndex = this._findWaiter(item);
    if (waiterIndex >= 0) {
      const waiter = this.waiters.splice(waiterIndex, 1)[0];
      waiter.cleanup();
      waiter.resolve(this._format(item, waiter.withMeta));
      return;
    }

    if (this.items.length + 1 > this.maxFrames || this.queuedBytes + payload.length > this.maxBytes) {
      throw new ReceiveQueueError('RX_QUEUE_OVERFLOW', 'Receive queue capacity exceeded', {
        maxFrames: this.maxFrames,
        maxBytes: this.maxBytes,
        queuedFrames: this.items.length,
        queuedBytes: this.queuedBytes,
        incomingBytes: payload.length,
      });
    }
    this.items.push(item);
    this.queuedBytes += payload.length;
  }

  receive({ timeoutMs = 1000, signal = null, match = null, withMeta = false } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new ReceiveQueueError('INVALID_TIMEOUT', 'timeoutMs must be a non-negative finite number'));
    }
    if (match != null && typeof match !== 'function') {
      return Promise.reject(new ReceiveQueueError('INVALID_MATCHER', 'match must be a function when supplied'));
    }
    if (this.closedError) return Promise.reject(this.closedError);

    const itemIndex = this._findItem(match);
    if (itemIndex >= 0) {
      const item = this.items.splice(itemIndex, 1)[0];
      this.queuedBytes -= item.bytes.length;
      return Promise.resolve(this._format(item, withMeta));
    }

    return new Promise((resolve, reject) => {
      let timer = null;
      const waiter = {
        match,
        withMeta: Boolean(withMeta),
        resolve,
        reject,
        cleanup: () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener?.('abort', onAbort);
        },
      };
      const removeWaiter = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      const onAbort = () => {
        removeWaiter();
        waiter.cleanup();
        reject(new ReceiveQueueError('ABORTED', 'Receive was aborted'));
      };

      this.waiters.push(waiter);
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          removeWaiter();
          waiter.cleanup();
          reject(new ReceiveQueueError('TIMEOUT', `No data received within ${timeoutMs} ms`, { timeoutMs }));
        }, timeoutMs);
      }
    });
  }

  close(error = new ReceiveQueueError('CLOSED', 'Receive queue is closed')) {
    this.closedError = error instanceof Error ? error : new ReceiveQueueError('CLOSED', String(error));
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter.cleanup();
      waiter.reject(this.closedError);
    }
    this.items = [];
    this.queuedBytes = 0;
  }

  reset() {
    if (this.waiters.length) throw new ReceiveQueueError('WAITERS_ACTIVE', 'Cannot reset receive queue while waiters are active');
    this.items = [];
    this.queuedBytes = 0;
    this.closedError = null;
  }

  snapshot() {
    return Object.freeze({
      queuedFrames: this.items.length,
      queuedBytes: this.queuedBytes,
      waitingReceivers: this.waiters.length,
      maxFrames: this.maxFrames,
      maxBytes: this.maxBytes,
      closed: Boolean(this.closedError),
    });
  }

  _findItem(match) {
    if (!match) return this.items.length ? 0 : -1;
    return this.items.findIndex((item) => {
      try { return Boolean(match(item.bytes, item.meta)); } catch { return false; }
    });
  }

  _findWaiter(item) {
    let generic = -1;
    for (let i = 0; i < this.waiters.length; i += 1) {
      const waiter = this.waiters[i];
      if (!waiter.match) {
        if (generic < 0) generic = i;
        continue;
      }
      try {
        if (waiter.match(item.bytes, item.meta)) return i;
      } catch {
        // Ignore matcher failures so one consumer cannot poison the queue.
      }
    }
    return generic;
  }

  _format(item, withMeta) {
    if (!withMeta) return Buffer.from(item.bytes);
    return Object.freeze({
      bytes: Buffer.from(item.bytes),
      meta: item.meta ? Object.freeze({ ...item.meta }) : null,
    });
  }
}

module.exports = {
  BoundedReceiveQueue,
  ReceiveQueueError,
};
