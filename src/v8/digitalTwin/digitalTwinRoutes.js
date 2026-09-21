'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST = new Set([
  'INVALID_TWIN',
  'NO_SOURCE_POINTS',
  'TARGET_CONNECTION_REQUIRED',
  'CONFIRMATION_REQUIRED',
  'TWIN_NOT_APPLIED',
  'TWIN_ALREADY_APPROVED',
  'DIGITAL_TWIN_APPROVAL_REQUIRED',
]);
const NOT_FOUND = new Set(['TWIN_NOT_FOUND', 'PROJECT_NOT_FOUND', 'SERVER_NOT_FOUND']);
const CONFLICT = new Set(['SERVER_RUNNING', 'CONNECTION_ACTIVE', 'CONNECTION_ALREADY_ASSIGNED', 'UNIT_ID_CONFLICT', 'TWIN_TARGET_CONFLICT', 'TWIN_SNAPSHOT_UNAVAILABLE']);

function digitalTwinErrorStatus(error) {
  if (BAD_REQUEST.has(error?.code)) return 400;
  if (NOT_FOUND.has(error?.code)) return 404;
  if (CONFLICT.has(error?.code)) return 409;
  return httpErrorStatus(error);
}

function mountDigitalTwinRoutes({ app, digitalTwin, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!digitalTwin) throw new TypeError('digitalTwin is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'digitalTwinWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(digitalTwinErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/digital-twins', route(async (_req, res) => {
    res.json({ ok: true, twins: digitalTwin.list() });
  }));

  app.get('/api/v8/digital-twins/:twinId', route(async (req, res) => {
    res.json({ ok: true, twin: digitalTwin.get(req.params.twinId) });
  }));

  app.post('/api/v8/digital-twins/preview', route(async (req, res) => {
    res.json({ ok: true, twin: digitalTwin.preview(req.body || {}) });
  }));

  app.post('/api/v8/digital-twins', route(async (req, res) => {
    const twin = digitalTwin.saveDraft(req.body || {});
    broadcast({ type: 'digital-twin.draft-saved', twinId: twin.twinId });
    res.status(201).json({ ok: true, twin });
  }));

  app.patch('/api/v8/digital-twins/:twinId', route(async (req, res) => {
    const twin = digitalTwin.retarget(req.params.twinId, req.body || {});
    broadcast({ type: 'digital-twin.retargeted', twinId: twin.twinId, serverId: twin.target.serverId });
    res.json({ ok: true, twin });
  }));

  app.post('/api/v8/digital-twins/:twinId/apply', route(async (req, res) => {
    const body = req.body || {};
    const hasTargetPatch = ['targetConnectionId', 'serverId', 'framing', 'receivePollMs', 'writableAreas', 'name']
      .some((field) => Object.prototype.hasOwnProperty.call(body, field));
    const twin = hasTargetPatch && typeof digitalTwin.applyWithPatch === 'function'
      ? digitalTwin.applyWithPatch(req.params.twinId, body)
      : (() => {
          if (hasTargetPatch) digitalTwin.retarget(req.params.twinId, body);
          return digitalTwin.apply(req.params.twinId);
        })();
    broadcast({ type: 'digital-twin.applied', twinId: twin.twinId, serverId: twin.target.serverId });
    res.json({ ok: true, twin });
  }));

  app.post('/api/v8/digital-twins/:twinId/approve', route(async (req, res) => {
    const twin = digitalTwin.approve(req.params.twinId, { confirmed: req.body?.confirmed === true });
    broadcast({ type: 'digital-twin.approved', twinId: twin.twinId, serverId: twin.target.serverId });
    res.json({ ok: true, twin });
  }));

  app.delete('/api/v8/digital-twins/:twinId', route(async (req, res) => {
    const removed = digitalTwin.remove(req.params.twinId, { removeSimulator: String(req.query?.removeSimulator || '').toLowerCase() === 'true' });
    broadcast({ type: 'digital-twin.removed', twinId: req.params.twinId });
    res.json({ ok: true, removed });
  }));
}

module.exports = {
  digitalTwinErrorStatus,
  mountDigitalTwinRoutes,
};
