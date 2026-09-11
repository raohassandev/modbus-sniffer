'use strict';

const { EventEmitter } = require('events');

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avg(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return value;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function hex(buf) {
  if (!buf) return '';
  return [...buf].map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return hex(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

function serializableDecoded(decoded) {
  if (!decoded) return null;
  const out = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (key === 'raw') continue;
    if (Buffer.isBuffer(value)) out[`${key}Hex`] = hex(value);
    else out[key] = value;
  }
  return out;
}

class RuntimeState extends EventEmitter {
  constructor({ historyLimit = 5000 } = {}) {
    super();
    this.historyLimit = Math.max(100, historyLimit);
    this.startedAt = Date.now();
    this.sequence = 0;
    this.connection = { status: 'idle', path: null, message: null, updatedAt: Date.now() };
    this.config = {};
    this.transactions = [];
    this.registers = new Map();
    this.slaves = new Map();
    this.functions = new Map();
    this.rtts = [];
    this.timeline = new Map();
    this.resetCounters();
  }

  resetCounters() {
    this.frames = 0;
    this.bytes = 0;
    this.noiseBytes = 0;
    this.exceptions = 0;
    this.requests = 0;
    this.responses = 0;
    this.unmatchedResponses = 0;
    this.unknown = 0;
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
    this.emit('config', this.config);
  }

  setConnection(status, details = {}) {
    this.connection = {
      ...this.connection,
      ...details,
      status,
      updatedAt: Date.now()
    };
    this.emit('port', this.connection);
  }

  recordNoise(count) {
    if (!count) return;
    this.noiseBytes += count;
    const bucket = this._bucket(Date.now());
    bucket.noiseBytes += count;
    this.emit('noise', { count, total: this.noiseBytes });
  }

  recordFrame(tx, timestamp, raw, meters = []) {
    this.frames++;
    this.bytes += raw?.length || 0;
    if (tx.direction === 'REQ') this.requests++;
    else if (tx.direction === 'RSP') {
      this.responses++;
      if (!tx.request) this.unmatchedResponses++;
    } else this.unknown++;
    if (tx.decoded?.exception) this.exceptions++;

    if (Number.isFinite(tx.rttMs)) {
      this.rtts.push(tx.rttMs);
      if (this.rtts.length > 2000) this.rtts.splice(0, this.rtts.length - 2000);
    }

    const event = this._buildTransaction(tx, timestamp, raw, meters);
    this.transactions.push(event);
    if (this.transactions.length > this.historyLimit) this.transactions.splice(0, this.transactions.length - this.historyLimit);

    this._recordSlave(event);
    this._recordFunction(event);
    this._recordRegisters(tx, timestamp);
    const bucket = this._bucket(timestamp);
    bucket.frames++;
    bucket.bytes += raw?.length || 0;
    if (tx.decoded?.exception) bucket.exceptions++;

    this.emit('transaction', event);
    return event;
  }

  _buildTransaction(tx, timestamp, raw, meters) {
    const d = tx.decoded || {};
    const r = tx.request || null;
    return {
      id: ++this.sequence,
      timestamp,
      direction: tx.direction,
      slaveId: d.slaveId,
      functionCode: d.functionCode,
      functionName: d.functionName,
      exception: Boolean(d.exception),
      exceptionCode: d.exceptionCode ?? null,
      exceptionName: d.exceptionName ?? null,
      rttMs: Number.isFinite(tx.rttMs) ? tx.rttMs : null,
      matched: tx.direction !== 'RSP' || Boolean(r),
      rawHex: hex(raw),
      byteLength: raw?.length || 0,
      decoded: serializableDecoded(d),
      request: serializableDecoded(r),
      meters: jsonSafe(meters)
    };
  }

  _recordSlave(event) {
    const id = event.slaveId;
    if (id == null) return;
    const s = this.slaves.get(id) || {
      slaveId: id, frames: 0, requests: 0, responses: 0, exceptions: 0,
      unmatchedResponses: 0, bytes: 0, rtts: [], firstSeen: event.timestamp, lastSeen: event.timestamp
    };
    s.frames++;
    s.bytes += event.byteLength;
    if (event.direction === 'REQ') s.requests++;
    if (event.direction === 'RSP') s.responses++;
    if (event.exception) s.exceptions++;
    if (event.direction === 'RSP' && !event.matched) s.unmatchedResponses++;
    if (Number.isFinite(event.rttMs)) {
      s.rtts.push(event.rttMs);
      if (s.rtts.length > 500) s.rtts.shift();
    }
    s.lastSeen = event.timestamp;
    this.slaves.set(id, s);
  }

  _recordFunction(event) {
    const fc = event.functionCode;
    if (fc == null) return;
    const f = this.functions.get(fc) || {
      functionCode: fc, name: event.functionName, frames: 0, requests: 0, responses: 0, exceptions: 0, bytes: 0, lastSeen: event.timestamp
    };
    f.frames++;
    f.bytes += event.byteLength;
    if (event.direction === 'REQ') f.requests++;
    if (event.direction === 'RSP') f.responses++;
    if (event.exception) f.exceptions++;
    f.lastSeen = event.timestamp;
    this.functions.set(fc, f);
  }

  _touchRegister(slaveId, functionCode, address, value, timestamp, kind) {
    if (!Number.isInteger(address)) return;
    const key = `${slaveId}:${functionCode}:${address}`;
    const prev = this.registers.get(key);
    const reg = prev || {
      slaveId, functionCode, address, reads: 0, writes: 0, changes: 0,
      lastValue: null, lastHex: null, min: null, max: null,
      firstSeen: timestamp, lastSeen: timestamp
    };
    if (kind === 'read') reg.reads++;
    if (kind === 'write') reg.writes++;
    if (value != null) {
      if (reg.lastValue != null && reg.lastValue !== value) reg.changes++;
      reg.lastValue = value;
      reg.lastHex = `0x${Number(value).toString(16).toUpperCase().padStart(4, '0')}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        reg.min = reg.min == null ? value : Math.min(reg.min, value);
        reg.max = reg.max == null ? value : Math.max(reg.max, value);
      }
    }
    reg.lastSeen = timestamp;
    this.registers.set(key, reg);
  }

  _recordRegisters(tx, timestamp) {
    const d = tx.decoded || {};
    if (tx.direction === 'RSP' && Array.isArray(d.registers)) {
      for (const reg of d.registers) this._touchRegister(d.slaveId, d.functionCode, reg.address, reg.value, timestamp, 'read');
    }
    if (tx.direction !== 'REQ') return;
    if (d.functionCode === 6 && Number.isInteger(d.address)) {
      this._touchRegister(d.slaveId, d.functionCode, d.address, d.value, timestamp, 'write');
    }
    if (d.functionCode === 16 && Number.isInteger(d.startAddress) && Array.isArray(d.words)) {
      d.words.forEach((value, i) => this._touchRegister(d.slaveId, d.functionCode, d.startAddress + i, value, timestamp, 'write'));
    }
    if (d.functionCode === 23 && Number.isInteger(d.writeStartAddress) && Array.isArray(d.words)) {
      d.words.forEach((value, i) => this._touchRegister(d.slaveId, d.functionCode, d.writeStartAddress + i, value, timestamp, 'write'));
    }
  }

  _bucket(timestamp) {
    const second = Math.floor(timestamp / 1000) * 1000;
    let b = this.timeline.get(second);
    if (!b) {
      b = { timestamp: second, frames: 0, bytes: 0, exceptions: 0, noiseBytes: 0 };
      this.timeline.set(second, b);
      const cutoff = second - 5 * 60 * 1000;
      for (const key of this.timeline.keys()) if (key < cutoff) this.timeline.delete(key);
    }
    return b;
  }

  getStatus() {
    const rttAvg = avg(this.rtts);
    const recent = [...this.timeline.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-60);
    const last10 = recent.filter(x => x.timestamp >= Date.now() - 10000);
    const fps = last10.length ? last10.reduce((s, x) => s + x.frames, 0) / 10 : 0;
    return {
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      connection: this.connection,
      config: this.config,
      totals: {
        frames: this.frames, bytes: this.bytes, noiseBytes: this.noiseBytes,
        requests: this.requests, responses: this.responses, exceptions: this.exceptions,
        unmatchedResponses: this.unmatchedResponses, unknown: this.unknown,
        slaves: this.slaves.size, registers: this.registers.size,
        avgRttMs: round(rttAvg), p95RttMs: percentile(this.rtts, 95), framesPerSecond: round(fps)
      },
      timeline: recent
    };
  }

  getTransactions(filters = {}) {
    const limit = Math.min(5000, Math.max(1, Number(filters.limit) || 500));
    const slave = filters.slave === '' || filters.slave == null ? null : Number(filters.slave);
    const fc = filters.fc === '' || filters.fc == null ? null : Number(filters.fc);
    const direction = filters.direction ? String(filters.direction).toUpperCase() : null;
    const q = filters.q ? String(filters.q).toLowerCase() : null;
    const out = [];
    for (let i = this.transactions.length - 1; i >= 0 && out.length < limit; i--) {
      const t = this.transactions[i];
      if (Number.isFinite(slave) && t.slaveId !== slave) continue;
      if (Number.isFinite(fc) && t.functionCode !== fc) continue;
      if (direction && t.direction !== direction) continue;
      if (q && !`${t.rawHex} ${t.functionName} ${t.exceptionName || ''} ${t.slaveId} ${t.functionCode}`.toLowerCase().includes(q)) continue;
      out.push(t);
    }
    return out.reverse();
  }

  getRegisters(filters = {}) {
    const slave = filters.slave === '' || filters.slave == null ? null : Number(filters.slave);
    const fc = filters.fc === '' || filters.fc == null ? null : Number(filters.fc);
    const q = filters.q ? String(filters.q).toLowerCase() : null;
    const limit = Math.min(10000, Math.max(1, Number(filters.limit) || 2000));
    return [...this.registers.values()]
      .filter(r => !Number.isFinite(slave) || r.slaveId === slave)
      .filter(r => !Number.isFinite(fc) || r.functionCode === fc)
      .filter(r => !q || `${r.address} ${r.lastValue} ${r.lastHex || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.reads + b.writes) - (a.reads + a.writes) || a.address - b.address)
      .slice(0, limit);
  }

  getAnalysis() {
    const slaves = [...this.slaves.values()].map(s => ({
      slaveId: s.slaveId, frames: s.frames, requests: s.requests, responses: s.responses,
      exceptions: s.exceptions, unmatchedResponses: s.unmatchedResponses, bytes: s.bytes,
      avgRttMs: round(avg(s.rtts)), p95RttMs: percentile(s.rtts, 95),
      firstSeen: s.firstSeen, lastSeen: s.lastSeen
    })).sort((a, b) => a.slaveId - b.slaveId);
    const functions = [...this.functions.values()].sort((a, b) => b.frames - a.frames);
    const rttAvg = avg(this.rtts);
    const exceptionRate = this.responses ? this.exceptions / this.responses : 0;
    const unmatchedRate = this.responses ? this.unmatchedResponses / this.responses : 0;
    const noiseRatio = (this.bytes + this.noiseBytes) ? this.noiseBytes / (this.bytes + this.noiseBytes) : 0;
    let score = 100;
    score -= Math.min(35, noiseRatio * 200);
    score -= Math.min(30, exceptionRate * 150);
    score -= Math.min(20, unmatchedRate * 100);
    if (rttAvg != null && rttAvg > 500) score -= Math.min(15, (rttAvg - 500) / 100);
    score = Math.max(0, Math.round(score));

    const registers = this.getRegisters({ limit: 50 });
    const ranges = this._buildRanges();
    return {
      healthScore: score,
      rates: {
        exceptionRate: round(exceptionRate * 100, 3),
        unmatchedResponseRate: round(unmatchedRate * 100, 3),
        noiseRatio: round(noiseRatio * 100, 3)
      },
      rtt: {
        samples: this.rtts.length, avgMs: round(rttAvg), minMs: this.rtts.length ? Math.min(...this.rtts) : null,
        maxMs: this.rtts.length ? Math.max(...this.rtts) : null,
        p50Ms: percentile(this.rtts, 50), p95Ms: percentile(this.rtts, 95), p99Ms: percentile(this.rtts, 99)
      },
      slaves,
      functions,
      topRegisters: registers,
      ranges,
      timeline: [...this.timeline.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-120)
    };
  }

  _buildRanges() {
    const groups = new Map();
    for (const r of this.registers.values()) {
      const key = `${r.slaveId}:${r.functionCode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.address);
    }
    const result = [];
    for (const [key, addresses] of groups) {
      addresses.sort((a, b) => a - b);
      const [slaveId, functionCode] = key.split(':').map(Number);
      let start = null; let prev = null;
      for (const a of addresses) {
        if (start == null) { start = prev = a; continue; }
        if (a === prev || a === prev + 1) { prev = a; continue; }
        result.push({ slaveId, functionCode, startAddress: start, endAddress: prev, count: prev - start + 1 });
        start = prev = a;
      }
      if (start != null) result.push({ slaveId, functionCode, startAddress: start, endAddress: prev, count: prev - start + 1 });
    }
    return result.sort((a, b) => a.slaveId - b.slaveId || a.functionCode - b.functionCode || a.startAddress - b.startAddress);
  }

  clearCapture() {
    this.transactions = [];
    this.registers.clear();
    this.slaves.clear();
    this.functions.clear();
    this.rtts = [];
    this.timeline.clear();
    this.sequence = 0;
    this.startedAt = Date.now();
    this.resetCounters();
    this.emit('clear');
  }
}

module.exports = { RuntimeState, percentile, avg };
