'use strict';

const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const ERROR_TYPE = /(error|timeout|malformed|exception|failed|failure)/i;

class TrafficTimelineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TrafficTimelineError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TrafficTimelineError);
  }
}

function finiteInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function normalizeHex(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || Array.isArray(value)) return Buffer.from(value).toString('hex').toUpperCase();
  const text = String(value).replace(/[^0-9a-f]/gi, '').toUpperCase();
  return text || null;
}

function clonePlain(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current));
}

function normalizeEvent(input, sequence) {
  if (!input || typeof input !== 'object') throw new TrafficTimelineError('INVALID_EVENT', 'Traffic event must be an object');
  const timestamp = Number(input.timestamp ?? input.at ?? Date.now());
  const type = String(input.type || 'runtime.event');
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details) ? clonePlain(input.details) : {};
  const functionCodeCandidate = input.functionCode ?? details.functionCode ?? null;
  const unitCandidate = input.unitId ?? details.unitId ?? null;
  const functionCode = functionCodeCandidate == null ? null : Number(functionCodeCandidate);
  const unitId = unitCandidate == null ? null : Number(unitCandidate);
  const rawHex = normalizeHex(input.rawHex ?? input.raw ?? details.rawHex ?? null);
  const error = Boolean(
    input.error
    || details.error
    || details.errorCode
    || details.exception
    || (Number.isInteger(functionCode) && (functionCode & 0x80) !== 0)
    || ERROR_TYPE.test(type),
  );
  return Object.freeze({
    sequence,
    eventId: String(input.eventId || `traffic-${sequence}-${randomUUID()}`),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    type,
    source: String(input.source || 'runtime'),
    connectionId: input.connectionId == null ? null : String(input.connectionId),
    channelId: input.channelId == null ? null : String(input.channelId),
    ownerMode: input.ownerMode == null ? null : String(input.ownerMode),
    direction: ['tx', 'rx'].includes(String(input.direction || '').toLowerCase()) ? String(input.direction).toLowerCase() : null,
    unitId: Number.isInteger(unitId) && unitId >= 0 && unitId <= 255 ? unitId : null,
    functionCode: Number.isInteger(functionCode) && functionCode >= 0 && functionCode <= 255 ? functionCode : null,
    rawHex,
    error,
    details: Object.freeze(details),
  });
}

class TrafficTimelineService extends EventEmitter {
  constructor({ maxEvents = 20000, maxBookmarks = 2000 } = {}) {
    super();
    if (!Number.isInteger(maxEvents) || maxEvents < 100 || maxEvents > 1_000_000) throw new TypeError('maxEvents must be 100..1000000');
    if (!Number.isInteger(maxBookmarks) || maxBookmarks < 1 || maxBookmarks > maxEvents) throw new TypeError('maxBookmarks must be 1..maxEvents');
    this.maxEvents = maxEvents;
    this.maxBookmarks = maxBookmarks;
    this.events = [];
    this.bookmarks = new Map();
    this.sequence = 0;
    this.dropped = 0;
    this.ingested = 0;
  }

  ingest(input) {
    const event = normalizeEvent(input, ++this.sequence);
    this.events.push(event);
    this.ingested += 1;
    if (this.events.length > this.maxEvents) {
      const removed = this.events.splice(0, this.events.length - this.maxEvents);
      this.dropped += removed.length;
      for (const item of removed) this.bookmarks.delete(item.eventId);
    }
    this.emit('event', event);
    return event;
  }

