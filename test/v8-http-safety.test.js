'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { V8ProjectStore } = require('../src/v8/project');
const { ConnectionBroker } = require('../src/v8/connectionBroker');
const { startV8WorkbenchServer } = require('../src/v8/workbenchServer');
const { createMutationRateLimiter } = require('../src/v8/security/httpSafety');

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-http-safety-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  const web = await startV8WorkbenchServer({ store, broker, host: '127.0.0.1', port: 0 });
  t.after(async () => { await web.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); });
  return { store, web };
}

test('v8 server rejects cross-origin browser mutations but allows same-origin and non-browser clients', async (t) => {
  const { store, web } = await setup(t);
  const origin = web.url.replace(/\/v8\/$/, '');
  const projectId = store.getActiveProject().id;
  const url = `${origin}/api/v8/projects/${encodeURIComponent(projectId)}/ui`;

  const cross = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(cross.status, 403);
  assert.equal((await cross.json()).error.code, 'CROSS_SITE_MUTATION');

  const same = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ theme: 'dark' }) });
  assert.equal(same.status, 200);

  const automation = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ density: 'compact' }) });
  assert.equal(automation.status, 200);
});

test('v8 server returns structured 413 before parsing an oversized declared body', async (t) => {
  const { store, web } = await setup(t);
  const origin = web.url.replace(/\/v8\/$/, '');
  const projectId = store.getActiveProject().id;
  const response = await fetch(`${origin}/api/v8/projects/${encodeURIComponent(projectId)}/ui`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) },
    body: '{}',
    duplex: 'half',
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_TOO_LARGE');
});

test('v8 mutation rate limiter blocks only after configured budget', () => {
  const middleware = createMutationRateLimiter({ windowMs: 60000, max: 2 });
  const request = { method: 'POST', ip: '127.0.0.1', socket: {} };
  const makeResponse = () => {
    const state = { status: 200, payload: null, headers: {} };
    return {
      state,
      status(code) { state.status = code; return this; },
      json(payload) { state.payload = payload; return this; },
      setHeader(key, value) { state.headers[key] = value; },
    };
  };
  let nextCount = 0;
  const a = makeResponse(); const b = makeResponse(); const c = makeResponse();
  middleware(request, a, () => { nextCount += 1; });
  middleware(request, b, () => { nextCount += 1; });
  middleware(request, c, () => { nextCount += 1; });
  assert.equal(nextCount, 2);
  assert.equal(c.state.status, 429);
  assert.equal(c.state.payload.error.code, 'MUTATION_RATE_LIMIT');
});
