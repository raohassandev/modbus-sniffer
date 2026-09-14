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
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode, decoded.matchToken, decoded);
      return { direction: 'RSP', decoded, request: req, rttMs: req ? timestamp - req.timestamp : null };
    }
    if (decoded.kind === 'request') {
      const req = this._queueRequest(decoded, timestamp);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    if (decoded.kind === 'response') {
      const req = this._takeMatching(decoded.slaveId, decoded.functionCode, decoded.matchToken, decoded);
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
      const req = this._queueRequest({ ...decoded, kind:'request' }, timestamp);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    if (decoded.kind === 'ambiguous') {
      const idx = this._findAmbiguousMatch(decoded);
      if (idx >= 0) {
        const [req] = this.pending.splice(idx, 1);
        return { direction: 'RSP', decoded, request: req, rttMs: timestamp - req.timestamp };
      }
      const req = this._queueRequest({ ...decoded, kind:'request' }, timestamp);
      return { direction: 'REQ', decoded: req, request: req, rttMs: null };
    }
    return { direction: 'UNK', decoded, request: null, rttMs: null };
  }

  _queueRequest(decoded, timestamp) {
    const overlapping = this.pending.filter(p => p.slaveId === decoded.slaveId && p.functionCode === decoded.functionCode);
    const req = {
      ...decoded,
      timestamp,
      overlappingOutstanding: overlapping.length,
      pairingRisk: overlapping.length ? 'same-unit-function-already-pending' : null
    };
    if (overlapping.length) for (const p of overlapping) p.pairingRisk = 'same-unit-function-overlap';
    this.pending.push(req);
    return req;
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

  _expectedByteCount(request) {
    if (!request) return null;
    if ([1,2].includes(Number(request.functionCode)) && Number.isInteger(request.quantity)) return Math.ceil(request.quantity / 8);
    if ([3,4].includes(Number(request.functionCode)) && Number.isInteger(request.quantity)) return request.quantity * 2;
    if (Number(request.functionCode) === 23 && Number.isInteger(request.readQuantity)) return request.readQuantity * 2;
    return null;
  }

  _findAmbiguousReadMatch(decoded) {
    const candidates=[];
    for(let i=0;i<this.pending.length;i++){
      const p=this.pending[i];
      if(p.slaveId!==decoded.slaveId||p.functionCode!==decoded.functionCode)continue;
      if(this._expectedByteCount(p)===Number(decoded.byteCount))candidates.push(i);
    }
    return candidates.length===1?candidates[0]:-1;
  }

  _findAmbiguousMatch(decoded) {
    return this.pending.findIndex(p => p.slaveId === decoded.slaveId && p.functionCode === decoded.functionCode && p.matchToken === decoded.matchToken);
  }

  _takeMatching(slaveId, functionCode, matchToken, response = null) {
    if (matchToken != null) {
      const idx=this.pending.findIndex(p=>p.slaveId===slaveId&&p.functionCode===functionCode&&p.matchToken===matchToken);
      if(idx>=0)return this.pending.splice(idx,1)[0];
    }
    const candidates=[];
    for(let i=0;i<this.pending.length;i++)if(this.pending[i].slaveId===slaveId&&this.pending[i].functionCode===functionCode)candidates.push(i);
    if(!candidates.length)return null;
    if(candidates.length===1)return this.pending.splice(candidates[0],1)[0];

    // For read responses, byte count can safely distinguish requests with different
    // quantities. If multiple outstanding requests still fit the response, RTU has no
    // transaction ID and any pairing would be invented; leave it unmatched instead.
    if(response&&Number.isInteger(Number(response.byteCount))){
      const compatible=candidates.filter(i=>this._expectedByteCount(this.pending[i])===Number(response.byteCount));
      if(compatible.length===1)return this.pending.splice(compatible[0],1)[0];
    }
    if(response)response.protocolWarning='Ambiguous RTU response: multiple same Unit/Slave and function requests are outstanding.';
    return null;
  }

  _decorateReadResponse(tx) {
    const d = tx.decoded;
    const r = tx.request;
    if (!r) return;
    const expected=this._expectedByteCount(r);
    if(expected!=null&&Number.isInteger(Number(d.byteCount))&&Number(d.byteCount)!==expected){
      d.protocolWarning=`Read response byte count ${d.byteCount} does not match expected ${expected}.`;
      d.payloadValid=false;
      delete d.registers;delete d.points;
      return;
    }
    d.payloadValid=true;
    let startAddress;
    if (d.functionCode === 3 || d.functionCode === 4) startAddress = r.startAddress;
    if (d.functionCode === 23) startAddress = r.readStartAddress;
    if (startAddress !== undefined && Array.isArray(d.words)) {
      const expectedWords=Number(d.functionCode)===23?r.readQuantity:r.quantity;
      if(Number.isInteger(expectedWords)&&d.words.length!==expectedWords){d.protocolWarning=`Read response contains ${d.words.length} word(s), expected ${expectedWords}.`;d.payloadValid=false;return;}
      d.registers = d.words.map((value, i) => ({ address: startAddress + i, value, hex: `0x${value.toString(16).toUpperCase().padStart(4, '0')}` }));
    }
    if ((d.functionCode === 1 || d.functionCode === 2) && Array.isArray(d.bits)) {
      d.points = d.bits.slice(0, r.quantity).map((value, i) => ({ address: r.startAddress + i, value }));
    }
  }
}

module.exports = { AdvancedTransactionTracker };
