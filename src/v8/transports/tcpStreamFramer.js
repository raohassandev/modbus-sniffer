'use strict';

const MAX_TCP_ADU_LENGTH = 260;

class TcpStreamFramerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TcpStreamFramerError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TcpStreamFramerError);
  }
}

class ModbusTcpStreamFramer {
  constructor({ maxBufferedBytes = 64 * 1024, requireProtocolIdZero = true } = {}) {
    if (!Number.isInteger(maxBufferedBytes) || maxBufferedBytes < MAX_TCP_ADU_LENGTH) {
      throw new TypeError(`maxBufferedBytes must be an integer >= ${MAX_TCP_ADU_LENGTH}`);
    }
    this.maxBufferedBytes = maxBufferedBytes;
    this.requireProtocolIdZero = Boolean(requireProtocolIdZero);
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    const incoming = Buffer.from(chunk ?? []);
    if (!incoming.length) return [];
    if (this.buffer.length + incoming.length > this.maxBufferedBytes) {
      const details = { bufferedBytes: this.buffer.length, incomingBytes: incoming.length, maxBufferedBytes: this.maxBufferedBytes };
      this.reset();
      throw new TcpStreamFramerError('TCP_BUFFER_OVERFLOW', 'Modbus TCP stream buffer capacity exceeded', details);
    }

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    const frames = [];
    while (this.buffer.length >= 7) {
      const transactionId = this.buffer.readUInt16BE(0);
      const protocolId = this.buffer.readUInt16BE(2);
      const length = this.buffer.readUInt16BE(4);
      if (this.requireProtocolIdZero && protocolId !== 0) {
        this.reset();
        throw new TcpStreamFramerError('INVALID_PROTOCOL_ID', `Modbus TCP protocol ID must be 0, received ${protocolId}`, { transactionId, protocolId });
      }
      if (length < 2 || length > 254) {
        this.reset();
        throw new TcpStreamFramerError('INVALID_MBAP_LENGTH', `Modbus TCP MBAP length ${length} is outside 2..254`, { transactionId, protocolId, length });
      }
      const totalLength = 6 + length;
      if (totalLength > MAX_TCP_ADU_LENGTH) {
        this.reset();
        throw new TcpStreamFramerError('ADU_TOO_LARGE', `Modbus TCP ADU length ${totalLength} exceeds ${MAX_TCP_ADU_LENGTH}`, { totalLength, length });
      }
      if (this.buffer.length < totalLength) break;
      frames.push(Buffer.from(this.buffer.subarray(0, totalLength)));
      this.buffer = Buffer.from(this.buffer.subarray(totalLength));
    }
    return frames;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  snapshot() {
    return Object.freeze({ bufferedBytes: this.buffer.length, maxBufferedBytes: this.maxBufferedBytes });
  }
}

module.exports = {
  MAX_TCP_ADU_LENGTH,
  ModbusTcpStreamFramer,
  TcpStreamFramerError,
};
