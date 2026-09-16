'use strict';

const { EventEmitter } = require('node:events');

class ChartServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ChartServiceError';
    this.code = code;
    this.details = { ...details };
  }
}

function finite(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new ChartServiceError('INVALID_VALUE', `${field} must be finite`, { field, value });
  return numeric;
}

function decimateMinMax(points, maxPoints) {
  if (!Number.isInteger(maxPoints) || maxPoints < 2) throw new ChartServiceError('INVALID_MAX_POINTS', 'maxPoints must be >= 2');
  if (points.length <= maxPoints) return points.map((point) => ({ ...point }));
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const interior = points.slice(1, -1);
  const bucketSize = interior.length / bucketCount;
  const selected = [{ ...points[0] }];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(interior.length, Math.floor((bucket + 1) * bucketSize));
    const slice = interior.slice(start, Math.max(start + 1, end));
    if (!slice.length) continue;
    let min = slice[0];
    let max = slice[0];
    for (const point of slice) {
      if (point.value < min.value) min = point;
      if (point.value > max.value) max = point;
    }
    const ordered = min.timestamp <= max.timestamp ? [min, max] : [max, min];
    for (const point of ordered) {
      if (selected.length < maxPoints - 1 && selected.at(-1)?.timestamp !== point.timestamp) selected.push({ ...point });
    }
  }
  selected.push({ ...points.at(-1) });
  if (selected.length > maxPoints) return selected.slice(0, maxPoints - 1).concat(selected.at(-1));
  return selected;
}

class ChartService extends EventEmitter {
  constructor({ maxDocuments = 64, defaultMaxPoints = 10000 } = {}) {
    super();
    if (!Number.isInteger(maxDocuments) || maxDocuments < 1) throw new TypeError('maxDocuments must be positive');
    if (!Number.isInteger(defaultMaxPoints) || defaultMaxPoints < 10) throw new TypeError('defaultMaxPoints must be >= 10');
    this.maxDocuments = maxDocuments;
    this.defaultMaxPoints = defaultMaxPoints;
    this.documents = new Map();
  }

  createDocument({ documentId, title = 'Chart', maxPoints = this.defaultMaxPoints } = {}) {
    if (typeof documentId !== 'string' || !documentId.trim()) throw new ChartServiceError('INVALID_DOCUMENT', 'documentId is required');
    if (this.documents.has(documentId)) throw new ChartServiceError('DOCUMENT_EXISTS', `Chart ${documentId} already exists`);
    if (this.documents.size >= this.maxDocuments) throw new ChartServiceError('DOCUMENT_LIMIT', 'Chart document limit reached', { maxDocuments: this.maxDocuments });
    if (!Number.isInteger(maxPoints) || maxPoints < 10) throw new ChartServiceError('INVALID_MAX_POINTS', 'maxPoints must be >= 10');
    const doc = {
      documentId: documentId.trim(),
      title: String(title || 'Chart'),
      maxPoints,
      createdAt: Date.now(),
      series: new Map(),
      markers: [],
    };
    this.documents.set(doc.documentId, doc);
    this.emit('changed', { type: 'chart.created', documentId: doc.documentId });
    return this.getDocument(doc.documentId);
  }

  removeDocument(documentId) {
    if (!this.documents.delete(documentId)) throw new ChartServiceError('DOCUMENT_NOT_FOUND', `Unknown chart ${documentId}`);
    this.emit('changed', { type: 'chart.removed', documentId });
  }

  addSeries(documentId, {
    seriesId,
    label = null,
    unit = null,
    axis = 'left',
    scale = 1,
    offset = 0,
    source = null,
  } = {}) {
    const doc = this._get(documentId);
    if (typeof seriesId !== 'string' || !seriesId.trim()) throw new ChartServiceError('INVALID_SERIES', 'seriesId is required');
    if (!['left', 'right'].includes(axis)) throw new ChartServiceError('INVALID_AXIS', 'axis must be left or right');
    if (doc.series.has(seriesId)) throw new ChartServiceError('SERIES_EXISTS', `Series ${seriesId} already exists`);
    const series = {
      seriesId: seriesId.trim(),
      label: String(label || seriesId),
      unit: unit == null ? null : String(unit),
      axis,
      scale: finite(scale, 'scale'),
      offset: finite(offset, 'offset'),
      source: source && typeof source === 'object' ? { ...source } : null,
      points: [],
    };
    doc.series.set(series.seriesId, series);
    this.emit('changed', { type: 'chart.series-added', documentId, seriesId: series.seriesId });
    return this.getDocument(documentId);
  }

