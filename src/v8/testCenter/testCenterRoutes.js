'use strict';

const { httpErrorStatus, errorPayload } = require('../workbenchServer');

const BAD_REQUEST_CODES = new Set([
  'CONNECTION_REQUIRED',
  'TEST_TRANSPORT_UNSUPPORTED',
  'RECIPE_CONNECTION_REQUIRED',
  'INVALID_HEX',
  'EMPTY_FRAME',
  'AMBIGUOUS_INPUT',
  'INVALID_MASK',
  'LAB_CONFIRMATION_REQUIRED',
  'LAB_NOT_ARMED',
  'WRITE_CONFIRMATION_REQUIRED',
  'INVALID_REPEAT_COUNT',
  'INVALID_REPEAT_INTERVAL',
  'INVALID_RECIPE',
  'UNSUPPORTED_RECIPE_VERSION',
  'INVALID_STEP',
  'INVALID_STEP_TYPE',
  'DUPLICATE_STEP_ID',
  'INVALID_REPEAT',
  'INVALID_TIMEOUT',
  'INVALID_DELAY',
  'INVALID_VARIABLE',
  'INVALID_ASSERTION',
  'ASSERTION_FAILED',
  'UNSUPPORTED_WRITE_FC',
  'WRITE_SAFETY_REQUIRED',
  'RAW_STUDIO_REQUIRED',
  'CONFIRMATION_REQUIRED',
  'BULK_CONFIRMATION_REQUIRED',
  'BROADCAST_CONFIRMATION_REQUIRED',
]);

const NOT_FOUND_CODES = new Set(['PROFILE_NOT_FOUND']);
const CONFLICT_CODES = new Set(['TEST_SESSION_NOT_OPEN', 'OWNER_MISMATCH', 'CONNECTION_OWNED', 'RESOURCE_BUSY', 'RECIPE_BUSY']);

function testCenterErrorStatus(error) {
  if (BAD_REQUEST_CODES.has(error?.code)) return 400;
  if (NOT_FOUND_CODES.has(error?.code)) return 404;
  if (CONFLICT_CODES.has(error?.code)) return 409;
  return httpErrorStatus(error);
}

function jsonSafe(value) {
  if (Buffer.isBuffer(value)) return value.toString('hex').toUpperCase();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = jsonSafe(child);
    return out;
  }
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function resultView(result) {
  if (!result) return null;
  return Object.freeze({
    ok: Boolean(result.ok),
    intent: result.intent || null,
    classification: jsonSafe(result.classification || null),
    requestRawHex: result.requestRaw ? Buffer.from(result.requestRaw).toString('hex').toUpperCase() : null,
    responseRawHex: result.responseRaw ? Buffer.from(result.responseRaw).toString('hex').toUpperCase() : null,
    rttMs: result.rttMs ?? null,
  });
}

function mountTestCenterRoutes({ app, testCenter, flags, assertFeature, broadcast = () => {} } = {}) {
  if (!app) throw new TypeError('app is required');
  if (!testCenter) throw new TypeError('testCenter is required');
  if (typeof assertFeature !== 'function') throw new TypeError('assertFeature is required');

  const route = (handler) => async (req, res) => {
    try {
      assertFeature(flags, 'testCenterWorkspace');
      await handler(req, res);
    } catch (error) {
      res.status(testCenterErrorStatus(error)).json(errorPayload(error));
    }
  };

  app.get('/api/v8/test-center', route(async (_req, res) => {
    res.json({ ok: true, ...testCenter.snapshot() });
  }));

  app.post('/api/v8/test-center/session/:connectionId/open', route(async (req, res) => {
    const session = await testCenter.open(req.params.connectionId);
    broadcast({ type: 'test-center.session-opened', connectionId: req.params.connectionId });
    res.json({ ok: true, session });
  }));

  app.post('/api/v8/test-center/session/:connectionId/disconnect', route(async (req, res) => {
    const connection = await testCenter.disconnect(req.params.connectionId);
    broadcast({ type: 'test-center.session-closed', connectionId: req.params.connectionId });
    res.json({ ok: true, connection });
  }));

  app.post('/api/v8/test-center/raw/send', route(async (req, res) => {
    const result = await testCenter.sendRaw(req.body || {});
    broadcast({ type: 'test-center.raw-complete', connectionId: req.body?.connectionId, intent: result.intent, rttMs: result.rttMs });
    res.json({ ok: true, result: resultView(result) });
  }));

  app.post('/api/v8/test-center/raw/repeat', route(async (req, res) => {
    const results = await testCenter.repeatRaw(req.body || {});
    broadcast({ type: 'test-center.raw-repeat-complete', connectionId: req.body?.connectionId, count: results.length });
    res.json({ ok: true, results: results.map(resultView) });
  }));

  app.post('/api/v8/test-center/lab/:connectionId/arm', route(async (req, res) => {
    const status = await testCenter.armLab(req.params.connectionId, req.body || {});
    broadcast({ type: 'test-center.lab-armed', connectionId: req.params.connectionId });
    res.json({ ok: true, status });
  }));

  app.post('/api/v8/test-center/lab/:connectionId/disarm', route(async (req, res) => {
    const status = testCenter.disarmLab(req.params.connectionId, req.body?.reason || 'manual');
    broadcast({ type: 'test-center.lab-disarmed', connectionId: req.params.connectionId });
    res.json({ ok: true, status });
  }));

  app.post('/api/v8/test-center/writes/:connectionId/arm', route(async (req, res) => {
    const status = await testCenter.armWrites(req.params.connectionId, req.body || {});
    broadcast({ type: 'test-center.writes-armed', connectionId: req.params.connectionId });
    res.json({ ok: true, status });
  }));

  app.post('/api/v8/test-center/writes/:connectionId/lock', route(async (req, res) => {
    const status = testCenter.lockWrites(req.params.connectionId, req.body?.reason || 'manual');
    broadcast({ type: 'test-center.writes-locked', connectionId: req.params.connectionId });
    res.json({ ok: true, status });
  }));

  app.get('/api/v8/test-center/audit/:connectionId', route(async (req, res) => {
    const limit = Number(req.query.limit || 200);
    res.json({ ok: true, audit: testCenter.audit(req.params.connectionId, { limit }) });
  }));

  app.post('/api/v8/test-center/recipe/run', route(async (req, res) => {
    const body = req.body || {};
    const result = await testCenter.runRecipe(body.recipe, {
      variables: body.variables || {},
      defaultConnectionId: body.defaultConnectionId || null,
    });
    broadcast({ type: 'test-center.recipe-complete', runId: result.runId, passed: result.passed });
    res.json({ ok: true, result });
  }));

  for (const action of ['pause', 'resume', 'stop']) {
    app.post(`/api/v8/test-center/recipe/${action}`, route(async (_req, res) => {
      const status = testCenter[`${action}Recipe`]();
      broadcast({ type: `test-center.recipe-${action}` });
      res.json({ ok: true, status });
    }));
  }
}

module.exports = {
  BAD_REQUEST_CODES,
  testCenterErrorStatus,
  resultView,
  mountTestCenterRoutes,
};
