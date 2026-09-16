'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

function mountMasterWorkspaceRoutes({ app, masterWorkspace, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!masterWorkspace) throw new TypeError('masterWorkspace is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'masterWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(httpErrorStatus(error)).json(errorPayload(error));
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
  mountMasterWorkspaceRoutes,
};
