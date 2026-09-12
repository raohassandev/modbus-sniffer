'use strict';

const { EventEmitter } = require('events');
const { analyzeWords } = require('./dataTypeAnalyzer');

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

function median(values) { return percentile(values, 50); }

function stddev(values) {
  if (values.length < 2) return 0;
  const m = avg(values);
  return Math.sqrt(values.reduce((s, v) => s + ((v - m) ** 2), 0) / values.length);
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return value;
  const m = 10 ** digits;
  return Math.round(Number(value) * m) / m;
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
    out[key] = jsonSafe(value);
  }
  return out;
}

function requestDescriptor(d = {}) {
  const fc = Number(d.functionCode);
  const base = { slaveId: Number(d.slaveId), functionCode: fc, operation: 'request', startAddress: null, quantity: null, writeStartAddress: null, writeQuantity: null };
  if ([1, 2, 3, 4, 15, 16].includes(fc)) {
    base.startAddress = Number.isInteger(d.startAddress) ? d.startAddress : null;
    base.quantity = Number.isInteger(d.quantity) ? d.quantity : null;
    base.operation = [15, 16].includes(fc) ? 'write' : 'read';
  } else if ([5, 6, 22].includes(fc)) {
    base.startAddress = Number.isInteger(d.address) ? d.address : null;
    base.quantity = 1;
    base.operation = 'write';
  } else if (fc === 23) {
    base.startAddress = Number.isInteger(d.readStartAddress) ? d.readStartAddress : null;
    base.quantity = Number.isInteger(d.readQuantity) ? d.readQuantity : null;
    base.writeStartAddress = Number.isInteger(d.writeStartAddress) ? d.writeStartAddress : null;
    base.writeQuantity = Number.isInteger(d.writeQuantity) ? d.writeQuantity : null;
    base.operation = 'read/write';
  } else {
    base.operation = 'command';
  }
  base.key = [base.slaveId, fc, base.operation, base.startAddress ?? '-', base.quantity ?? '-', base.writeStartAddress ?? '-', base.writeQuantity ?? '-'].join(':');
  return base;
}

function overlap(startA, qtyA, startB, endB) {
  if (!Number.isInteger(startA) || !Number.isInteger(qtyA) || !Number.isInteger(startB) || !Number.isInteger(endB)) return false;
  const endA = startA + Math.max(0, qtyA - 1);
  return startA <= endB && endA >= startB;
}

class AdvancedRuntimeState extends EventEmitter {
  constructor({ historyLimit = 10000 } = {}) {
    super();
    this.historyLimit = Math.max(100, historyLimit);
    this.config = {};
    this.connection = { status: 'idle', path: null, message: null, updatedAt: Date.now() };
    this.captureSource = 'live';
    this.clearCapture();
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
    this.timeouts = 0;
  }

  setConfig(config) {
    this.config = { ...this.config, ...config };
    this.emit('config', this.config);
  }

  setConnection(status, details = {}) {
    this.connection = { ...this.connection, ...details, status, updatedAt: Date.now() };
    this.emit('port', this.connection);
  }

  setCaptureSource(source) {
    this.captureSource = source || 'live';
  }

  recordNoise(count, timestamp = Date.now()) {
    if (!count) return;
    this.noiseBytes += count;
    const bucket = this._bucket(timestamp);
    bucket.noiseBytes += count;
    this.emit('noise', { count, total: this.noiseBytes });
  }

  recordFrame(tx, timestamp, raw, meters = []) {
    const event = this._buildTransaction(tx, timestamp, raw, meters);
    this._ingestEvent(event, { emit: true, countAsFrame: true });
    return event;
  }

