'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST_CODES = new Set([
  'INVALID_MASTER_JOB',
  'UNSUPPORTED_POLL_FUNCTION',
  'ADDRESS_RANGE_OVERFLOW',
  'INVALID_SERIAL_UNIT_ID',
  'CONNECTION_REQUIRED',
  'MASTER_TRANSPORT_UNSUPPORTED',
  'UNSUPPORTED_WRITE_FUNCTION',
  'WRITE_VALUE_REQUIRED',
  'WRITE_VALUES_REQUIRED',
  'CONFIRMATION_REQUIRED',
  'BULK_CONFIRMATION_REQUIRED',
  'BROADCAST_CONFIRMATION_REQUIRED',
  'INVALID_COIL_VALUE',
  'UINT16_OUT_OF_RANGE',
  'QUANTITY_OUT_OF_RANGE',
]);

const NOT_FOUND_CODES = new Set(['MASTER_JOB_NOT_FOUND', 'PROFILE_NOT_FOUND', 'PROJECT_NOT_FOUND']);
const CONFLICT_CODES = new Set(['MASTER_JOB_CONNECTION_IMMUTABLE', 'MASTER_SESSION_NOT_OPEN', 'OWNER_MISMATCH', 'CONNECTION_OWNED', 'RESOURCE_BUSY']);

function masterErrorStatus(error) {
  if (BAD_REQUEST_CODES.has(error?.code)) return 400;
  if (NOT_FOUND_CODES.has(error?.code)) return 404;
  if (CONFLICT_CODES.has(error?.code)) return 409;
  return httpErrorStatus(error);
}

function validateWriteBody(body = {}) {
  const functionCode = Number(body.functionCode);
  if (functionCode === 15 && Array.isArray(body.values)) {
    const invalidIndex = body.values.findIndex((value) => ![true, false, 0, 1].includes(value));
    if (invalidIndex >= 0) {
      const error = new Error('FC15 values must be boolean, 0 or 1');
      error.code = 'INVALID_COIL_VALUE';
      error.details = { index: invalidIndex, value: body.values[invalidIndex] };
      throw error;
    }
  }
  if (functionCode === 5 && ![true, false, 0, 1, 0x0000, 0xFF00].includes(body.value)) {
    const error = new Error('FC05 value must be boolean, 0/1 or 0x0000/0xFF00');
    error.code = 'INVALID_COIL_VALUE';
    error.details = { value: body.value };
    throw error;
  }
}

function mountMasterWorkspaceRoutes({ app, masterWorkspace, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!masterWorkspace) throw new TypeError('masterWorkspace is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'masterWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(masterErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/master', route(async (_req, res) => {
    res.json({ ok: true, ...masterWorkspace.snapshot() });
  }));

  app.get('/api/v8/master/jobs', route(async (_req, res) => {
    res.json({ ok: true, jobs: masterWorkspace.listJobs() });
  }));

  app.post('/api/v8/master/jobs', route(async (req, res) => {
    const job = masterWorkspace.saveJob(req.body || {});
    broadcast({ type: 'master.job-saved', connectionId: job.connectionId, jobId: job.jobId });
    res.status(201).json({ ok: true, job });
  }));

  app.patch('/api/v8/master/jobs/:jobId', route(async (req, res) => {
    const current = masterWorkspace.getJob(req.params.jobId);
    const job = masterWorkspace.saveJob({ ...current, ...(req.body || {}), jobId: current.jobId, connectionId: current.connectionId });
    broadcast({ type: 'master.job-saved', connectionId: job.connectionId, jobId: job.jobId });
    res.json({ ok: true, job });
  }));

  app.delete('/api/v8/master/jobs/:jobId', route(async (req, res) => {
    const job = masterWorkspace.removeJob(req.params.jobId);
    broadcast({ type: 'master.job-removed', connectionId: job.connectionId, jobId: job.jobId });
    res.json({ ok: true, removed: job });
  }));

  app.post('/api/v8/master/read', route(async (req, res) => {
    const result = await masterWorkspace.readOnce(req.body || {});
    broadcast({ type: 'master.read-complete', connectionId: req.body?.connectionId, unitId: result.unitId, functionCode: result.functionCode, rttMs: result.rttMs });
    res.json({ ok: true, result });
  }));

  app.post('/api/v8/master/write', route(async (req, res) => {
    validateWriteBody(req.body || {});
    const result = await masterWorkspace.writeOnce(req.body || {});
    broadcast({ type: 'master.write-complete', connectionId: req.body?.connectionId, unitId: result.unitId, functionCode: result.functionCode, rttMs: result.rttMs });
    res.json({ ok: true, result });
  }));

  app.post('/api/v8/master/jobs/:jobId/read', route(async (req, res) => {
    const result = await masterWorkspace.readJobNow(req.params.jobId);
    broadcast({ type: 'master.job-read', jobId: req.params.jobId, rttMs: result.rttMs });
    res.json({ ok: true, result });
  }));

  for (const action of ['start', 'pause', 'resume', 'stop']) {
    app.post(`/api/v8/master/runtime/:connectionId/${action}`, route(async (req, res) => {
      const connectionId = req.params.connectionId;
      const snapshot = action === 'start'
        ? await masterWorkspace.start(connectionId)
        : masterWorkspace[action](connectionId);
      broadcast({ type: `master.scheduler-${action}`, connectionId });
      res.json({ ok: true, scheduler: snapshot });
    }));
  }

  app.post('/api/v8/master/runtime/:connectionId/disconnect', route(async (req, res) => {
    const connection = await masterWorkspace.disconnect(req.params.connectionId);
    broadcast({ type: 'master.session-closed', connectionId: req.params.connectionId });
    res.json({ ok: true, connection });
  }));
}

module.exports = {
  BAD_REQUEST_CODES,
  masterErrorStatus,
  validateWriteBody,
  mountMasterWorkspaceRoutes,
};
