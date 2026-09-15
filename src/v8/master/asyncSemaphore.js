'use strict';

class SemaphoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SemaphoreError';
    this.code = code;
    Error.captureStackTrace?.(this, SemaphoreError);
  }
}

class AsyncSemaphore {
  constructor(limit) {
    if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async run(fn, { signal = null } = {}) {
    const release = await this.acquire({ signal });
    try { return await fn(); } finally { release(); }
  }

  acquire({ signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(new SemaphoreError('ABORTED', 'Semaphore wait was aborted'));
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this._releaseFactory());
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: null };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener?.('abort', waiter.onAbort);
        reject(new SemaphoreError('ABORTED', 'Semaphore wait was aborted'));
      };
      this.waiters.push(waiter);
      signal?.addEventListener?.('abort', waiter.onAbort, { once: true });
    });
  }

  snapshot() {
    return Object.freeze({ limit: this.limit, active: this.active, queued: this.waiters.length });
  }

  _releaseFactory() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length) {
        const waiter = this.waiters.shift();
        waiter.signal?.removeEventListener?.('abort', waiter.onAbort);
        if (waiter.signal?.aborted) continue;
        waiter.resolve(this._releaseFactory());
        return;
      }
      this.active = Math.max(0, this.active - 1);
    };
  }
}

module.exports = { AsyncSemaphore, SemaphoreError };