  recordTimeout(request, expiredAt = Date.now(), timeoutMs = 1000) {
    if (!request || request.slaveId == null) return null;
    this.timeouts++;
    const event = {
      id: ++this.sequence,
      timestamp: expiredAt,
      direction: 'TIMEOUT',
      timeout: true,
      timeoutMs,
      slaveId: request.slaveId,
      functionCode: request.functionCode,
      functionName: request.functionName,
      exception: false,
      exceptionCode: null,
      exceptionName: null,
      rttMs: null,
      matched: false,
      rawHex: '',
      byteLength: 0,
      decoded: serializableDecoded(request),
      request: serializableDecoded(request),
      meters: []
    };
    this.transactions.push(event);
    this._trimTransactions();
    const s = this._ensureSlave(event.slaveId, expiredAt);
    s.timeouts++;
    s.lastTimeoutAt = expiredAt;
    const f = this._ensureFunction(event.functionCode, event.functionName, expiredAt);
    f.timeouts++;
    f.lastSeen = expiredAt;
    const descriptor = requestDescriptor(request);
    const pattern = this.pollPatterns.get(descriptor.key);
    if (pattern) {
      pattern.timeouts++;
      pattern.lastTimeoutAt = expiredAt;
      pattern.lastResult = 'timeout';
    }
    const b = this._bucket(expiredAt); b.timeouts++;
    this.emit('transaction', event);
    this.emit('timeout', event);
    return event;
  }

