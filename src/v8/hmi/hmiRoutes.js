'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST = new Set([
  'INVALID_SCREEN', 'INVALID_WIDGET', 'INVALID_WIDGET_TYPE', 'INVALID_BINDING', 'INVALID_WRITE_BINDING', 'INVALID_ACTION',
  'WIDGET_NOT_BOUND', 'WIDGET_NOT_WRITABLE', 'WRITE_BINDING_REQUIRED', 'CONFIRMATION_REQUIRED', 'BULK_CONFIRMATION_REQUIRED', 'INVALID_WIDGET_VALUE', 'INVALID_SCALE',
  'WIDGET_ACTION_REQUIRED', 'DUPLICATE_WIDGET_ID', 'SCREEN_LIMIT', 'WIDGET_LIMIT', 'TEMPLATE_LIMIT',
]);
const NOT_FOUND = new Set(['PROJECT_NOT_FOUND', 'SCREEN_NOT_FOUND', 'WIDGET_NOT_FOUND', 'TEMPLATE_NOT_FOUND', 'RECIPE_NOT_FOUND']);
const UNAVAILABLE = new Set(['TEST_CENTER_UNAVAILABLE']);

function hmiErrorStatus(error) {
  if (BAD_REQUEST.has(error?.code)) return 400;
  if (NOT_FOUND.has(error?.code)) return 404;
  if (UNAVAILABLE.has(error?.code)) return 503;
  if (['RESOURCE_BUSY', 'CONNECTION_OWNED', 'OWNER_MISMATCH', 'WRITE_LOCKED'].includes(error?.code)) return 409;
  return httpErrorStatus(error);
}

function mountHmiRoutes({ app, hmi, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!hmi) throw new TypeError('hmi is required');
  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'hmiWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(hmiErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/hmi/screens', route(async (_req, res) => res.json({ ok: true, screens: hmi.list() })));
  app.get('/api/v8/hmi/screens/:screenId', route(async (req, res) => res.json({ ok: true, screen: hmi.get(req.params.screenId) })));
  app.post('/api/v8/hmi/screens', route(async (req, res) => {
    const screen = hmi.save(req.body || {});
    broadcast({ type: 'hmi.screen-saved', screenId: screen.screenId });
    res.status(201).json({ ok: true, screen });
  }));
  app.put('/api/v8/hmi/screens/:screenId', route(async (req, res) => {
    const screen = hmi.save({ ...(req.body || {}), screenId: req.params.screenId });
    broadcast({ type: 'hmi.screen-saved', screenId: screen.screenId });
    res.json({ ok: true, screen });
  }));
  app.delete('/api/v8/hmi/screens/:screenId', route(async (req, res) => {
    const removed = hmi.remove(req.params.screenId);
    broadcast({ type: 'hmi.screen-removed', screenId: req.params.screenId });
    res.json({ ok: true, removed });
  }));

  app.get('/api/v8/hmi/templates', route(async (_req, res) => res.json({ ok: true, templates: hmi.listTemplates() })));
  app.post('/api/v8/hmi/templates', route(async (req, res) => res.status(201).json({ ok: true, template: hmi.saveTemplate(req.body || {}) })));
  app.post('/api/v8/hmi/screens/:screenId/templates/:templateId/apply', route(async (req, res) => {
    const screen = hmi.applyTemplate(req.params.screenId, req.params.templateId, req.body || {});
    res.json({ ok: true, screen });
  }));

  app.post('/api/v8/hmi/screens/:screenId/widgets/:widgetId/read', route(async (req, res) => {
    const result = await hmi.readWidget(req.params.screenId, req.params.widgetId);
    res.json({ ok: true, result });
  }));
  app.post('/api/v8/hmi/screens/:screenId/widgets/:widgetId/write', route(async (req, res) => {
    const result = await hmi.writeWidget(req.params.screenId, req.params.widgetId, req.body || {});
    broadcast({ type: 'hmi.widget-write', screenId: req.params.screenId, widgetId: req.params.widgetId });
    res.json({ ok: true, result });
  }));
  app.post('/api/v8/hmi/screens/:screenId/widgets/:widgetId/trigger', route(async (req, res) => {
    const result = await hmi.triggerWidget(req.params.screenId, req.params.widgetId, req.body || {});
    res.json({ ok: true, result });
  }));
}

module.exports = { hmiErrorStatus, mountHmiRoutes };
