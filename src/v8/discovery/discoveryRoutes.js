'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST_CODES = new Set([
  'INVALID_SCAN_OPTION',
  'INVALID_SCAN_FUNCTION',
  'CONNECTION_REQUIRED',
  'RTU_DISCOVERY_CONFIRMATION_REQUIRED',
  'DISCOVERY_READ_ONLY',
  'DISCOVERY_TRANSPORT_UNSUPPORTED',
]);
const NOT_FOUND_CODES = new Set(['SCAN_NOT_FOUND', 'PROFILE_NOT_FOUND', 'PROJECT_NOT_FOUND']);
const CONFLICT_CODES = new Set(['SCAN_ALREADY_ACTIVE', 'SCAN_NOT_ACTIVE', 'CONNECTION_ACTIVE', 'OWNER_MISMATCH', 'CONNECTION_OWNED', 'RESOURCE_BUSY']);

function discoveryErrorStatus(error) {
  if (BAD_REQUEST_CODES.has(error?.code)) return 400;
  if (NOT_FOUND_CODES.has(error?.code)) return 404;
  if (CONFLICT_CODES.has(error?.code)) return 409;
  return httpErrorStatus(error);
}

function mountDiscoveryRoutes({ app, discovery, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!discovery) throw new TypeError('discovery is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'discoveryWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(discoveryErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/discovery/runs', route(async (_req, res) => {
    res.json({ ok: true, runs: discovery.listRuns() });
  }));

  app.get('/api/v8/discovery/runs/:runId', route(async (req, res) => {
    res.json({ ok: true, run: discovery.getRun(req.params.runId) });
  }));

  app.post('/api/v8/discovery/unit-scan', route(async (req, res) => {
    const run = discovery.startUnitScan(req.body || {});
    broadcast({ type: 'discovery.scan-started', runId: run.runId, scanType: run.type, connectionId: run.connectionId });
    res.status(202).json({ ok: true, run });
  }));

  app.post('/api/v8/discovery/address-scan', route(async (req, res) => {
    const run = discovery.startAddressScan(req.body || {});
    broadcast({ type: 'discovery.scan-started', runId: run.runId, scanType: run.type, connectionId: run.connectionId });
    res.status(202).json({ ok: true, run });
  }));

  app.post('/api/v8/discovery/runs/:runId/cancel', route(async (req, res) => {
    const run = discovery.cancel(req.params.runId);
    broadcast({ type: 'discovery.scan-cancelling', runId: run.runId, connectionId: run.connectionId });
    res.json({ ok: true, run });
  }));

  app.get('/api/v8/discovery/runs/:runId/export', route(async (req, res) => {
    res.json({ ok: true, export: discovery.exportRun(req.params.runId) });
  }));

  app.post('/api/v8/discovery/runs/:runId/units/:unitId/master-job', route(async (req, res) => {
    const job = discovery.convertUnitToMasterJob(req.params.runId, Number(req.params.unitId), req.body || {});
    broadcast({ type: 'discovery.master-job-created', runId: req.params.runId, unitId: Number(req.params.unitId), jobId: job.jobId, connectionId: job.connectionId });
    res.status(201).json({ ok: true, job });
  }));
}

module.exports = {
  BAD_REQUEST_CODES,
  NOT_FOUND_CODES,
  CONFLICT_CODES,
  discoveryErrorStatus,
  mountDiscoveryRoutes,
};
