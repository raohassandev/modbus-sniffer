'use strict';

class TcpTransactionTracker {
  constructor({ requestTimeoutMs = 5000, onTimeout = null, onCollision = null } = {}) {
    this.requestTimeoutMs = Math.max(50, Number(requestTimeoutMs) || 5000);
    this.onTimeout = typeof onTimeout === 'function' ? onTimeout : null;
    this.onCollision = typeof onCollision === 'function' ? onCollision : null;
    // One MBAP transaction ID should be unique while outstanding, but broken clients
    // sometimes reuse it. Keep a FIFO per key so no request is silently overwritten.
    this.pending = new Map();
    this.collisions = 0;
  }

  _key(frame) { return `${frame.transactionId}:${frame.unitId}`; }

  pendingCount() {
    let total = 0;
    for (const queue of this.pending.values()) total += queue.length;
    return total;
  }

  request(frame, timestamp = Date.now()) {
    this.expire(timestamp);
    const d = { ...frame.decoded, kind:'request', timestamp, transactionId:frame.transactionId, unitId:frame.unitId, slaveId:frame.unitId };
    const key = this._key(frame);
    const queue = this.pending.get(key) || [];
    if (queue.length) {
      this.collisions++;
      const detail = { key, transactionId:frame.transactionId, unitId:frame.unitId, existing:queue.length, request:d, timestamp };
      this.onCollision?.(detail);
    }
    queue.push(d);
    this.pending.set(key, queue);
    return { direction:'REQ', decoded:d, request:d, rttMs:null, transport:'TCP', transactionIdCollision:queue.length > 1 };
  }

  response(frame, timestamp = Date.now()) {
    this.expire(timestamp);
    const key = this._key(frame), queue = this.pending.get(key) || [];
    let req = null;
    if (queue.length) {
      // Function code is a useful discriminator if a broken client reused a TID for
      // different operations. Fall back to FIFO because the wire cannot disambiguate
      // two truly identical outstanding requests with the same TID + Unit ID.
      let index = queue.findIndex(r => Number(r.functionCode) === Number(frame.decoded?.functionCode));
      if (index < 0) index = 0;
      [req] = queue.splice(index, 1);
      if (queue.length) this.pending.set(key, queue); else this.pending.delete(key);
    }
    const d = { ...frame.decoded, kind:'response', transactionId:frame.transactionId, unitId:frame.unitId, slaveId:frame.unitId };
    const tx = { direction:'RSP', decoded:d, request:req, rttMs:req ? timestamp - req.timestamp : null, transport:'TCP' };
    this._decorate(tx);
    return tx;
  }

  expire(now = Date.now()) {
    const expired = [];
    for (const [key, queue] of this.pending) {
      const keep = [];
      for (const request of queue) {
        if (now - request.timestamp > this.requestTimeoutMs) {
          expired.push(request);
          this.onTimeout?.(request, now, this.requestTimeoutMs, 'TCP');
        } else keep.push(request);
      }
      if (keep.length) this.pending.set(key, keep); else this.pending.delete(key);
    }
    return expired;
  }

  clear() { this.pending.clear(); }

  _decorate(tx) {
    const d=tx.decoded,r=tx.request;
    if(!r)return;
    let start;
    if([3,4].includes(d.functionCode))start=r.startAddress;
    if(d.functionCode===23)start=r.readStartAddress;
    if(start!==undefined&&Array.isArray(d.words))d.registers=d.words.map((value,i)=>({address:start+i,value,hex:`0x${Number(value).toString(16).toUpperCase().padStart(4,'0')}`}));
    if([1,2].includes(d.functionCode)&&Array.isArray(d.bits))d.points=d.bits.slice(0,r.quantity).map((value,i)=>({address:r.startAddress+i,value}));
  }
}

module.exports={TcpTransactionTracker};
