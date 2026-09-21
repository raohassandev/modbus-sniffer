'use strict';

const { ReportBundleService } = require('./reportBundleService');

function errorPayload(error) {
  return { ok: false, error: { code: error?.code || 'REPORT_ERROR', message: String(error?.message || error), details: error?.details || null } };
}

function mountReportRoutes({ app, store, masterWorkspace = null, timeline = null, history = null } = {}) {
  if (!app) throw new TypeError('app is required');
  const reports = new ReportBundleService({ store, masterWorkspace, timeline, history });
  const route = (handler) => async (req, res) => {
    try { await handler(req, res); }
    catch (error) { res.status(error?.code === 'PROJECT_NOT_FOUND' ? 404 : 400).json(errorPayload(error)); }
  };

  app.get('/api/v8/reports/:projectId/summary', route(async (req, res) => {
    const model = reports.collect(req.params.projectId);
    res.json({
      ok: true,
      generatedAt: model.generatedAt,
      project: { id: model.project.id, name: model.project.name, site: model.project.site, bus: model.project.bus },
      counts: {
        connections: model.project.connections.length,
        masterJobs: model.project.masterJobs.length,
        slaveServers: model.project.slaveServers.length,
        virtualDevices: model.project.virtualDevices.length,
        recipes: model.project.testRecipes.length,
        charts: model.project.charts.length,
        loggerProfiles: model.project.loggerProfiles.length,
        hmiScreens: model.project.hmiScreens.length,
        trafficRows: model.traffic.length,
        writeAuditRows: model.writeAudit.length,
      },
      master: model.master,
    });
  }));

  app.get('/api/v8/reports/:projectId/write-audit', route(async (req, res) => {
    const model = reports.collect(req.params.projectId);
    res.json({ ok: true, projectId: req.params.projectId, records: model.writeAudit });
  }));

  app.get('/api/v8/reports/:projectId/traffic', route(async (req, res) => {
    const model = reports.collect(req.params.projectId);
    res.json({ ok: true, projectId: req.params.projectId, activeProjectAtExport: model.active, records: model.traffic });
  }));

  app.get('/api/v8/reports/:projectId/historian', route(async (req, res) => {
    const model = reports.collect(req.params.projectId);
    res.json({ ok: true, projectId: req.params.projectId, tags: model.historianTags, charts: model.project.charts, loggerProfiles: model.project.loggerProfiles });
  }));

  app.get('/api/v8/reports/:projectId/manifest', route(async (req, res) => {
    res.json({ ok: true, manifest: reports.buildFiles(req.params.projectId).manifest });
  }));

  app.get('/api/v8/reports/:projectId/bundle.zip', route(async (req, res) => {
    reports.streamBundle(res, req.params.projectId);
  }));

  return reports;
}

module.exports = { mountReportRoutes };