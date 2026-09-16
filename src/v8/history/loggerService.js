'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class LoggerServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LoggerServiceError';
    this.code = code;
    this.details = { ...details };
  }
}

function sanitizeFilePart(value) {
  return String(value || 'log').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'log';
}

function normalizeMode(mode) {
  if (!['every', 'fixed', 'change-only'].includes(mode)) throw new LoggerServiceError('INVALID_MODE', 'mode must be every, fixed or change-only');
  return mode;
}

class RotatingJsonlLogger extends EventEmitter {
  constructor({
    directory,
    prefix = 'modbus',
    maxBytes = 25 * 1024 * 1024,
    retentionFiles = 20,
    rotateDaily = true,
    immediateFlush = false,
    clock = () => Date.now(),
  } = {}) {
    super();
    if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('directory is required');
    if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new TypeError('maxBytes must be >= 1024');
    if (!Number.isInteger(retentionFiles) || retentionFiles < 1) throw new TypeError('retentionFiles must be positive');
    this.directory = path.resolve(directory);
    this.prefix = sanitizeFilePart(prefix);
    this.maxBytes = maxBytes;
    this.retentionFiles = retentionFiles;
    this.rotateDaily = Boolean(rotateDaily);
    this.immediateFlush = Boolean(immediateFlush);
    this.clock = clock;
    this.streams = new Map();
    this.fd = null;
    this.currentPath = null;
    this.currentDay = null;
    this.currentBytes = 0;
    this.fileSequence = 0;
    this.closed = false;
    this.stats = { accepted: 0, written: 0, skipped: 0, rotations: 0, errors: 0, lastError: null };
    fs.mkdirSync(this.directory, { recursive: true });
  }

  addStream({ streamId, source = null, mode = 'every', intervalMs = 1000 } = {}) {
    if (typeof streamId !== 'string' || !streamId.trim()) throw new LoggerServiceError('INVALID_STREAM', 'streamId is required');
    if (this.streams.has(streamId)) throw new LoggerServiceError('STREAM_EXISTS', `Stream ${streamId} already exists`);
    mode = normalizeMode(mode);
    if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new LoggerServiceError('INVALID_INTERVAL', 'intervalMs must be >= 1');
    const stream = {
      streamId: streamId.trim(),
      source: source && typeof source === 'object' ? { ...source } : null,
      mode,
      intervalMs,
      lastLoggedAt: null,
      lastValueKey: null,
      enabled: true,
    };
    this.streams.set(stream.streamId, stream);
    return this.getStream(stream.streamId);
  }

  updateStream(streamId, patch = {}) {
    const stream = this._getStream(streamId);
    if (patch.mode != null) stream.mode = normalizeMode(patch.mode);
    if (patch.intervalMs != null) {
      if (!Number.isFinite(patch.intervalMs) || patch.intervalMs < 1) throw new LoggerServiceError('INVALID_INTERVAL', 'intervalMs must be >= 1');
      stream.intervalMs = patch.intervalMs;
    }
    if (patch.enabled != null) stream.enabled = Boolean(patch.enabled);
    if (patch.source != null) stream.source = patch.source && typeof patch.source === 'object' ? { ...patch.source } : null;
    return this.getStream(streamId);
  }

  removeStream(streamId) {
    if (!this.streams.delete(streamId)) throw new LoggerServiceError('STREAM_NOT_FOUND', `Unknown stream ${streamId}`);
  }