  query(filters = {}) {
    const limit = finiteInteger(filters.limit, 500, 1, Math.min(this.maxEvents, 5000));
    const afterSequence = finiteInteger(filters.afterSequence, 0, 0, Number.MAX_SAFE_INTEGER);
    const connectionId = filters.connectionId == null || filters.connectionId === '' ? null : String(filters.connectionId);
    const ownerMode = filters.ownerMode == null || filters.ownerMode === '' ? null : String(filters.ownerMode).toLowerCase();
    const direction = filters.direction == null || filters.direction === '' ? null : String(filters.direction).toLowerCase();
    const source = filters.source == null || filters.source === '' ? null : String(filters.source).toLowerCase();
    const unitId = filters.unitId == null || filters.unitId === '' ? null : Number(filters.unitId);
    const functionCode = filters.functionCode == null || filters.functionCode === '' ? null : Number(filters.functionCode);
    const errorOnly = filters.errorOnly === true || String(filters.errorOnly || '').toLowerCase() === 'true';
    const bookmarkedOnly = filters.bookmarkedOnly === true || String(filters.bookmarkedOnly || '').toLowerCase() === 'true';
    const rawSearch = normalizeHex(filters.rawSearch);
    const text = String(filters.text || '').trim().toLowerCase();

    const rows = [];
    for (let index = this.events.length - 1; index >= 0 && rows.length < limit; index -= 1) {
      const event = this.events[index];
      if (event.sequence <= afterSequence) continue;
      if (connectionId && event.connectionId !== connectionId) continue;
      if (ownerMode && String(event.ownerMode || '').toLowerCase() !== ownerMode) continue;
      if (direction && event.direction !== direction) continue;
      if (source && String(event.source || '').toLowerCase() !== source) continue;
      if (Number.isInteger(unitId) && event.unitId !== unitId) continue;
      if (Number.isInteger(functionCode) && event.functionCode !== functionCode) continue;
      if (errorOnly && !event.error) continue;
      if (bookmarkedOnly && !this.bookmarks.has(event.eventId)) continue;
      if (rawSearch && !(event.rawHex || '').includes(rawSearch)) continue;
      if (text) {
        const haystack = `${event.type} ${event.source} ${event.connectionId || ''} ${event.ownerMode || ''} ${JSON.stringify(event.details)}`.toLowerCase();
        if (!haystack.includes(text)) continue;
      }
      rows.push(this._view(event));
    }
    rows.reverse();
    return Object.freeze(rows);
  }

  get(eventId) {
    const event = this.events.find((entry) => entry.eventId === eventId);
    if (!event) throw new TrafficTimelineError('EVENT_NOT_FOUND', `Traffic event ${eventId} was not found`, { eventId });
    return this._view(event);
  }

  bookmark(eventId, { note = '' } = {}) {
    const event = this.events.find((entry) => entry.eventId === eventId);
    if (!event) throw new TrafficTimelineError('EVENT_NOT_FOUND', `Traffic event ${eventId} was not found`, { eventId });
    if (!this.bookmarks.has(eventId) && this.bookmarks.size >= this.maxBookmarks) {
      const oldest = this.bookmarks.keys().next().value;
      this.bookmarks.delete(oldest);
    }
    const record = Object.freeze({ eventId, note: String(note || '').slice(0, 1000), bookmarkedAt: Date.now() });
    this.bookmarks.set(eventId, record);
    this.emit('bookmark', record);
    return record;
  }

  unbookmark(eventId) {
    return this.bookmarks.delete(eventId);
  }

  clear() {
    this.events = [];
    this.bookmarks.clear();
    return this.stats();
  }

  stats() {
    let errors = 0;
    let tx = 0;
    let rx = 0;
    const connections = new Set();
    for (const event of this.events) {
      if (event.error) errors += 1;
      if (event.direction === 'tx') tx += 1;
      if (event.direction === 'rx') rx += 1;
      if (event.connectionId) connections.add(event.connectionId);
    }
    return Object.freeze({
      retained: this.events.length,
      capacity: this.maxEvents,
      ingested: this.ingested,
      dropped: this.dropped,
      tx,
      rx,
      errors,
      bookmarks: this.bookmarks.size,
      connections: connections.size,
      latestSequence: this.sequence,
    });
  }

  _view(event) {
    const bookmark = this.bookmarks.get(event.eventId) || null;
    return Object.freeze({ ...event, bookmark });
  }
}

module.exports = {
  TrafficTimelineError,
  TrafficTimelineService,
  normalizeTrafficEvent: normalizeEvent,
};
