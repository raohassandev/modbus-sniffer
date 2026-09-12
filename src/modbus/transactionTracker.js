'use strict';

class TransactionTracker {
  constructor({ requestTimeoutMs = 2000 } = {}) {
    this.pending = [];
    this.requestTimeoutMs = requestTimeoutMs;
  }

  process(decoded, timestamp = Date.now()) {
    this._expire(timestamp);
    if (decoded.exception) {
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode);
      return { direction: 'RSP', decoded, request: req, rttMs: req ? timestamp - req.timestamp : null };
    }
    if (decoded.kind === 'request') {
      const req = { ...decoded, timestamp };
      this.pending.push(req);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    if (decoded.kind === 'response') {
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode);
      const tx = { direction: 'RSP', decoded, request: req, rttMs: req ? timestamp - req.timestamp : null };
      this._decorateReadResponse(tx);
      return tx;
    }
    if (decoded.kind === 'ambiguous-read') {
      const idx = this.pending.findIndex(p => p.slaveId === decoded.slaveId && p.functionCode === decoded.functionCode && Number.isInteger(p.quantity) && Math.ceil(p.quantity / 8) === Number(decoded.byteCount));
      if (idx >= 0) {
        const [req] = this.pending.splice(idx, 1);
        const rsp = { ...decoded, kind: 'response' };
        const tx = { direction: 'RSP', decoded: rsp, request: req, rttMs: timestamp - req.timestamp };
        this._decorateReadResponse(tx);
        return tx;
      }
      const req = { ...decoded, kind: 'request', timestamp };
      this.pending.push(req);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    if (decoded.kind === 'ambiguous') {
      const idx = this.pending.findIndex(p => p.slaveId === decoded.slaveId && p.functionCode === decoded.functionCode && p.matchToken === decoded.matchToken);
      if (idx >= 0) {
        const [req] = this.pending.splice(idx, 1);
        return { direction: 'RSP', decoded, request: req, rttMs: timestamp - req.timestamp };
      }
      const req = { ...decoded, kind: 'request', timestamp };
      this.pending.push(req);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    return { direction: 'UNK', decoded, request: null, rttMs: null };
  }

  _takeMatching(slaveId, functionCode) {
    const idx = this.pending.findIndex(p => p.slaveId === slaveId && p.functionCode === functionCode);
    if (idx < 0) return null;
    return this.pending.splice(idx, 1)[0];
  }

  _decorateReadResponse(tx) {
    const d = tx.decoded;
    const r = tx.request;
    if (!r) return;
    let startAddress;
    if (d.functionCode === 3 || d.functionCode === 4) startAddress = r.startAddress;
    if (d.functionCode === 23) startAddress = r.readStartAddress;
    if (startAddress !== undefined && Array.isArray(d.words)) {
      d.registers = d.words.map((value, i) => ({ address: startAddress + i, value, hex: `0x${value.toString(16).toUpperCase().padStart(4, '0')}` }));
    }
    if ((d.functionCode === 1 || d.functionCode === 2) && Array.isArray(d.bits)) {
      d.points = d.bits.slice(0, r.quantity).map((value, i) => ({ address: r.startAddress + i, value }));
    }
  }

  _expire(now) {
    this.pending = this.pending.filter(p => now - p.timestamp <= this.requestTimeoutMs);
  }
}

module.exports = { TransactionTracker };