  ingest(streamId, { timestamp = this.clock(), value, quality = 'good', metadata = null } = {}) {
    if (this.closed) throw new LoggerServiceError('LOGGER_CLOSED', 'Logger is closed');
    const stream = this._getStream(streamId);
    this.stats.accepted += 1;
    if (!stream.enabled) {
      this.stats.skipped += 1;
      return false;
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw new LoggerServiceError('INVALID_TIMESTAMP', 'timestamp must be finite');
    const valueKey = JSON.stringify(value);
    const dueByInterval = stream.lastLoggedAt == null || ts - stream.lastLoggedAt >= stream.intervalMs;
    const changed = stream.lastValueKey == null || stream.lastValueKey !== valueKey;
    const shouldLog = stream.mode === 'every' || (stream.mode === 'fixed' && dueByInterval) || (stream.mode === 'change-only' && changed);
    if (!shouldLog) {
      this.stats.skipped += 1;
      return false;
    }

    const record = Object.freeze({
      timestamp: ts,
      streamId: stream.streamId,
      source: stream.source ? { ...stream.source } : null,
      value,
      quality: String(quality || 'unknown'),
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : null,
    });
    const line = `${JSON.stringify(record)}\n`;
    try {
      this._ensureFile(ts, Buffer.byteLength(line));
      fs.writeSync(this.fd, line, null, 'utf8');
      this.currentBytes += Buffer.byteLength(line);
      if (this.immediateFlush) fs.fsyncSync(this.fd);
      stream.lastLoggedAt = ts;
      stream.lastValueKey = valueKey;
      this.stats.written += 1;
      this.emit('sample', record);
      return true;
    } catch (error) {
      this.stats.errors += 1;
      this.stats.lastError = error.message;
      this.emit('logger-error', error);
      throw new LoggerServiceError('WRITE_FAILED', error.message, { cause: error.code || null, path: this.currentPath });
    }
  }

  flush() {
    if (this.fd != null) fs.fsyncSync(this.fd);
  }

  close() {
    if (this.closed) return;
    try { this.flush(); } catch { /* preserve close */ }
    if (this.fd != null) fs.closeSync(this.fd);
    this.fd = null;
    this.closed = true;
  }

  reopen() {
    if (!this.closed) return;
    this.closed = false;
    this.currentPath = null;
    this.currentDay = null;
    this.currentBytes = 0;
  }

  getStream(streamId) {
    const stream = this._getStream(streamId);
    return Object.freeze({
      streamId: stream.streamId,
      source: stream.source ? Object.freeze({ ...stream.source }) : null,
      mode: stream.mode,
      intervalMs: stream.intervalMs,
      enabled: stream.enabled,
      lastLoggedAt: stream.lastLoggedAt,
    });
  }

  listStreams() {
    return Object.freeze([...this.streams.keys()].map((id) => this.getStream(id)));
  }

  status() {
    return Object.freeze({
      directory: this.directory,
      currentPath: this.currentPath,
      currentBytes: this.currentBytes,
      closed: this.closed,
      immediateFlush: this.immediateFlush,
      streamCount: this.streams.size,
      stats: Object.freeze({ ...this.stats }),
    });
  }

  _getStream(streamId) {
    const stream = this.streams.get(streamId);
    if (!stream) throw new LoggerServiceError('STREAM_NOT_FOUND', `Unknown stream ${streamId}`);
    return stream;
  }

  _ensureFile(timestamp, incomingBytes) {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    const mustRotate = this.fd == null
      || (this.rotateDaily && this.currentDay !== day)
      || this.currentBytes + incomingBytes > this.maxBytes;
    if (!mustRotate) return;
    this._rotate(day);
  }

  _rotate(day) {
    if (this.fd != null) {
      try { fs.fsyncSync(this.fd); } catch { /* best effort */ }
      fs.closeSync(this.fd);
      this.fd = null;
    }
    const stamp = new Date(this.clock()).toISOString().replace(/[:.]/g, '-');
    const fileName = `${this.prefix}-${day}-${stamp}-${++this.fileSequence}.jsonl`;
    this.currentPath = path.join(this.directory, fileName);
    this.fd = fs.openSync(this.currentPath, 'a');
    this.currentDay = day;
    this.currentBytes = fs.statSync(this.currentPath).size;
    this.stats.rotations += 1;
    this._enforceRetention();
    this.emit('rotated', Object.freeze({ path: this.currentPath, day }));
  }

  _enforceRetention() {
    const files = fs.readdirSync(this.directory)
      .filter((name) => name.startsWith(`${this.prefix}-`) && name.endsWith('.jsonl'))
      .map((name) => ({ name, full: path.join(this.directory, name), stat: fs.statSync(path.join(this.directory, name)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const file of files.slice(this.retentionFiles)) {
      if (file.full === this.currentPath) continue;
      try { fs.unlinkSync(file.full); } catch (error) {
        this.stats.errors += 1;
        this.stats.lastError = error.message;
        this.emit('logger-error', error);
      }
    }
  }
}

module.exports = {
  LoggerServiceError,
  RotatingJsonlLogger,
  normalizeMode,
};