  _buildTransaction(tx, timestamp, raw, meters) {
    const d = tx.decoded || {};
    const r = tx.request || null;
    return {
      id: ++this.sequence,
      timestamp,
      direction: tx.direction,
      timeout: false,
      timeoutMs: null,
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

  _ingestEvent(event, { emit = false, countAsFrame = null } = {}) {
    const e = { ...event };
    if (!Number.isInteger(e.id)) e.id = ++this.sequence;
    else this.sequence = Math.max(this.sequence, e.id);
    if (countAsFrame == null) countAsFrame = e.direction !== 'TIMEOUT';

    if (countAsFrame) {
      this.frames++;
      this.bytes += Number(e.byteLength || 0);
      if (e.direction === 'REQ') this.requests++;
      else if (e.direction === 'RSP') {
        this.responses++;
        if (!e.request) this.unmatchedResponses++;
      } else this.unknown++;
      if (e.exception) this.exceptions++;
      if (Number.isFinite(Number(e.rttMs))) {
        this.rtts.push(Number(e.rttMs));
        if (this.rtts.length > 4000) this.rtts.splice(0, this.rtts.length - 4000);
      }
    }

    if (!this.transactions.includes(e)) {
      this.transactions.push(e);
      this._trimTransactions();
    }

    this._recordSlave(e);
    this._recordFunction(e);
    if (e.direction === 'REQ') this._recordPollRequest(e);
    if (e.direction === 'RSP') this._recordPollResponse(e);
    if (e.direction !== 'TIMEOUT') this._recordRegisters({ direction: e.direction, decoded: e.decoded || {}, request: e.request || null }, e.timestamp);

    const bucket = this._bucket(e.timestamp);
    if (countAsFrame) {
      bucket.frames++;
      bucket.bytes += Number(e.byteLength || 0);
      if (e.exception) bucket.exceptions++;
    }
    if (emit) this.emit('transaction', e);
    return e;
  }

  ingestImportedEvent(event, timestamp = Date.now(), emit = true) {
    const e = { ...event, id: ++this.sequence, timestamp };
    if (e.direction === 'TIMEOUT' || e.timeout) {
      this.timeouts++;
      const s = this._ensureSlave(e.slaveId, timestamp); s.timeouts++; s.lastTimeoutAt = timestamp;
      const descriptor = requestDescriptor(e.request || e.decoded || {});
      const pattern = this.pollPatterns.get(descriptor.key);
      if (pattern) { pattern.timeouts++; pattern.lastTimeoutAt = timestamp; pattern.lastResult = 'timeout'; }
      this.transactions.push(e); this._trimTransactions(); this._bucket(timestamp).timeouts++;
      if (emit) this.emit('transaction', e);
      return e;
    }
    return this._ingestEvent(e, { emit, countAsFrame: true });
  }

  _trimTransactions() {
    if (this.transactions.length > this.historyLimit) this.transactions.splice(0, this.transactions.length - this.historyLimit);
  }

  _ensureSlave(id, timestamp) {
    let s = this.slaves.get(id);
    if (!s) {
      s = { slaveId: id, frames: 0, requests: 0, responses: 0, exceptions: 0, unmatchedResponses: 0, timeouts: 0, bytes: 0, rtts: [], firstSeen: timestamp, lastSeen: timestamp, lastRequestAt: null, lastResponseAt: null, lastTimeoutAt: null, functions: new Set() };
      this.slaves.set(id, s);
    }
    return s;
  }

  _recordSlave(event) {
    const id = event.slaveId;
    if (id == null || event.direction === 'TIMEOUT') return;
    const s = this._ensureSlave(id, event.timestamp);
    s.frames++;
    s.bytes += Number(event.byteLength || 0);
    if (event.direction === 'REQ') { s.requests++; s.lastRequestAt = event.timestamp; }
    if (event.direction === 'RSP') { s.responses++; s.lastResponseAt = event.timestamp; }
    if (event.exception) s.exceptions++;
    if (event.direction === 'RSP' && !event.matched) s.unmatchedResponses++;
    if (Number.isFinite(Number(event.rttMs))) {
      s.rtts.push(Number(event.rttMs));
      if (s.rtts.length > 1000) s.rtts.splice(0, s.rtts.length - 1000);
    }
    if (event.functionCode != null) s.functions.add(event.functionCode);
    s.lastSeen = event.timestamp;
  }

  _ensureFunction(fc, name, timestamp) {
    let f = this.functions.get(fc);
    if (!f) {
      f = { functionCode: fc, name: name || `Function ${fc}`, frames: 0, requests: 0, responses: 0, exceptions: 0, timeouts: 0, bytes: 0, lastSeen: timestamp };
      this.functions.set(fc, f);
    }
    return f;
  }

  _recordFunction(event) {
    const fc = event.functionCode;
    if (fc == null || event.direction === 'TIMEOUT') return;
    const f = this._ensureFunction(fc, event.functionName, event.timestamp);
    f.frames++;
    f.bytes += Number(event.byteLength || 0);
    if (event.direction === 'REQ') f.requests++;
    if (event.direction === 'RSP') f.responses++;
    if (event.exception) f.exceptions++;
    f.lastSeen = event.timestamp;
  }

  _ensurePollPattern(descriptor, timestamp) {
    let p = this.pollPatterns.get(descriptor.key);
    if (!p) {
      p = {
        ...descriptor,
        requests: 0, responses: 0, timeouts: 0, exceptions: 0,
        intervals: [], rtts: [], firstSeen: timestamp, lastRequestAt: null, lastResponseAt: null,
        lastTimeoutAt: null, lastResult: null, lastValues: [], lastRequestId: null
      };
      this.pollPatterns.set(descriptor.key, p);
    }
    return p;
  }

  _recordPollRequest(event) {
    const descriptor = requestDescriptor(event.decoded || {});
    if (!Number.isFinite(descriptor.slaveId) || !Number.isFinite(descriptor.functionCode)) return;
    const p = this._ensurePollPattern(descriptor, event.timestamp);
    if (p.lastRequestAt != null) {
      const dt = event.timestamp - p.lastRequestAt;
      if (dt > 0 && dt < 24 * 60 * 60 * 1000) {
        p.intervals.push(dt);
        if (p.intervals.length > 500) p.intervals.splice(0, p.intervals.length - 500);
      }
    }
    p.requests++;
    p.lastRequestAt = event.timestamp;
    p.lastRequestId = event.id;
    p.lastResult = 'pending';
  }

  _recordPollResponse(event) {
    if (!event.request) return;
    const descriptor = requestDescriptor(event.request);
    const p = this._ensurePollPattern(descriptor, event.request.timestamp || event.timestamp);
    p.responses++;
    p.lastResponseAt = event.timestamp;
    p.lastResult = event.exception ? 'exception' : 'ok';
    if (event.exception) p.exceptions++;
    if (Number.isFinite(Number(event.rttMs))) {
      p.rtts.push(Number(event.rttMs));
      if (p.rtts.length > 500) p.rtts.splice(0, p.rtts.length - 500);
    }
    const regs = event.decoded?.registers;
    if (Array.isArray(regs)) p.lastValues = regs.slice(0, 64).map(x => ({ address: x.address, value: x.value, hex: x.hex || `0x${Number(x.value).toString(16).toUpperCase().padStart(4, '0')}` }));
  }

  _touchRegister(slaveId, functionCode, address, value, timestamp, kind) {
    if (!Number.isInteger(address) || slaveId == null || functionCode == null) return;
    const key = `${slaveId}:${functionCode}:${address}`;
    let reg = this.registers.get(key);
    if (!reg) {
      reg = { slaveId, functionCode, address, reads: 0, writes: 0, changes: 0, lastValue: null, lastHex: null, min: null, max: null, firstSeen: timestamp, lastSeen: timestamp, history: [] };
      this.registers.set(key, reg);
    }
    if (kind === 'read') reg.reads++;
    if (kind === 'write') reg.writes++;
    if (value != null) {
      const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
      if (reg.lastValue != null && reg.lastValue !== numeric) reg.changes++;
      reg.lastValue = numeric;
      reg.lastHex = Number.isFinite(numeric) ? `0x${(numeric & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}` : null;
      if (Number.isFinite(numeric)) {
        reg.min = reg.min == null ? numeric : Math.min(reg.min, numeric);
        reg.max = reg.max == null ? numeric : Math.max(reg.max, numeric);
        reg.history.push({ timestamp, value: numeric });
        if (reg.history.length > 64) reg.history.splice(0, reg.history.length - 64);
      }
    }
    reg.lastSeen = timestamp;
  }

  _recordRegisters(tx, timestamp) {
    const d = tx.decoded || {};
    if (tx.direction === 'RSP' && Array.isArray(d.registers)) {
      for (const reg of d.registers) this._touchRegister(d.slaveId, d.functionCode, reg.address, reg.value, timestamp, 'read');
    }
    if (tx.direction === 'RSP' && Array.isArray(d.points)) {
      for (const point of d.points) this._touchRegister(d.slaveId, d.functionCode, point.address, point.value ? 1 : 0, timestamp, 'read');
    }
    if (tx.direction !== 'REQ') return;
    if ([5, 6].includes(d.functionCode) && Number.isInteger(d.address)) this._touchRegister(d.slaveId, d.functionCode, d.address, d.value, timestamp, 'write');
    if ([15, 16].includes(d.functionCode) && Number.isInteger(d.startAddress) && Array.isArray(d.words)) d.words.forEach((value, i) => this._touchRegister(d.slaveId, d.functionCode, d.startAddress + i, value, timestamp, 'write'));
    if (d.functionCode === 23 && Number.isInteger(d.writeStartAddress) && Array.isArray(d.words)) d.words.forEach((value, i) => this._touchRegister(d.slaveId, d.functionCode, d.writeStartAddress + i, value, timestamp, 'write'));
  }

  _bucket(timestamp) {
    const second = Math.floor(timestamp / 1000) * 1000;
    let b = this.timeline.get(second);
    if (!b) {
      b = { timestamp: second, frames: 0, bytes: 0, exceptions: 0, noiseBytes: 0, timeouts: 0 };
      this.timeline.set(second, b);
      const cutoff = second - 15 * 60 * 1000;
      for (const key of this.timeline.keys()) if (key < cutoff) this.timeline.delete(key);
    }
    return b;
  }

  _pollView(p) {
    const intervals = p.intervals || [];
    const rtts = p.rtts || [];
    const med = median(intervals);
    const sd = stddev(intervals);
    return {
      key: p.key,
      slaveId: p.slaveId,
      functionCode: p.functionCode,
      operation: p.operation,
      startAddress: p.startAddress,
      quantity: p.quantity,
      endAddress: Number.isInteger(p.startAddress) && Number.isInteger(p.quantity) ? p.startAddress + p.quantity - 1 : null,
      writeStartAddress: p.writeStartAddress,
      writeQuantity: p.writeQuantity,
      requests: p.requests,
      responses: p.responses,
      timeouts: p.timeouts,
      exceptions: p.exceptions,
      responseRate: p.requests ? round((p.responses / p.requests) * 100, 2) : 0,
      timeoutRate: p.requests ? round((p.timeouts / p.requests) * 100, 2) : 0,
      avgIntervalMs: round(avg(intervals)),
      medianIntervalMs: round(med),
      p95IntervalMs: round(percentile(intervals, 95)),
      minIntervalMs: intervals.length ? Math.min(...intervals) : null,
      maxIntervalMs: intervals.length ? Math.max(...intervals) : null,
      jitterMs: round(sd),
      jitterPct: med ? round((sd / med) * 100, 2) : null,
      avgRttMs: round(avg(rtts)),
      p95RttMs: round(percentile(rtts, 95)),
      firstSeen: p.firstSeen,
      lastRequestAt: p.lastRequestAt,
      lastResponseAt: p.lastResponseAt,
      lastTimeoutAt: p.lastTimeoutAt,
      lastResult: p.lastResult,
      lastValues: p.lastValues || []
    };
  }

  getPollGroups(filters = {}) {
    const slave = filters.slave == null || filters.slave === '' ? null : Number(filters.slave);
    const fc = filters.fc == null || filters.fc === '' ? null : Number(filters.fc);
    return [...this.pollPatterns.values()].map(p => this._pollView(p))
      .filter(p => !Number.isFinite(slave) || p.slaveId === slave)
      .filter(p => !Number.isFinite(fc) || p.functionCode === fc)
      .sort((a, b) => a.slaveId - b.slaveId || a.functionCode - b.functionCode || (a.startAddress ?? 0) - (b.startAddress ?? 0));
  }

  _buildRanges(slaveFilter = null) {
    const groups = new Map();
    for (const r of this.registers.values()) {
      if (slaveFilter != null && r.slaveId !== Number(slaveFilter)) continue;
      const key = `${r.slaveId}:${r.functionCode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.address);
    }
    const result = [];
    for (const [key, addresses] of groups) {
      addresses.sort((a, b) => a - b);
      const [slaveId, functionCode] = key.split(':').map(Number);
      let start = null; let prev = null;
      for (const address of addresses) {
        if (start == null) { start = prev = address; continue; }
        if (address <= prev + 1) { prev = Math.max(prev, address); continue; }
        result.push({ slaveId, functionCode, startAddress: start, endAddress: prev, count: prev - start + 1 });
        start = prev = address;
      }
      if (start != null) result.push({ slaveId, functionCode, startAddress: start, endAddress: prev, count: prev - start + 1 });
    }
    return result.sort((a, b) => a.slaveId - b.slaveId || a.functionCode - b.functionCode || a.startAddress - b.startAddress);
  }

  getRegisters(filters = {}) {
    const slave = filters.slave == null || filters.slave === '' ? null : Number(filters.slave);
    const fc = filters.fc == null || filters.fc === '' ? null : Number(filters.fc);
    const q = filters.q ? String(filters.q).toLowerCase() : null;
    const limit = Math.min(20000, Math.max(1, Number(filters.limit) || 5000));
    const polls = this.getPollGroups({ slave, fc });
    return [...this.registers.values()]
      .filter(r => !Number.isFinite(slave) || r.slaveId === slave)
      .filter(r => !Number.isFinite(fc) || r.functionCode === fc)
      .filter(r => !q || `${r.address} ${r.lastValue} ${r.lastHex || ''}`.toLowerCase().includes(q))
      .map(r => {
        const related = polls.filter(p => p.slaveId === r.slaveId && p.functionCode === r.functionCode && overlap(p.startAddress, p.quantity, r.address, r.address));
        const intervals = related.map(p => p.medianIntervalMs).filter(Number.isFinite);
        return { ...r, history: undefined, samples: r.history.length, pollIntervalMs: intervals.length ? round(median(intervals)) : null };
      })
      .sort((a, b) => a.slaveId - b.slaveId || a.functionCode - b.functionCode || a.address - b.address)
      .slice(0, limit);
  }

  _deviceSummary(slave) {
    const id = slave.slaveId;
    const polls = this.getPollGroups({ slave: id });
    const regs = [...this.registers.values()].filter(r => r.slaveId === id);
    const intervals = polls.map(p => p.medianIntervalMs).filter(Number.isFinite);
    const expected = intervals.length ? median(intervals) : null;
    const now = Date.now();
    const silenceLimit = Math.max(3000, Number(expected || 0) * 3);
    const status = now - slave.lastSeen <= silenceLimit ? 'online' : now - slave.lastSeen <= silenceLimit * 3 ? 'silent' : 'offline';
    const timeoutRate = slave.requests ? slave.timeouts / slave.requests : 0;
    const exceptionRate = slave.responses ? slave.exceptions / slave.responses : 0;
    const unmatchedRate = slave.responses ? slave.unmatchedResponses / slave.responses : 0;
    const p95 = percentile(slave.rtts, 95);
    let health = 100;
    health -= Math.min(45, timeoutRate * 180);
    health -= Math.min(25, exceptionRate * 160);
    health -= Math.min(15, unmatchedRate * 100);
    if (p95 != null && p95 > 500) health -= Math.min(15, (p95 - 500) / 100);
    if (status === 'silent') health -= 10;
    if (status === 'offline') health -= 30;
    const reads = regs.reduce((s, r) => s + r.reads, 0);
    const writes = regs.reduce((s, r) => s + r.writes, 0);
    return {
      slaveId: id,
      name: `Slave ${id}`,
      status,
      healthScore: Math.max(0, Math.round(health)),
      frames: slave.frames,
      requests: slave.requests,
      responses: slave.responses,
      timeouts: slave.timeouts,
      timeoutRate: round(timeoutRate * 100, 2),
      exceptions: slave.exceptions,
      exceptionRate: round(exceptionRate * 100, 2),
      unmatchedResponses: slave.unmatchedResponses,
      registerCount: regs.length,
      readCount: reads,
      writeCount: writes,
      pollGroupCount: polls.length,
      expectedPollIntervalMs: round(expected),
      avgRttMs: round(avg(slave.rtts)),
      p95RttMs: round(p95),
      functions: [...slave.functions].sort((a, b) => a - b),
      firstSeen: slave.firstSeen,
      lastSeen: slave.lastSeen,
      lastRequestAt: slave.lastRequestAt,
      lastResponseAt: slave.lastResponseAt,
      lastTimeoutAt: slave.lastTimeoutAt
    };
  }

  getDevices() {
    return [...this.slaves.values()].map(s => this._deviceSummary(s)).sort((a, b) => a.slaveId - b.slaveId);
  }

  getDevice(slaveId) {
    const id = Number(slaveId);
    const slave = this.slaves.get(id);
    if (!slave) return null;
    const summary = this._deviceSummary(slave);
    const polls = this.getPollGroups({ slave: id });
    const registers = this.getRegisters({ slave: id, limit: 20000 });
    const ranges = this._buildRanges(id).map(range => {
      const related = polls.filter(p => p.functionCode === range.functionCode && overlap(p.startAddress, p.quantity, range.startAddress, range.endAddress));
      const intervals = related.map(p => p.medianIntervalMs).filter(Number.isFinite);
      const values = registers.filter(r => r.functionCode === range.functionCode && r.address >= range.startAddress && r.address <= range.endAddress).slice(0, 24).map(r => ({ address: r.address, value: r.lastValue, hex: r.lastHex }));
      return { ...range, pollIntervalMs: intervals.length ? round(median(intervals)) : null, pollGroups: related.length, values };
    });
    const recentTransactions = this.getTransactions({ slave: id, limit: 100 });
    const issues = [];
    if (summary.timeouts) issues.push({ severity: summary.timeoutRate > 5 ? 'bad' : 'warn', title: 'Missing responses', detail: `${summary.timeouts} request timeout(s), ${summary.timeoutRate}% of requests.` });
    if (summary.exceptions) issues.push({ severity: summary.exceptionRate > 2 ? 'bad' : 'warn', title: 'Modbus exceptions', detail: `${summary.exceptions} exception response(s), ${summary.exceptionRate}% of responses.` });
    if (summary.p95RttMs != null && summary.p95RttMs > 500) issues.push({ severity: 'warn', title: 'Slow response tail', detail: `P95 RTT ${summary.p95RttMs} ms.` });
    for (const p of polls) if (p.jitterPct != null && p.jitterPct > 30 && p.requests >= 5) issues.push({ severity: 'warn', title: 'Polling jitter', detail: `FC${p.functionCode} ${p.startAddress ?? '-'} interval jitter ${p.jitterPct}%.` });
    return { summary, polls, registerGroups: ranges, registers, recentTransactions, issues };
  }

  getTransactions(filters = {}) {
    const limit = Math.min(20000, Math.max(1, Number(filters.limit) || 1000));
    const slave = filters.slave == null || filters.slave === '' ? null : Number(filters.slave);
    const fc = filters.fc == null || filters.fc === '' ? null : Number(filters.fc);
    const direction = filters.direction ? String(filters.direction).toUpperCase() : null;
    const q = filters.q ? String(filters.q).toLowerCase() : null;
    const out = [];
    for (let i = this.transactions.length - 1; i >= 0 && out.length < limit; i--) {
      const t = this.transactions[i];
      if (Number.isFinite(slave) && t.slaveId !== slave) continue;
      if (Number.isFinite(fc) && t.functionCode !== fc) continue;
      if (direction && t.direction !== direction) continue;
      if (q && !`${t.rawHex || ''} ${t.functionName || ''} ${t.exceptionName || ''} ${t.slaveId} ${t.functionCode} ${t.direction} ${JSON.stringify(t.decoded || {})}`.toLowerCase().includes(q)) continue;
      out.push(t);
    }
    return out.reverse();
  }

  getDataTypeAnalysis({ slave, fc, address, count = 4 } = {}) {
    const slaveId = Number(slave);
    const functionCode = fc == null || fc === '' ? null : Number(fc);
    const start = Number(address);
    const qty = Math.max(1, Math.min(4, Number(count) || 4));
    if (!Number.isInteger(slaveId) || !Number.isInteger(start)) return { words: [], interpretations: [], error: 'slave and address are required' };
    const words = [];
    let chosenFc = functionCode;
    for (let i = 0; i < qty; i++) {
      let reg = null;
      if (Number.isFinite(chosenFc)) reg = this.registers.get(`${slaveId}:${chosenFc}:${start + i}`);
      if (!reg) {
        const candidates = [...this.registers.values()].filter(r => r.slaveId === slaveId && r.address === start + i).sort((a, b) => ([3, 4, 6, 16, 23].indexOf(a.functionCode) - [3, 4, 6, 16, 23].indexOf(b.functionCode)));
        reg = candidates[0];
        if (reg && !Number.isFinite(chosenFc)) chosenFc = reg.functionCode;
      }
      if (!reg || !Number.isFinite(Number(reg.lastValue))) break;
      words.push(Number(reg.lastValue) & 0xFFFF);
    }
    return { slaveId, functionCode: chosenFc, startAddress: start, ...analyzeWords(words) };
  }

  getStatus() {
    const recent = [...this.timeline.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-60);
    const last10 = recent.filter(x => x.timestamp >= Date.now() - 10000);
    const fps = last10.length ? last10.reduce((s, x) => s + x.frames, 0) / 10 : 0;
    return {
      startedAt: this.startedAt,
      uptimeMs: Date.now() - this.startedAt,
      connection: this.connection,
      config: this.config,
      captureSource: this.captureSource,
      totals: {
        frames: this.frames, bytes: this.bytes, noiseBytes: this.noiseBytes, requests: this.requests, responses: this.responses,
        exceptions: this.exceptions, timeouts: this.timeouts, unmatchedResponses: this.unmatchedResponses, unknown: this.unknown,
        slaves: this.slaves.size, devices: this.slaves.size, registers: this.registers.size, pollGroups: this.pollPatterns.size,
        avgRttMs: round(avg(this.rtts)), p95RttMs: round(percentile(this.rtts, 95)), framesPerSecond: round(fps)
      },
      timeline: recent
    };
  }

  getAnalysis() {
    const devices = this.getDevices();
    const functions = [...this.functions.values()].map(f => ({ ...f })).sort((a, b) => b.frames - a.frames);
    const polls = this.getPollGroups();
    const exceptionRate = this.responses ? this.exceptions / this.responses : 0;
    const unmatchedRate = this.responses ? this.unmatchedResponses / this.responses : 0;
    const timeoutRate = this.requests ? this.timeouts / this.requests : 0;
    const noiseRatio = (this.bytes + this.noiseBytes) ? this.noiseBytes / (this.bytes + this.noiseBytes) : 0;
    const rttAvg = avg(this.rtts);
    let score = 100;
    score -= Math.min(30, noiseRatio * 200);
    score -= Math.min(25, exceptionRate * 150);
    score -= Math.min(25, timeoutRate * 180);
    score -= Math.min(10, unmatchedRate * 100);
    if (rttAvg != null && rttAvg > 500) score -= Math.min(10, (rttAvg - 500) / 100);
    const highJitter = polls.filter(p => p.jitterPct != null && p.jitterPct > 30 && p.requests >= 5).length;
    if (highJitter) score -= Math.min(10, highJitter * 2);
    score = Math.max(0, Math.round(score));
    return {
      healthScore: score,
      rates: {
        exceptionRate: round(exceptionRate * 100, 3),
        timeoutRate: round(timeoutRate * 100, 3),
        unmatchedResponseRate: round(unmatchedRate * 100, 3),
        noiseRatio: round(noiseRatio * 100, 3)
      },
      rtt: {
        samples: this.rtts.length, avgMs: round(rttAvg), minMs: this.rtts.length ? Math.min(...this.rtts) : null,
        maxMs: this.rtts.length ? Math.max(...this.rtts) : null, p50Ms: round(percentile(this.rtts, 50)), p95Ms: round(percentile(this.rtts, 95)), p99Ms: round(percentile(this.rtts, 99))
      },
      devices,
      slaves: devices,
      functions,
      polls,
      ranges: this._buildRanges(),
      topRegisters: this.getRegisters({ limit: 100 }),
      highJitterPolls: highJitter,
      timeline: [...this.timeline.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-180)
    };
  }

  exportCapture() {
    return {
      format: 'mbcap',
      version: 1,
      createdAt: new Date().toISOString(),
      config: this.config,
      totals: this.getStatus().totals,
      transactions: this.transactions.map(t => jsonSafe(t))
    };
  }

  loadCapture(capture, { emit = false } = {}) {
    if (!capture || !Array.isArray(capture.transactions)) throw new Error('Invalid capture file: transactions array is missing.');
    const events = capture.transactions;
    this.clearCapture();
    this.captureSource = 'capture';
    for (const source of events) {
      const event = { ...source, id: ++this.sequence };
      if (event.direction === 'TIMEOUT' || event.timeout) {
        this.timeouts++;
        this.transactions.push(event);
        const s = this._ensureSlave(event.slaveId, event.timestamp); s.timeouts++; s.lastTimeoutAt = event.timestamp;
        const descriptor = requestDescriptor(event.request || event.decoded || {});
        const p = this.pollPatterns.get(descriptor.key); if (p) p.timeouts++;
        this._bucket(event.timestamp).timeouts++;
        if (emit) this.emit('transaction', event);
      } else {
        this._ingestEvent(event, { emit, countAsFrame: true });
      }
    }
    if (Number.isFinite(Number(capture.totals?.noiseBytes))) this.noiseBytes = Number(capture.totals.noiseBytes);
    this.emit('capture-loaded', { transactions: events.length });
    return this.getStatus();
  }

  clearCapture() {
    this.startedAt = Date.now();
    this.sequence = 0;
    this.transactions = [];
    this.registers = new Map();
    this.slaves = new Map();
    this.functions = new Map();
    this.pollPatterns = new Map();
    this.rtts = [];
    this.timeline = new Map();
    this.captureSource = 'live';
    this.resetCounters();
    this.emit?.('clear');
  }
}

module.exports = { AdvancedRuntimeState, percentile, avg, median, stddev, requestDescriptor };
