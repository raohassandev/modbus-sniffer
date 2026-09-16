'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST = new Set([
  'INVALID_TWIN',
  'NO_SOURCE_POINTS',
  'TARGET_CONNECTION_REQUIRED',
  'CONFIRMATION_REQUIRED',
  'TWIN_NOT_APPLIED',
  'DIGITAL_TWIN_APPROVAL_REQUIRED',
]);
const NOT_FOUND = new Set(['TWIN_NOT_FOUND', 'PROJECT_NOT_FOUND', 'SERVER_NOT_FOUND']);

function digitalTwinErrorStatus(error) {
  if (BAD_REQUEST.has(error?.code)) return 400;
  if (NOT_FOUND.has(error?.code)) return 404;
  if (['SERVER_RUNNING', 'CONNECTION_ACTIVE', 'CONNECTION_ALREADY_ASSIGNED', 'UNIT_ID_CONFLICT'].includes(error?.code)) return 409;
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

  app.post('/api/v8/digital-twins/:twinId/apply', route(async (req, res) => {
    const current = digitalTwin.get(req.params.twinId);
    const body = req.body || {};
    let twin = current;
    if (body.targetConnectionId || body.serverId || body.framing || body.writableAreas) {
      twin = digitalTwin.saveDraft({
        ...current,
        twinId: current.twinId,
        sourceConnectionId: current.source.connectionId,
        targetConnectionId: body.targetConnectionId ?? current.target.connectionId,
        serverId: body.serverId ?? current.target.serverId,
        framing: body.framing ?? current.target.framing,
        receivePollMs: body.receivePollMs ?? current.target.receivePollMs,
        writableAreas: body.writableAreas ?? current.safety.writableAreas,
        unitIds: current.source.unitIds,
        name: body.name ?? current.name,
      });
    }
    twin = digitalTwin.apply(twin.twinId);
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
