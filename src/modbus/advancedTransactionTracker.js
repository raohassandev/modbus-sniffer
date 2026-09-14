'use strict';

class AdvancedTransactionTracker {
  constructor({ requestTimeoutMs = 1000, onTimeout = null } = {}) {
    this.pending = [];
    this.requestTimeoutMs = Math.max(50, Number(requestTimeoutMs) || 1000);
    this.onTimeout = typeof onTimeout === 'function' ? onTimeout : null;
  }

  setTimeoutMs(ms) {
    this.requestTimeoutMs = Math.max(50, Number(ms) || 1000);
  }

  process(decoded, timestamp = Date.now()) {
    this.expire(timestamp);

    // Modbus RTU address 0 is broadcast. Slaves must not reply, therefore a passive
    // analyzer must never queue it as an outstanding request or report a timeout.
    // TCP Unit ID 0 is intentionally excluded: gateways may use it with normal replies.
    if (decoded?.slaveId === 0 && String(decoded.transport || 'RTU').toUpperCase() !== 'TCP' &&
        ['request','ambiguous','ambiguous-read'].includes(decoded.kind)) {
      const req = { ...decoded, kind: 'request', timestamp, broadcast: true, noResponseExpected: true };
      return { direction: 'REQ', decoded: req, request: req, rttMs: null, broadcast: true, noResponseExpected: true };
    }

    if (decoded.exception) {
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode, decoded.matchToken);
      return { direction: 'RSP', decoded, request: req, rttMs: req ? timestamp - req.timestamp : null };
    }
    if (decoded.kind === 'request') {
      const req = { ...decoded, timestamp };
      this.pending.push(req);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    if (decoded.kind === 'response') {
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode, decoded.matchToken);
      const tx = { direction: 'RSP', decoded, request: req, rttMs: req ? timestamp - req.timestamp : null };
      this._decorateReadResponse(tx);
      return tx;
    }
    if (decoded.kind === 'ambiguous-read') {
      const idx = this._findAmbiguousReadMatch(decoded);
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
      const idx = this._findAmbiguousMatch(decoded);
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

  expire(now = Date.now()) {
    if (!this.pending.length) return [];
    const keep = [];
    const expired = [];
    for (const request of this.pending) {
      if (now - request.timestamp > this.requestTimeoutMs) expired.push(request);
      else keep.push(request);
    }
    this.pending = keep;
    for (const request of expired) this.onTimeout?.(request, now, this.requestTimeoutMs);
    return expired;
  }

  clear() {
    this.pending = [];
  }

  _findAmbiguousReadMatch(decoded) {
    return this.pending.findIndex(p => {
      if (p.slaveId !== decoded.slaveId || p.functionCode !== decoded.functionCode) return false;
      if (!Number.isInteger(p.quantity)) return false;
      return Math.ceil(p.quantity / 8) === Number(decoded.byteCount);
    });
  }

  _findAmbiguousMatch(decoded) {
    return this.pending.findIndex(p => p.slaveId === decoded.slaveId && p.functionCode === decoded.functionCode && p.matchToken === decoded.matchToken);
  }

  _takeMatching(slaveId, functionCode, matchToken) {
    let idx = -1;
    if (matchToken != null) {
      idx = this.pending.findIndex(p => p.slaveId === slaveId && p.functionCode === functionCode && p.matchToken === matchToken);
    }
    if (idx < 0) idx = this.pending.findIndex(p => p.slaveId === slaveId && p.functionCode === functionCode);
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
}

module.exports = { AdvancedTransactionTracker };
