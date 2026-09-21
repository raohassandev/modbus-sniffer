'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ChartService } = require('./chartService');
const { RotatingJsonlLogger } = require('./loggerService');
const { SqliteHistorian, sqliteAvailable } = require('./sqliteHistorian');

class HistoryWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HistoryWorkspaceError';
    this.code = code;
    this.details = { ...details };
  }
}

function safeId(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(text)) throw new HistoryWorkspaceError('INVALID_ID', 'ID must contain only letters, digits, dot, underscore, colon or dash');
  return text;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSeries(input = {}) {
  return Object.freeze({
    seriesId: safeId(input.seriesId || input.sourceKey),
    sourceKey: String(input.sourceKey || '').trim(),
    label: String(input.label || input.seriesId || input.sourceKey || '').slice(0, 200),
    unit: input.unit == null ? null : String(input.unit).slice(0, 80),
    axis: input.axis === 'right' ? 'right' : 'left',
    scale: finite(input.scale, 1),
    offset: finite(input.offset, 0),
  });
}

function normalizeChart(input = {}, existing = null) {
  const documentId = safeId(input.documentId || existing?.documentId);
  const series = Array.isArray(input.series) ? input.series.map(normalizeSeries) : (existing?.series || []);
  if (series.length > 256) throw new HistoryWorkspaceError('SERIES_LIMIT', 'A chart may contain at most 256 series');
  const seen = new Set();
  for (const item of series) {
    if (!item.sourceKey) throw new HistoryWorkspaceError('SOURCE_REQUIRED', 'Chart series sourceKey is required');
    if (seen.has(item.seriesId)) throw new HistoryWorkspaceError('DUPLICATE_SERIES', `Duplicate series ${item.seriesId}`);
    seen.add(item.seriesId);
  }
  return Object.freeze({
    documentId,
    title: String(input.title ?? existing?.title ?? documentId).slice(0, 200),
    maxPoints: Math.max(100, Math.min(100000, Number(input.maxPoints ?? existing?.maxPoints ?? 10000) || 10000)),
    series: Object.freeze(series),
  });
}

function normalizeLogger(input = {}, existing = null) {
  const streamId = safeId(input.streamId || existing?.streamId);
  const mode = ['every', 'fixed', 'change-only'].includes(input.mode) ? input.mode : (existing?.mode || 'fixed');
  const sourceKey = String(input.sourceKey ?? existing?.sourceKey ?? '').trim();
  if (!sourceKey) throw new HistoryWorkspaceError('SOURCE_REQUIRED', 'Logger sourceKey is required');
  return Object.freeze({
    streamId,
    sourceKey,
    label: String(input.label ?? existing?.label ?? streamId).slice(0, 200),
    unit: input.unit == null ? (existing?.unit ?? null) : String(input.unit).slice(0, 80),
    mode,
    intervalMs: Math.max(1, Math.min(86400000, Number(input.intervalMs ?? existing?.intervalMs ?? 1000) || 1000)),
    enabled: input.enabled !== false,
    historian: input.historian !== false,
  });
}

