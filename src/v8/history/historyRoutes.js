'use strict';

function sendError(res, error) {
  const status = ['INVALID_ID', 'SOURCE_REQUIRED', 'SERIES_LIMIT', 'DUPLICATE_SERIES'].includes(error?.code) ? 400
    : ['CHART_NOT_FOUND', 'LOGGER_NOT_FOUND', 'PROJECT_NOT_FOUND'].includes(error?.code) ? 404
      : error?.code === 'HISTORIAN_UNAVAILABLE' ? 503 : 500;
  res.status(status).json({ ok: false, error: { code: error?.code || 'HISTORY_ERROR', message: String(error?.message || error), details: error?.details || null } });
}

function mountHistoryRoutes({ app, history, flags, assertFeature, broadcast = () => undefined }) {
  if (!app || !history) throw new TypeError('app and history are required');
  const guard = (_req, res, next) => {
    try { assertFeature(flags, 'chartsWorkspace'); next(); } catch (error) { sendError(res, error); }
  };

  app.get('/api/v8/history', guard, (req, res) => {
    try { res.json({ ok: true, ...history.snapshot(req.query.projectId || undefined) }); } catch (error) { sendError(res, error); }
  });

  app.post('/api/v8/history/charts', guard, (req, res) => {
    try {
      const chart = history.saveChart(req.body || {}, req.query.projectId || undefined);
      broadcast({ type: 'history.chart-saved', chart });
      res.json({ ok: true, chart });
    } catch (error) { sendError(res, error); }
  });

  app.delete('/api/v8/history/charts/:documentId', guard, (req, res) => {
    try {
      history.removeChart(req.params.documentId, req.query.projectId || undefined);
      broadcast({ type: 'history.chart-removed', documentId: req.params.documentId });
      res.json({ ok: true });
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/v8/history/charts/:documentId/series/:seriesId', guard, (req, res) => {
    try {
      const points = history.queryChart(req.params.documentId, req.params.seriesId, req.query, req.query.projectId || undefined);
      res.json({ ok: true, points });
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/v8/history/charts/:documentId/export.csv', guard, (req, res) => {
    try {
      const csv = history.exportChartCsv(req.params.documentId, req.query.projectId || undefined);
      res.type('text/csv').send(csv);
    } catch (error) { sendError(res, error); }
  });

  app.post('/api/v8/history/loggers', guard, (req, res) => {
    try {
      const profile = history.saveLogger(req.body || {}, req.query.projectId || undefined);
      broadcast({ type: 'history.logger-saved', profile });
      res.json({ ok: true, profile });
    } catch (error) { sendError(res, error); }
  });

  app.delete('/api/v8/history/loggers/:streamId', guard, (req, res) => {
    try {
      history.removeLogger(req.params.streamId, req.query.projectId || undefined);
      broadcast({ type: 'history.logger-removed', streamId: req.params.streamId });
      res.json({ ok: true });
    } catch (error) { sendError(res, error); }
  });

  app.get('/api/v8/history/historian/tags', guard, (req, res) => {
    try { res.json({ ok: true, tags: history.historianTags(req.query.projectId || undefined) }); } catch (error) { sendError(res, error); }
  });

  app.get('/api/v8/history/historian/:tagId', guard, (req, res) => {
    try {
      const samples = history.queryHistorian(req.params.tagId, req.query, req.query.projectId || undefined);
      res.json({ ok: true, samples });
    } catch (error) { sendError(res, error); }
  });
}

module.exports = { mountHistoryRoutes };