  removeSeries(documentId, seriesId) {
    const doc = this._get(documentId);
    if (!doc.series.delete(seriesId)) throw new ChartServiceError('SERIES_NOT_FOUND', `Unknown series ${seriesId}`);
    this.emit('changed', { type: 'chart.series-removed', documentId, seriesId });
  }

  appendSample(documentId, seriesId, { timestamp = Date.now(), value, quality = 'good', raw = null } = {}) {
    const doc = this._get(documentId);
    const series = doc.series.get(seriesId);
    if (!series) throw new ChartServiceError('SERIES_NOT_FOUND', `Unknown series ${seriesId}`);
    const rawValue = finite(value, 'value');
    const point = Object.freeze({
      timestamp: finite(timestamp, 'timestamp'),
      value: rawValue * series.scale + series.offset,
      rawValue,
      quality: String(quality || 'unknown'),
      raw: raw == null ? null : raw,
    });
    series.points.push(point);
    if (series.points.length > doc.maxPoints) series.points.splice(0, series.points.length - doc.maxPoints);
    this.emit('sample', { documentId, seriesId, point });
    return point;
  }

  addMarker(documentId, { timestamp = Date.now(), type = 'event', label = '', details = null } = {}) {
    const doc = this._get(documentId);
    const marker = Object.freeze({ timestamp: finite(timestamp, 'timestamp'), type: String(type), label: String(label), details: details && typeof details === 'object' ? { ...details } : null });
    doc.markers.push(marker);
    if (doc.markers.length > doc.maxPoints) doc.markers.splice(0, doc.markers.length - doc.maxPoints);
    return marker;
  }

  querySeries(documentId, seriesId, { from = -Infinity, to = Infinity, maxPoints = null } = {}) {
    const doc = this._get(documentId);
    const series = doc.series.get(seriesId);
    if (!series) throw new ChartServiceError('SERIES_NOT_FOUND', `Unknown series ${seriesId}`);
    const points = series.points.filter((point) => point.timestamp >= from && point.timestamp <= to);
    const output = maxPoints == null ? points.map((point) => ({ ...point })) : decimateMinMax(points, maxPoints);
    return Object.freeze(output.map((point) => Object.freeze(point)));
  }

  exportCsv(documentId, { from = -Infinity, to = Infinity } = {}) {
    const doc = this._get(documentId);
    const rows = ['timestamp,series_id,label,value,unit,quality'];
    for (const series of doc.series.values()) {
      for (const point of series.points) {
        if (point.timestamp < from || point.timestamp > to) continue;
        const cells = [new Date(point.timestamp).toISOString(), series.seriesId, series.label, point.value, series.unit || '', point.quality]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`);
        rows.push(cells.join(','));
      }
    }
    return `${rows.join('\n')}\n`;
  }

  getDocument(documentId) {
    const doc = this._get(documentId);
    return Object.freeze({
      documentId: doc.documentId,
      title: doc.title,
      maxPoints: doc.maxPoints,
      createdAt: doc.createdAt,
      series: Object.freeze([...doc.series.values()].map((series) => Object.freeze({
        seriesId: series.seriesId,
        label: series.label,
        unit: series.unit,
        axis: series.axis,
        scale: series.scale,
        offset: series.offset,
        source: series.source ? Object.freeze({ ...series.source }) : null,
        pointCount: series.points.length,
      }))),
      markers: Object.freeze(doc.markers.map((marker) => marker)),
    });
  }

  listDocuments() {
    return Object.freeze([...this.documents.keys()].map((id) => this.getDocument(id)));
  }

  _get(documentId) {
    const doc = this.documents.get(documentId);
    if (!doc) throw new ChartServiceError('DOCUMENT_NOT_FOUND', `Unknown chart ${documentId}`);
    return doc;
  }
}

module.exports = {
  ChartService,
  ChartServiceError,
  decimateMinMax,
};
