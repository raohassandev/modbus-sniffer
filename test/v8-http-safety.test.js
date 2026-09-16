'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { V8ProjectStore } = require('../src/v8/project');
const { ConnectionBroker } = require('../src/v8/connectionBroker');
const { startV8WorkbenchServer } = require('../src/v8/workbenchServer');
const {
  createMutationRateLimiter,
  isLoopbackHostname,
  loopbackHostGuard,
  webSocketOriginAllowed,
} = require('../src/v8/security/httpSafety');

async function setup(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-http-safety-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  const web = await startV8WorkbenchServer({ store, broker, host: '127.0.0.1', port: 0, ...options });
  t.after(async () => { await web.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); });
  return { store, web };
}

function openWs(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
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

test('v8 realtime WebSocket rejects cross-origin browser handshakes and allows same-origin/local clients', async (t) => {
  const { web } = await setup(t);
  const origin = web.url.replace(/\/v8\/$/, '');
  const wsUrl = `${origin.replace(/^http/, 'ws')}/ws/v8`;

  const rejectedStatus = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example' } });
    ws.once('open', () => reject(new Error('cross-origin WebSocket unexpectedly opened')));
    ws.once('unexpected-response', (_request, response) => {
      const status = response.statusCode;
      response.resume();
      resolve(status);
    });
    ws.once('error', (error) => {
      if (error?.message?.includes('Unexpected server response: 403')) resolve(403);
      else reject(error);
    });
  });
  assert.equal(rejectedStatus, 403);

  const sameOrigin = await openWs(wsUrl, { headers: { Origin: origin } });
  sameOrigin.close();
  const localAutomation = await openWs(wsUrl);
  localAutomation.close();
});

test('v8 WebSocket origin helper rejects invalid/cross-origin and DNS-rebinding hosts', () => {
  assert.equal(webSocketOriginAllowed({ headers: { host: '127.0.0.1:18777' }, socket: {}, }), true);
  assert.equal(webSocketOriginAllowed({ headers: { host: '127.0.0.1:18777', origin: 'null' }, socket: {} }), false);
  assert.equal(webSocketOriginAllowed({ headers: { host: '127.0.0.1:18777', origin: 'https://evil.example' }, socket: {} }), false);
  assert.equal(webSocketOriginAllowed({ headers: { host: '127.0.0.1:18777', origin: 'http://127.0.0.1:18777' }, socket: {} }), true);
  assert.equal(webSocketOriginAllowed({ headers: { host: 'evil.example:18777', origin: 'http://evil.example:18777' }, socket: {} }), false);
});

test('v8 loopback boundary recognizes only local web bind hosts', () => {
  assert.equal(isLoopbackHostname('127.0.0.1'), true);
  assert.equal(isLoopbackHostname('127.25.1.9'), true);
  assert.equal(isLoopbackHostname('localhost'), true);
  assert.equal(isLoopbackHostname('::1'), true);
  assert.equal(isLoopbackHostname('0.0.0.0'), false);
  assert.equal(isLoopbackHostname('192.168.1.20'), false);
  assert.equal(isLoopbackHostname('evil.example'), false);
});

test('v8 HTTP host guard rejects DNS-rebinding Host headers before routes execute', () => {
  const state = { status: 200, payload: null, next: 0 };
  const res = {
    status(code) { state.status = code; return this; },
    json(payload) { state.payload = payload; return this; },
  };
  loopbackHostGuard({ headers: { host: 'evil.example:8088' } }, res, () => { state.next += 1; });
  assert.equal(state.next, 0);
  assert.equal(state.status, 403);
  assert.equal(state.payload.error.code, 'NON_LOOPBACK_HOST');

  const allowed = { headers: { host: '127.0.0.1:8088' } };
  loopbackHostGuard(allowed, res, () => { state.next += 1; });
  assert.equal(state.next, 1);
});

test('v8 Workbench server rejects non-loopback bind addresses before listen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-remote-bind-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  try {
    assert.throws(
      () => startV8WorkbenchServer({ store, broker, host: '0.0.0.0', port: 0 }),
      /loopback address/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
});

test('v8 server returns structured 413 for an oversized request body', async (t) => {
  const { store, web } = await setup(t);
  const origin = web.url.replace(/\/v8\/$/, '');
  const projectId = store.getActiveProject().id;
  const body = JSON.stringify({ data: 'x'.repeat(3 * 1024 * 1024) });
  const response = await fetch(`${origin}/api/v8/projects/${encodeURIComponent(projectId)}/ui`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
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