class HistoryWorkspaceService extends EventEmitter {
  constructor({ store, registerLab, dataDir = null, clock = () => Date.now() } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!registerLab || typeof registerLab.on !== 'function') throw new TypeError('registerLab is required');
    this.store = store;
    this.registerLab = registerLab;
    this.dataDir = path.resolve(dataDir || store.dataDir || path.join(process.cwd(), 'data'));
    this.clock = clock;
    this.runtimes = new Map();
    this.onPoint = (point) => this._ingestPoint(point);
    registerLab.on('point', this.onPoint);
  }

  snapshot(projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const runtime = this._runtime(project);
    return Object.freeze({
      projectId: project.id,
      sqliteAvailable: sqliteAvailable(),
      charts: Object.freeze((project.charts || []).map((chart) => this._chartView(runtime, chart))),
      loggerProfiles: Object.freeze((project.loggerProfiles || []).map((profile) => Object.freeze({ ...profile }))),
      logger: runtime.logger.status(),
      historian: runtime.historian ? runtime.historian.status() : Object.freeze({ available: false, reason: 'node:sqlite unavailable in this runtime' }),
    });
  }

  saveChart(input, projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const charts = [...(project.charts || [])];
    const index = charts.findIndex((item) => item.documentId === input?.documentId);
    const chart = normalizeChart(input, index >= 0 ? charts[index] : null);
    if (index >= 0) charts[index] = chart; else charts.push(chart);
    this.store.updateProject(project.id, { charts });
    this._rebuild(project.id);
    this.emit('event', Object.freeze({ type: 'history.chart-saved', projectId: project.id, documentId: chart.documentId, timestamp: this.clock() }));
    return chart;
  }

  removeChart(documentId, projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const next = (project.charts || []).filter((item) => item.documentId !== documentId);
    if (next.length === (project.charts || []).length) throw new HistoryWorkspaceError('CHART_NOT_FOUND', `Unknown chart ${documentId}`);
    this.store.updateProject(project.id, { charts: next });
    this._rebuild(project.id);
  }

  saveLogger(input, projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const profiles = [...(project.loggerProfiles || [])];
    const index = profiles.findIndex((item) => item.streamId === input?.streamId);
    const profile = normalizeLogger(input, index >= 0 ? profiles[index] : null);
    if (index >= 0) profiles[index] = profile; else profiles.push(profile);
    this.store.updateProject(project.id, { loggerProfiles: profiles });
    this._rebuild(project.id);
    this.emit('event', Object.freeze({ type: 'history.logger-saved', projectId: project.id, streamId: profile.streamId, timestamp: this.clock() }));
    return profile;
  }

  removeLogger(streamId, projectId = this.store.getActiveProject()?.id) {
    const project = this._project(projectId);
    const next = (project.loggerProfiles || []).filter((item) => item.streamId !== streamId);
    if (next.length === (project.loggerProfiles || []).length) throw new HistoryWorkspaceError('LOGGER_NOT_FOUND', `Unknown logger ${streamId}`);
    this.store.updateProject(project.id, { loggerProfiles: next });
    this._rebuild(project.id);
  }

  queryChart(documentId, seriesId, options = {}, projectId = this.store.getActiveProject()?.id) {
    const runtime = this._runtime(this._project(projectId));
    return runtime.charts.querySeries(documentId, seriesId, {
      from: finite(options.from, -Infinity),
      to: finite(options.to, Infinity),
      maxPoints: options.maxPoints == null ? null : Math.max(2, Math.min(10000, Number(options.maxPoints) || 1000)),
    });
  }

  exportChartCsv(documentId, projectId = this.store.getActiveProject()?.id) {
    return this._runtime(this._project(projectId)).charts.exportCsv(documentId);
  }

  queryHistorian(tagId, options = {}, projectId = this.store.getActiveProject()?.id) {
    const runtime = this._runtime(this._project(projectId));
    if (!runtime.historian) throw new HistoryWorkspaceError('HISTORIAN_UNAVAILABLE', 'SQLite historian is unavailable in this Node.js runtime');
    return runtime.historian.querySamples(tagId, {
      from: finite(options.from, 0),
      to: finite(options.to, Number.MAX_SAFE_INTEGER),
      limit: Math.max(1, Math.min(100000, Number(options.limit) || 10000)),
    });
  }

  historianTags(projectId = this.store.getActiveProject()?.id) {
    const runtime = this._runtime(this._project(projectId));
    return runtime.historian ? runtime.historian.listTags() : Object.freeze([]);
  }

  shutdown() {
    this.registerLab.off('point', this.onPoint);
    for (const runtime of this.runtimes.values()) this._closeRuntime(runtime);
    this.runtimes.clear();
  }

  _project(projectId) {
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    if (!project) throw new HistoryWorkspaceError('PROJECT_NOT_FOUND', `Project ${projectId || '(active)'} was not found`);
    return project;
  }

  _runtime(project) {
    let runtime = this.runtimes.get(project.id);
    const signature = JSON.stringify({ charts: project.charts || [], loggerProfiles: project.loggerProfiles || [] });
    if (!runtime || runtime.signature !== signature) {
      if (runtime) this._closeRuntime(runtime);
      runtime = this._createRuntime(project, signature);
      this.runtimes.set(project.id, runtime);
    }
    return runtime;
  }

  _createRuntime(project, signature) {
    const charts = new ChartService();
    for (const definition of project.charts || []) {
      const chart = normalizeChart(definition);
      charts.createDocument(chart);
      for (const series of chart.series) charts.addSeries(chart.documentId, { ...series, source: { sourceKey: series.sourceKey } });
    }
    const logger = new RotatingJsonlLogger({
      directory: path.join(this.dataDir, 'v8-logs', safeId(project.id)),
      prefix: safeId(project.id),
      immediateFlush: false,
    });
    for (const definition of project.loggerProfiles || []) {
      const profile = normalizeLogger(definition);
      logger.addStream({ streamId: profile.streamId, source: { sourceKey: profile.sourceKey }, mode: profile.mode, intervalMs: profile.intervalMs });
      if (!profile.enabled) logger.updateStream(profile.streamId, { enabled: false });
    }
    let historian = null;
    if (sqliteAvailable()) {
      historian = new SqliteHistorian({ filePath: path.join(this.dataDir, 'v8-history', `${safeId(project.id)}.sqlite`) });
      for (const profile of project.loggerProfiles || []) {
        const normalized = normalizeLogger(profile);
        if (normalized.historian) historian.upsertTag({ tagId: normalized.streamId, name: normalized.label, unit: normalized.unit, source: { sourceKey: normalized.sourceKey } });
      }
    }
    return { projectId: project.id, signature, charts, logger, historian };
  }

  _closeRuntime(runtime) {
    try { runtime.logger.close(); } catch { /* shutdown must continue */ }
    try { runtime.historian?.close(); } catch { /* shutdown must continue */ }
  }

  _rebuild(projectId) {
    const runtime = this.runtimes.get(projectId);
    if (runtime) {
      this._closeRuntime(runtime);
      this.runtimes.delete(projectId);
    }
  }

  _ingestPoint(point) {
    const project = this.store.getActiveProject();
    if (!project || !point?.sourceKey) return;
    let runtime;
    try { runtime = this._runtime(project); } catch (error) { this.emit('error', error); return; }
    const numeric = point.engineering?.available && Number.isFinite(Number(point.engineering.value)) ? Number(point.engineering.value) : Number(point.rawValue);
    const timestamp = Number(point.lastSeen || this.clock());
    if (!Number.isFinite(numeric)) return;

    for (const chart of project.charts || []) {
      for (const series of chart.series || []) {
        if (series.sourceKey !== point.sourceKey) continue;
        try { runtime.charts.appendSample(chart.documentId, series.seriesId, { timestamp, value: numeric, quality: point.quality || 'good', raw: point.rawValue }); }
        catch (error) { this.emit('error', error); }
      }
    }
    for (const profileInput of project.loggerProfiles || []) {
      const profile = normalizeLogger(profileInput);
      if (!profile.enabled || profile.sourceKey !== point.sourceKey) continue;
      try {
        const written = runtime.logger.ingest(profile.streamId, { timestamp, value: numeric, quality: point.quality || 'good', metadata: { sourceKey: point.sourceKey } });
        if (written && profile.historian && runtime.historian) runtime.historian.recordSample({ tagId: profile.streamId, timestamp, value: numeric, quality: point.quality || 'good', raw: point.rawValue });
      } catch (error) { this.emit('error', error); }
    }
  }

  _chartView(runtime, definition) {
    let live = null;
    try { live = runtime.charts.getDocument(definition.documentId); } catch { /* definition remains visible */ }
    return Object.freeze({ ...definition, live });
  }
}

module.exports = {
  HistoryWorkspaceError,
  HistoryWorkspaceService,
  normalizeChart,
  normalizeLogger,
};
