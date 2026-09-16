'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class HistorianError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HistorianError';
    this.code = code;
    this.details = { ...details };
  }
}

function loadSqlite() {
  try {
    const sqlite = require('node:sqlite');
    return sqlite?.DatabaseSync ? sqlite : null;
  } catch {
    return null;
  }
}

function sqliteAvailable() {
  return Boolean(loadSqlite());
}

function jsonEncode(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { __bigint: item.toString() } : item);
}

function jsonDecode(value) {
  if (value == null) return null;
  return JSON.parse(value, (_key, item) => item && typeof item === 'object' && Object.keys(item).length === 1 && typeof item.__bigint === 'string'
    ? BigInt(item.__bigint)
    : item);
}

class SqliteHistorian extends EventEmitter {
  constructor({ filePath, busyTimeoutMs = 5000, wal = true } = {}) {
    super();
    if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('filePath is required');
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) throw new TypeError('busyTimeoutMs must be >= 0');
    const sqlite = loadSqlite();
    if (!sqlite) throw new HistorianError('SQLITE_UNAVAILABLE', 'node:sqlite is not available in this Node.js runtime');
    this.filePath = path.resolve(filePath);
    this.busyTimeoutMs = busyTimeoutMs;
    this.wal = Boolean(wal);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.filePath);
    this.closed = false;
    this._configure();
    this._migrate();
  }

  _configure() {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`PRAGMA busy_timeout = ${this.busyTimeoutMs};`);
    if (this.wal) this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS historian_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR REPLACE INTO historian_meta(key, value) VALUES ('schema_version', '1');
      CREATE TABLE IF NOT EXISTS tags (
        tag_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT,
        source_json TEXT,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS samples (
        sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_id TEXT NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        value_num REAL,
        value_json TEXT,
        quality TEXT NOT NULL,
        raw_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_samples_tag_time ON samples(tag_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_samples_time ON samples(timestamp);
      CREATE TABLE IF NOT EXISTS events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        source TEXT,
        connection_id TEXT,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, timestamp);
    `);
  }

  upsertTag({ tagId, name = null, unit = null, source = null, metadata = null } = {}) {
    this._assertOpen();
    if (typeof tagId !== 'string' || !tagId.trim()) throw new HistorianError('INVALID_TAG', 'tagId is required');
    const id = tagId.trim();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO tags(tag_id, name, unit, source_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tag_id) DO UPDATE SET
        name = excluded.name,
        unit = excluded.unit,
        source_json = excluded.source_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(id, String(name || id), unit == null ? null : String(unit), source == null ? null : jsonEncode(source), metadata == null ? null : jsonEncode(metadata), now, now);
    return this.getTag(id);
  }

  getTag(tagId) {
    this._assertOpen();
    const row = this.db.prepare('SELECT * FROM tags WHERE tag_id = ?').get(String(tagId));
    if (!row) throw new HistorianError('TAG_NOT_FOUND', `Unknown tag ${tagId}`);
    return Object.freeze({
      tagId: row.tag_id,
      name: row.name,
      unit: row.unit,
      source: jsonDecode(row.source_json),
      metadata: jsonDecode(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  listTags() {
    this._assertOpen();
    return Object.freeze(this.db.prepare('SELECT tag_id FROM tags ORDER BY tag_id').all().map((row) => this.getTag(row.tag_id)));
  }

  recordSample({ tagId, timestamp = Date.now(), value, quality = 'good', raw = null } = {}) {
    this._assertOpen();
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw new HistorianError('INVALID_TIMESTAMP', 'timestamp must be finite');
    const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null;
    const encoded = numeric == null ? jsonEncode(value) : null;
    try {
      const info = this.db.prepare('INSERT INTO samples(tag_id, timestamp, value_num, value_json, quality, raw_json) VALUES (?, ?, ?, ?, ?, ?)')
        .run(String(tagId), Math.trunc(ts), numeric, encoded, String(quality || 'unknown'), raw == null ? null : jsonEncode(raw));
      const sample = Object.freeze({ sampleId: Number(info.lastInsertRowid), tagId: String(tagId), timestamp: Math.trunc(ts), value, quality: String(quality || 'unknown'), raw });
      this.emit('sample', sample);
      return sample;
    } catch (error) {
      if (String(error.message).includes('FOREIGN KEY')) throw new HistorianError('TAG_NOT_FOUND', `Tag ${tagId} must be registered before recording samples`);
      throw new HistorianError('SQLITE_WRITE_FAILED', error.message, { cause: error.code || null });
    }
  }

  recordEvent({ timestamp = Date.now(), type, source = null, connectionId = null, details = null } = {}) {
    this._assertOpen();
    if (typeof type !== 'string' || !type.trim()) throw new HistorianError('INVALID_EVENT', 'event type is required');
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw new HistorianError('INVALID_TIMESTAMP', 'timestamp must be finite');
    const info = this.db.prepare('INSERT INTO events(timestamp, type, source, connection_id, details_json) VALUES (?, ?, ?, ?, ?)')
      .run(Math.trunc(ts), type.trim(), source == null ? null : String(source), connectionId == null ? null : String(connectionId), details == null ? null : jsonEncode(details));
    return Object.freeze({ eventId: Number(info.lastInsertRowid), timestamp: Math.trunc(ts), type: type.trim(), source, connectionId, details });
  }

  querySamples(tagId, { from = 0, to = Number.MAX_SAFE_INTEGER, limit = 10000, descending = false } = {}) {
    this._assertOpen();
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000000) throw new HistorianError('INVALID_LIMIT', 'limit must be 1..1000000');
    const order = descending ? 'DESC' : 'ASC';
    const rows = this.db.prepare(`SELECT sample_id, tag_id, timestamp, value_num, value_json, quality, raw_json FROM samples WHERE tag_id = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ${order}, sample_id ${order} LIMIT ?`)
      .all(String(tagId), Math.trunc(Number(from)), Math.trunc(Number(to)), limit);
    return Object.freeze(rows.map((row) => Object.freeze({
      sampleId: Number(row.sample_id),
      tagId: row.tag_id,
      timestamp: row.timestamp,
      value: row.value_num == null ? jsonDecode(row.value_json) : row.value_num,
      quality: row.quality,
      raw: jsonDecode(row.raw_json),
    })));
  }

  queryEvents({ from = 0, to = Number.MAX_SAFE_INTEGER, type = null, limit = 10000 } = {}) {
    this._assertOpen();
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000000) throw new HistorianError('INVALID_LIMIT', 'limit must be 1..1000000');
    const rows = type == null
      ? this.db.prepare('SELECT * FROM events WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC, event_id ASC LIMIT ?').all(Math.trunc(Number(from)), Math.trunc(Number(to)), limit)
      : this.db.prepare('SELECT * FROM events WHERE timestamp >= ? AND timestamp <= ? AND type = ? ORDER BY timestamp ASC, event_id ASC LIMIT ?').all(Math.trunc(Number(from)), Math.trunc(Number(to)), String(type), limit);
    return Object.freeze(rows.map((row) => Object.freeze({
      eventId: Number(row.event_id),
      timestamp: row.timestamp,
      type: row.type,
      source: row.source,
      connectionId: row.connection_id,
      details: jsonDecode(row.details_json),
    })));
  }

  enforceRetention({ olderThan = null, maxSamplesPerTag = null } = {}) {
    this._assertOpen();
    let deleted = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      if (olderThan != null) {
        const info = this.db.prepare('DELETE FROM samples WHERE timestamp < ?').run(Math.trunc(Number(olderThan)));
        deleted += Number(info.changes || 0);
        this.db.prepare('DELETE FROM events WHERE timestamp < ?').run(Math.trunc(Number(olderThan)));
      }
      if (maxSamplesPerTag != null) {
        if (!Number.isInteger(maxSamplesPerTag) || maxSamplesPerTag < 1) throw new HistorianError('INVALID_RETENTION', 'maxSamplesPerTag must be positive');
        const tags = this.db.prepare('SELECT tag_id FROM tags').all();
        const trim = this.db.prepare(`DELETE FROM samples WHERE sample_id IN (
          SELECT sample_id FROM samples WHERE tag_id = ? ORDER BY timestamp DESC, sample_id DESC LIMIT -1 OFFSET ?
        )`);
        for (const tag of tags) deleted += Number(trim.run(tag.tag_id, maxSamplesPerTag).changes || 0);
      }
      this.db.exec('COMMIT;');
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* ignore */ }
      throw error;
    }
    return Object.freeze({ deletedSamples: deleted });
  }

  checkpoint() {
    this._assertOpen();
    if (this.wal) this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
  }

  integrityCheck() {
    this._assertOpen();
    const rows = this.db.prepare('PRAGMA integrity_check;').all();
    const messages = rows.map((row) => Object.values(row)[0]);
    return Object.freeze({ ok: messages.length === 1 && messages[0] === 'ok', messages: Object.freeze(messages) });
  }

  compact() {
    this._assertOpen();
    this.checkpoint();
    this.db.exec('VACUUM;');
  }

  status() {
    this._assertOpen();
    const sampleCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM samples').get().count);
    const eventCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM events').get().count);
    const tagCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM tags').get().count);
    return Object.freeze({ filePath: this.filePath, wal: this.wal, tagCount, sampleCount, eventCount, integrity: this.integrityCheck() });
  }

  close() {
    if (this.closed) return;
    try { this.checkpoint(); } catch { /* close anyway */ }
    this.db.close();
    this.closed = true;
  }

  _assertOpen() {
    if (this.closed) throw new HistorianError('HISTORIAN_CLOSED', 'Historian is closed');
  }
}

module.exports = {
  HistorianError,
  SqliteHistorian,
  sqliteAvailable,
  jsonEncode,
  jsonDecode,
};
