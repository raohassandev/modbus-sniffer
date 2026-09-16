'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChartService } = require('./chartService');
const { RotatingJsonlLogger } = require('./loggerService');
const { SqliteHistorian, sqliteAvailable } = require('./sqliteHistorian');

class HistoryWorkspaceService extends EventEmitter {
  constructor({ store, timeline = null } = {}) {
    super();
    if (!store || typeof store.dataDir !== 'string') throw new TypeError('store with dataDir is required');
    this.store = store;
    this.timeline = timeline;
    this.charts = new ChartService({ maxDocuments: 64, defaultMaxPoints: 20000 });
    this.logger = new RotatingJsonlLogger({
      directory: path.join(store.dataDir, 'history', 'jsonl'),
      prefix: 'modbus-v8',
      maxBytes: 25 * 1024 * 1024,
      retentionFiles: 20,
      rotateDaily: true,
      immediateFlush: false,
    });
    this.historian = null;
    this.historianError = null;
    this.stats = { samplesIngested: 0, eventsRecorded: 0, historianErrors: 0, lastHistorianError: null };

    if (sqliteAvailable()) {
      try {
        this.historian = new SqliteHistorian({ filePath: path.join(store.dataDir, 'history', 'history.sqlite') });
      } catch (error) {
        this.historianError = error;
        this.stats.historianErrors += 1;
        this.stats.lastHistorianError = error.message;
      }
    }

    this.onTimelineEvent = (event) => this.recordEvent(event);
    if (timeline?.on) timeline.on('event', this.onTimelineEvent);
  }

  snapshot() {
    return Object.freeze({
      charts: this.charts.listDocuments(),
      logger: Object.freeze({ ...this.logger.status(), streams: this.logger.listStreams() }),
      historian: this.historian
        ? Object.freeze({ available: true, status: this.historian.status() })
        : Object.freeze({ available: false, reason: this.historianError?.message || 'node:sqlite is unavailable on this Node.js runtime' }),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  ingestSample({ documentId = null, seriesId = null, streamId = null, tagId = null, timestamp = Date.now(), value, quality = 'good', raw = null, metadata = null } = {}) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) throw Object.assign(new Error('timestamp must be finite'), { code: 'INVALID_TIMESTAMP' });
    if (value === undefined) throw Object.assign(new Error('value is required'), { code: 'INVALID_VALUE' });
    const result = { chart: null, logged: null, historian: null };

    if (documentId != null || seriesId != null) {
      if (!documentId || !seriesId) throw Object.assign(new Error('documentId and seriesId are both required for chart ingestion'), { code: 'INVALID_SAMPLE_TARGET' });
      result.chart = this.charts.appendSample(documentId, seriesId, { timestamp: ts, value, quality, raw });
    }
    if (streamId != null) result.logged = this.logger.ingest(streamId, { timestamp: ts, value, quality, metadata });
    if (tagId != null && this.historian) {
      result.historian = this.historian.recordSample({ tagId, timestamp: ts, value, quality });
    }
    if (documentId == null && streamId == null && tagId == null) {
      throw Object.assign(new Error('At least one of documentId/seriesId, streamId or tagId is required'), { code: 'INVALID_SAMPLE_TARGET' });
    }
    this.stats.samplesIngested += 1;
    this.emit('event', Object.freeze({ type: 'history.sample', timestamp: ts, documentId, seriesId, streamId, tagId }));
    return Object.freeze(result);
  }

  recordEvent(event) {
    if (!event || typeof event !== 'object') return false;
    if (!this.historian) return false;
    try {
      this.historian.recordEvent({
        timestamp: Number(event.timestamp || event.at || Date.now()),
        type: String(event.type || 'event'),
        source: String(event.source || 'runtime'),
        connectionId: event.connectionId == null ? null : String(event.connectionId),
        details: event.details && typeof event.details === 'object' ? event.details : null,
      });
      this.stats.eventsRecorded += 1;
      return true;
    } catch (error) {
      this.stats.historianErrors += 1;
      this.stats.lastHistorianError = error.message;
      this.emit('history-error', error);
      return false;
    }
  }

  close() {
    if (this.timeline?.off) this.timeline.off('event', this.onTimelineEvent);
    try { this.logger.close(); } catch { /* best effort */ }
    try { this.historian?.close(); } catch { /* best effort */ }
  }
}

module.exports = { HistoryWorkspaceService };
