'use strict';

class ExactEchoSuppressor {
  constructor({ enabled = false } = {}) {
    this.enabled = Boolean(enabled);
    this.expected = null;
    this.offset = 0;
    this.matched = [];
  }

  arm(bytes) {
    if (!this.enabled) return;
    const payload = Buffer.from(bytes ?? []);
    this.expected = payload.length ? payload : null;
    this.offset = 0;
    this.matched = [];
  }

  filter(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!this.enabled || !this.expected || !incoming.length) return incoming;
    let index = 0;
    while (index < incoming.length && this.expected && this.offset < this.expected.length) {
      const byte = incoming[index];
      if (byte === this.expected[this.offset]) {
        this.matched.push(byte);
        this.offset += 1;
        index += 1;
        if (this.offset === this.expected.length) {
          this.expected = null;
          this.offset = 0;
          this.matched = [];
          return Buffer.from(incoming.subarray(index));
        }
        continue;
      }

      // A mismatch means the bytes matched so far were real traffic, not echo.
      const recovered = Buffer.from([...this.matched, ...incoming.subarray(index)]);
      this.expected = null;
      this.offset = 0;
      this.matched = [];
      return recovered;
    }
    return Buffer.alloc(0);
  }

  cancel() {
    const recovered = this.matched.length ? Buffer.from(this.matched) : Buffer.alloc(0);
    this.expected = null;
    this.offset = 0;
    this.matched = [];
    return recovered;
  }

  snapshot() {
    return Object.freeze({ enabled: this.enabled, armed: Boolean(this.expected), matchedBytes: this.matched.length });
  }
}

module.exports = { ExactEchoSuppressor };
