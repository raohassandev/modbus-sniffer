'use strict';

const { ProjectLifecycleService, lifecycleHttpStatus } = require('./projectLifecycleService');

function payload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || 'PROJECT_LIFECYCLE_ERROR',
      message: String(error?.message || error),
      details: error?.details && typeof error.details === 'object' ? error.details : null,
    },
  };
}

function assertProjectSwitchSafe(broker) {
  for (const item of broker.listConnections()) {
    if (item.owner || ['open', 'opening', 'closing'].includes(item.state)) {
      const error = new Error('Close active connections before activating another project');
      error.code = 'CONNECTION_ACTIVE';
      error.details = { connectionId: item.connectionId };
      throw error;
    }
  }
}

function mountProjectLifecycleRoutes({ app, store, broker, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!store) throw new TypeError('store is required');
  if (!broker) throw new TypeError('broker is required');
  const service = new ProjectLifecycleService({ store });
  const route = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      const status = error?.code === 'CONNECTION_ACTIVE' ? 409 : lifecycleHttpStatus(error);
      res.status(status).json(payload(error));
    }
  };

  app.post('/api/v8/projects/:projectId/clone', route(async (req, res) => {
    const options = req.body && typeof req.body === 'object' ? req.body : {};
    if (options.activate) assertProjectSwitchSafe(broker);
    const result = service.cloneProject(req.params.projectId, options);
    broadcast({ type: 'project.cloned', projectId: result.project.id, sourceProjectId: req.params.projectId, active: result.active });
    res.status(201).json({ ok: true, ...result });
  }));

  app.get('/api/v8/project-templates', route(async (_req, res) => {
    res.json({ ok: true, templates: service.listTemplates() });
  }));

  app.post('/api/v8/project-templates', route(async (req, res) => {
    const template = service.saveTemplate(req.body || {});
    broadcast({ type: 'project-template.saved', templateId: template.templateId });
    res.status(201).json({ ok: true, template });
  }));

  app.delete('/api/v8/project-templates/:templateId', route(async (req, res) => {
    const removed = service.removeTemplate(req.params.templateId);
    broadcast({ type: 'project-template.removed', templateId: req.params.templateId, removed });
    res.json({ ok: true, removed });
  }));

  app.post('/api/v8/project-templates/:templateId/preview', route(async (req, res) => {
    res.json({ ok: true, preview: service.previewTemplate(req.params.templateId, req.body || {}) });
  }));

  app.post('/api/v8/project-templates/:templateId/apply', route(async (req, res) => {
    const options = req.body && typeof req.body === 'object' ? req.body : {};
    if (options.activate) assertProjectSwitchSafe(broker);
    const result = service.applyTemplate(req.params.templateId, options);
    broadcast({ type: 'project-template.applied', templateId: req.params.templateId, projectId: result.project.id, active: result.active });
    res.status(201).json({ ok: true, ...result });
  }));

  return service;
}

module.exports = {
  mountProjectLifecycleRoutes,
  assertProjectSwitchSafe,
};