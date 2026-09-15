'use strict';

const { EventEmitter } = require('node:events');

function calculateRtuFrameGapMs({ baudRate, dataBits = 8, stopBits = 1, parity = 'none' }) {
  if (!Number.isFinite(baudRate) || baudRate <= 0) throw new TypeError('baudRate must be > 0');
  if (![5, 6, 7, 8].includes(dataBits)) throw new TypeError('dataBits must be 5..8');
  if (![1, 1.5, 2].includes(stopBits)) throw new TypeError('stopBits must be 1, 1.5 or 2');
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new TypeError('unsupported parity');
  if (baudRate > 19200) return 1.75;
  const bitsPerChar = 1 + dataBits + (parity === 'none' ? 0 : 1) + stopBits;
  return (3.5 * bitsPerChar * 1000) / baudRate;
}

class RtuIdleFramer extends EventEmitter {
  constructor({ baudRate, dataBits = 8, stopBits = 1, parity = 'none', maxFrameBytes = 256 } = {}) {
    super();
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 4) throw new TypeError('maxFrameBytes must be >= 4');
    this.gapMs = calculateRtuFrameGapMs({ baudRate, dataBits, stopBits, parity });
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
    this.timer = null;
  }

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!incoming.length) return;
    if (this.buffer.length + incoming.length > this.maxFrameBytes) {
      const error = new Error(`RTU frame exceeded ${this.maxFrameBytes} bytes`);
      error.name = 'SerialFramerError';
      error.code = 'RTU_FRAME_OVERFLOW';
      error.details = { bufferedBytes: this.buffer.length, incomingBytes: incoming.length, maxFrameBytes: this.maxFrameBytes };
      this.reset();
      this.emit('framing-error', error);
      return;
    }
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    this._arm();
  }

  flush() {
    if (!this.buffer.length) return null;
    const frame = Buffer.from(this.buffer);
    this.buffer = Buffer.alloc(0);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit('frame', frame);
    return frame;
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = Buffer.alloc(0);
  }

  close() { this.reset(); }

  _arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), Math.max(1, Math.ceil(this.gapMs)));
  }
}

class AsciiLineFramer extends EventEmitter {
  constructor({ maxFrameBytes = 513 } = {}) {
    super();
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 9) throw new TypeError('maxFrameBytes must be >= 9');
    this.maxFrameBytes = maxFrameBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!incoming.length) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    this._extract();
    if (this.buffer.length > this.maxFrameBytes) {
      const lastColon = this.buffer.lastIndexOf(0x3A);
      const error = new Error(`ASCII frame exceeded ${this.maxFrameBytes} bytes without CRLF`);
      error.name = 'SerialFramerError';
      error.code = 'ASCII_FRAME_OVERFLOW';
      error.details = { bufferedBytes: this.buffer.length, maxFrameBytes: this.maxFrameBytes };
      this.buffer = lastColon >= 0 ? Buffer.from(this.buffer.subarray(lastColon)) : Buffer.alloc(0);
      this.emit('framing-error', error);
    }
  }

  reset() { this.buffer = Buffer.alloc(0); }
  close() { this.reset(); }

  _extract() {
    while (this.buffer.length) {
      const colon = this.buffer.indexOf(0x3A);
      if (colon < 0) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (colon > 0) this.buffer = Buffer.from(this.buffer.subarray(colon));
      const end = this.buffer.indexOf(Buffer.from('\r\n'));
      if (end < 0) return;
      const frame = Buffer.from(this.buffer.subarray(0, end + 2));
      this.buffer = Buffer.from(this.buffer.subarray(end + 2));
      this.emit('frame', frame);
    }
  }
}

module.exports = {
  calculateRtuFrameGapMs,
  RtuIdleFramer,
  AsciiLineFramer,
};
