'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

function numberOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function integerOr(value, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numeric = numberOr(value, fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function historyErrorStatus(error) {
  if (['DOCUMENT_NOT_FOUND', 'SERIES_NOT_FOUND', 'STREAM_NOT_FOUND', 'TAG_NOT_FOUND'].includes(error?.code)) return 404;
  if (String(error?.code || '').startsWith('INVALID_')) return 400;
  if (['DOCUMENT_EXISTS', 'SERIES_EXISTS', 'STREAM_EXISTS'].includes(error?.code)) return 409;
  return httpErrorStatus(error);
}

function sqliteUnavailable(res, history) {
  if (history.historian) return false;
  res.status(503).json({ ok: false, error: { code: 'SQLITE_UNAVAILABLE', message: history.snapshot().historian.reason } });
  return true;
}

function mountHistoryRoutes({ app, history, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!history) throw new TypeError('history is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const gated = (feature, handler) => async (req, res) => {
    try {
      assertFeature(flags, feature);
      await handler(req, res);
    } catch (error) {
      res.status(historyErrorStatus(error)).json(errorPayload(error));
    }
  };
  const charts = (handler) => gated('chartsWorkspace', handler);
  const historian = (handler) => gated('historianWorkspace', handler);

  app.get('/api/v8/history', charts(async (_req, res) => res.json({ ok: true, ...history.snapshot() })));
  app.get('/api/v8/charts', charts(async (_req, res) => res.json({ ok: true, documents: history.charts.listDocuments() })));
  app.post('/api/v8/charts', charts(async (req, res) => {
    const document = history.charts.createDocument(req.body || {});
    broadcast({ type: 'chart.created', documentId: document.documentId });
    res.status(201).json({ ok: true, document });
  }));
  app.delete('/api/v8/charts/:documentId', charts(async (req, res) => {
    history.charts.removeDocument(req.params.documentId);
    broadcast({ type: 'chart.removed', documentId: req.params.documentId });
    res.json({ ok: true });
  }));
  app.get('/api/v8/charts/:documentId', charts(async (req, res) => res.json({ ok: true, document: history.charts.getDocument(req.params.documentId) })));
  app.post('/api/v8/charts/:documentId/series', charts(async (req, res) => {
    const document = history.charts.addSeries(req.params.documentId, req.body || {});
    broadcast({ type: 'chart.series-added', documentId: req.params.documentId, seriesId: req.body?.seriesId || null });
    res.status(201).json({ ok: true, document });
  }));
  app.delete('/api/v8/charts/:documentId/series/:seriesId', charts(async (req, res) => {
    history.charts.removeSeries(req.params.documentId, req.params.seriesId);
    res.json({ ok: true });
  }));
  app.post('/api/v8/charts/:documentId/series/:seriesId/samples', charts(async (req, res) => {
    const result = history.ingestSample({ ...(req.body || {}), documentId: req.params.documentId, seriesId: req.params.seriesId });
    res.status(201).json({ ok: true, result });
  }));
  app.get('/api/v8/charts/:documentId/series/:seriesId/samples', charts(async (req, res) => {
    const points = history.charts.querySeries(req.params.documentId, req.params.seriesId, {
      from: numberOr(req.query.from, -Infinity),
      to: numberOr(req.query.to, Infinity),
      maxPoints: req.query.maxPoints == null ? null : integerOr(req.query.maxPoints, 1000, { min: 2, max: 100000 }),
    });
    res.json({ ok: true, points });
  }));
  app.get('/api/v8/charts/:documentId/export.csv', charts(async (req, res) => {
    const csv = history.charts.exportCsv(req.params.documentId, { from: numberOr(req.query.from, -Infinity), to: numberOr(req.query.to, Infinity) });
    res.type('text/csv').send(csv);
  }));

  app.get('/api/v8/logger', historian(async (_req, res) => res.json({ ok: true, status: history.logger.status(), streams: history.logger.listStreams() })));
  app.post('/api/v8/logger/streams', historian(async (req, res) => res.status(201).json({ ok: true, stream: history.logger.addStream(req.body || {}) })));
  app.patch('/api/v8/logger/streams/:streamId', historian(async (req, res) => res.json({ ok: true, stream: history.logger.updateStream(req.params.streamId, req.body || {}) })));
  app.delete('/api/v8/logger/streams/:streamId', historian(async (req, res) => { history.logger.removeStream(req.params.streamId); res.json({ ok: true }); }));
  app.post('/api/v8/logger/streams/:streamId/samples', historian(async (req, res) => {
    const result = history.ingestSample({ ...(req.body || {}), streamId: req.params.streamId });
    res.status(201).json({ ok: true, result });
  }));
  app.post('/api/v8/logger/flush', historian(async (_req, res) => { history.logger.flush(); res.json({ ok: true, status: history.logger.status() }); }));

  app.get('/api/v8/historian', historian(async (_req, res) => res.json({ ok: true, historian: history.snapshot().historian })));
  app.get('/api/v8/historian/tags', historian(async (_req, res) => {
    if (sqliteUnavailable(res, history)) return;
    res.json({ ok: true, tags: history.historian.listTags() });
  }));
  app.put('/api/v8/historian/tags/:tagId', historian(async (req, res) => {
    if (sqliteUnavailable(res, history)) return;
    res.json({ ok: true, tag: history.historian.upsertTag({ ...(req.body || {}), tagId: req.params.tagId }) });
  }));
  app.post('/api/v8/historian/tags/:tagId/samples', historian(async (req, res) => {
    if (sqliteUnavailable(res, history)) return;
    const result = history.ingestSample({ ...(req.body || {}), tagId: req.params.tagId });
    res.status(201).json({ ok: true, result });
  }));
  app.get('/api/v8/historian/tags/:tagId/samples', historian(async (req, res) => {
    if (sqliteUnavailable(res, history)) return;
    const rows = history.historian.querySamples(req.params.tagId, {
      from: integerOr(req.query.from, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      to: integerOr(req.query.to, Number.MAX_SAFE_INTEGER, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      limit: integerOr(req.query.limit, 10000, { min: 1, max: 1000000 }),
      descending: ['1', 'true', 'yes'].includes(String(req.query.descending || '').toLowerCase()),
    });
    res.json({ ok: true, samples: rows });
  }));
  app.get('/api/v8/historian/events', historian(async (req, res) => {
    if (sqliteUnavailable(res, history)) return;
    const events = history.historian.queryEvents({
      from: integerOr(req.query.from, 0, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      to: integerOr(req.query.to, Number.MAX_SAFE_INTEGER, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      type: req.query.type == null || req.query.type === '' ? null : String(req.query.type),
      limit: integerOr(req.query.limit, 10000, { min: 1, max: 1000000 }),
    });
    res.json({ ok: true, events });
  }));
}

module.exports = { numberOr, integerOr, historyErrorStatus, mountHistoryRoutes };
