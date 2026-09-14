'use strict';

class TcpTransactionTracker {
  constructor({ requestTimeoutMs = 5000, onTimeout = null, onCollision = null } = {}) {
    this.requestTimeoutMs = Math.max(50, Number(requestTimeoutMs) || 5000);
    this.onTimeout = typeof onTimeout === 'function' ? onTimeout : null;
    this.onCollision = typeof onCollision === 'function' ? onCollision : null;
    // Broken or highly concurrent clients can reuse a TID before the previous
    // request has completed. Keep a FIFO per TID + Unit so nothing is overwritten.
    this.pending = new Map();
    this.collisions = 0;
    this.maxOutstanding = 0;
  }

  _key(frame) { return `${frame.transactionId}:${frame.unitId}`; }

  pendingCount() {
    let total = 0;
    for (const queue of this.pending.values()) total += queue.length;
    return total;
  }

  metrics() {
    return {
      pendingRequests: this.pendingCount(),
      transactionIdCollisions: this.collisions,
      maxOutstanding: this.maxOutstanding
    };
  }

  request(frame, timestamp = Date.now()) {
    this.expire(timestamp);
    const d = {
      ...frame.decoded,
      kind: 'request',
      timestamp,
      transactionId: frame.transactionId,
      unitId: frame.unitId,
      slaveId: frame.unitId
    };
    const key = this._key(frame);
    const queue = this.pending.get(key) || [];
    if (queue.length) {
      this.collisions++;
      this.onCollision?.({
        key,
        transactionId: frame.transactionId,
        unitId: frame.unitId,
        existing: queue.length,
        request: d,
        timestamp
      });
    }
    queue.push(d);
    this.pending.set(key, queue);
    this.maxOutstanding = Math.max(this.maxOutstanding, this.pendingCount());
    return {
      direction: 'REQ',
      decoded: d,
      request: d,
      rttMs: null,
      transport: 'TCP',
      transactionIdCollision: queue.length > 1
    };
  }

  response(frame, timestamp = Date.now()) {
    this.expire(timestamp);
    const key = this._key(frame), queue = this.pending.get(key) || [];
    let req = null;
    if (queue.length) {
      // Function code helps when a broken client reused a TID for different
      // operations. Two identical outstanding requests cannot be distinguished
      // from the wire, so FIFO is the only deterministic safe fallback inside
      // a TCP session where the transaction ID is nevertheless the primary key.
      let index = queue.findIndex(r => Number(r.functionCode) === Number(frame.decoded?.functionCode));
      if (index < 0) index = 0;
      [req] = queue.splice(index, 1);
      if (queue.length) this.pending.set(key, queue); else this.pending.delete(key);
    }
    const d = {
      ...frame.decoded,
      kind: 'response',
      transactionId: frame.transactionId,
      unitId: frame.unitId,
      slaveId: frame.unitId
    };
    const tx = {
      direction: 'RSP',
      decoded: d,
      request: req,
      rttMs: req ? timestamp - req.timestamp : null,
      transport: 'TCP'
    };
    this._decorate(tx);
    return tx;
  }

  expire(now = Date.now()) {
    const expired = [];
    for (const [key, queue] of this.pending) {
      const keep = [];
      for (const request of queue) {
        if (now - request.timestamp > this.requestTimeoutMs) {
          request.outcome = 'timeout';
          request.completedAt = now;
          expired.push(request);
          this.onTimeout?.(request, now, this.requestTimeoutMs, 'TCP');
        } else keep.push(request);
      }
      if (keep.length) this.pending.set(key, keep); else this.pending.delete(key);
    }
    return expired;
  }

  drain(reason = 'connection-closed', now = Date.now()) {
    const unresolved = [];
    for (const queue of this.pending.values()) {
      for (const request of queue) {
        request.outcome = reason;
        request.completedAt = now;
        request.connectionClosed = true;
        unresolved.push(request);
        // Reuse the established missing-response callback so the runtime records
        // a terminal outcome, but the request carries an explicit non-timeout reason.
        this.onTimeout?.(request, now, this.requestTimeoutMs, 'TCP');
      }
    }
    this.pending.clear();
    return unresolved;
  }

  clear() { this.pending.clear(); }

  _expectedByteCount(request) {
    if (!request) return null;
    if ([1,2].includes(Number(request.functionCode)) && Number.isInteger(request.quantity)) return Math.ceil(request.quantity / 8);
    if ([3,4].includes(Number(request.functionCode)) && Number.isInteger(request.quantity)) return request.quantity * 2;
    if (Number(request.functionCode) === 23 && Number.isInteger(request.readQuantity)) return request.readQuantity * 2;
    return null;
  }

  _decorate(tx) {
    const d=tx.decoded,r=tx.request;
    if(!r)return;
    const expected=this._expectedByteCount(r);
    if(expected!=null&&Number.isInteger(Number(d.byteCount))&&Number(d.byteCount)!==expected){
      d.protocolWarning=`Read response byte count ${d.byteCount} does not match expected ${expected}.`;
      d.payloadValid=false;delete d.registers;delete d.points;return;
    }
    d.payloadValid=true;
    let start;
    if([3,4].includes(d.functionCode))start=r.startAddress;
    if(d.functionCode===23)start=r.readStartAddress;
    if(start!==undefined&&Array.isArray(d.words)){
      const expectedWords=Number(d.functionCode)===23?r.readQuantity:r.quantity;
      if(Number.isInteger(expectedWords)&&d.words.length!==expectedWords){d.protocolWarning=`Read response contains ${d.words.length} word(s), expected ${expectedWords}.`;d.payloadValid=false;return;}
      d.registers=d.words.map((value,i)=>({address:start+i,value,hex:`0x${Number(value).toString(16).toUpperCase().padStart(4,'0')}`}));
    }
    if([1,2].includes(d.functionCode)&&Array.isArray(d.bits))d.points=d.bits.slice(0,r.quantity).map((value,i)=>({address:r.startAddress+i,value}));
  }
}

module.exports={TcpTransactionTracker};
