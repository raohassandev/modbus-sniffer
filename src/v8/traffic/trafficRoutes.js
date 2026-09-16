'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST = new Set(['INVALID_EVENT', 'INVALID_DEFINITION']);
const NOT_FOUND = new Set(['EVENT_NOT_FOUND', 'REGISTER_SOURCE_NOT_FOUND', 'PROJECT_NOT_FOUND']);

function trafficErrorStatus(error) {
  if (BAD_REQUEST.has(error?.code)) return 400;
  if (NOT_FOUND.has(error?.code)) return 404;
  return httpErrorStatus(error);
}

function mountTrafficRegisterRoutes({ app, timeline, registerLab, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!timeline) throw new TypeError('timeline is required');
  if (!registerLab) throw new TypeError('registerLab is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const trafficRoute = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'trafficWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(trafficErrorStatus(error)).json(errorPayload(error));
    }
  };

  const registerRoute = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'registerLabWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(trafficErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/traffic', trafficRoute(async (req, res) => {
    res.json({ ok: true, events: timeline.query(req.query || {}), stats: timeline.stats() });
  }));

  app.get('/api/v8/traffic/events/:eventId', trafficRoute(async (req, res) => {
    res.json({ ok: true, event: timeline.get(req.params.eventId) });
  }));

  app.post('/api/v8/traffic/events/:eventId/bookmark', trafficRoute(async (req, res) => {
    const bookmark = timeline.bookmark(req.params.eventId, req.body || {});
    broadcast({ type: 'traffic.bookmark', eventId: req.params.eventId });
    res.json({ ok: true, bookmark });
  }));

  app.delete('/api/v8/traffic/events/:eventId/bookmark', trafficRoute(async (req, res) => {
    const removed = timeline.unbookmark(req.params.eventId);
    broadcast({ type: 'traffic.unbookmark', eventId: req.params.eventId });
    res.json({ ok: true, removed });
  }));

  app.delete('/api/v8/traffic', trafficRoute(async (_req, res) => {
    const stats = timeline.clear();
    registerLab.clearLive();
    broadcast({ type: 'traffic.cleared' });
    res.json({ ok: true, stats });
  }));

  app.get('/api/v8/register-lab', registerRoute(async (req, res) => {
    res.json({ ok: true, points: registerLab.list(req.query || {}), stats: registerLab.stats(), definitions: registerLab.listDefinitions() });
  }));

  app.get('/api/v8/register-lab/:sourceKey/interpretations', registerRoute(async (req, res) => {
    const sourceKey = req.params.sourceKey;
    res.json({ ok: true, point: registerLab.get(sourceKey), interpretations: registerLab.interpretationMatrix(sourceKey) });
  }));

  app.put('/api/v8/register-lab/:sourceKey/definition', registerRoute(async (req, res) => {
    const sourceKey = req.params.sourceKey;
    const definition = registerLab.saveDefinition({ ...(req.body || {}), sourceKey });
    broadcast({ type: 'register-lab.definition-saved', sourceKey });
    res.json({ ok: true, definition, point: registerLab.get(sourceKey) });
  }));

  app.delete('/api/v8/register-lab/:sourceKey/definition', registerRoute(async (req, res) => {
    const sourceKey = req.params.sourceKey;
    const removed = registerLab.removeDefinition(sourceKey);
    broadcast({ type: 'register-lab.definition-removed', sourceKey });
    res.json({ ok: true, removed });
  }));
}

module.exports = {
  trafficErrorStatus,
  mountTrafficRegisterRoutes,
};
