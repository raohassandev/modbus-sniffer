'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-web-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json();
  return { response, payload };
}

test('v8 shell serves status, safe project UI preferences and connection lifecycle APIs', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const server = await v8.startV8WorkbenchServer({ store, broker, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const shell = await fetch(`${base}/v8/`);
  assert.equal(shell.status, 200);
  const shellHtml=await shell.text();
  assert.match(shellHtml, /Modbus Engineering Tool/);
  assert.match(shellHtml, /Compatibility Lab/);
  assert.match(shellHtml, /internal compatibility lab/);
  assert.doesNotMatch(shellHtml, /experimental Modbus-only integration/);

  const status = await json(`${base}/api/v8/status`);
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.ok, true);
  assert.equal(status.payload.schemaVersion, 3);
  assert.equal(status.payload.flags.shell, true);
  assert.equal(status.payload.activeProject.id, status.payload.activeProjectId);

  const create = await json(`${base}/api/v8/connections`, {
    method: 'POST',
    body: JSON.stringify({ connectionId: 'web-virtual', name: 'Web Virtual', transportKind: 'virtual' }),
  });
  assert.equal(create.response.status, 201);
  assert.equal(create.payload.connection.runtime.writeLock, 'LOCKED');
  assert.equal(create.payload.connection.profile.ownerMode, 'none');

  const open = await json(`${base}/api/v8/connections/web-virtual/open`, {
    method: 'POST',
    body: JSON.stringify({ ownerMode: 'master' }),
  });
  assert.equal(open.response.status, 200);
  assert.equal(open.payload.connection.runtime.state, 'open');
  assert.equal(open.payload.connection.runtime.owner.ownerMode, 'master');
  assert.equal(open.payload.connection.runtime.writeLock, 'LOCKED');

  const projects = await json(`${base}/api/v8/projects`);
  const projectId = projects.payload.activeProjectId;
  const preferences = await json(`${base}/api/v8/projects/${encodeURIComponent(projectId)}/ui`, {
    method: 'PATCH',
    body: JSON.stringify({ theme: 'dark', density: 'dense', layout: { inspectorCollapsed: true } }),
  });
  assert.equal(preferences.payload.ui.theme, 'dark');
  assert.equal(preferences.payload.ui.density, 'dense');

  const close = await json(`${base}/api/v8/connections/web-virtual/close`, { method: 'POST', body: '{}' });
  assert.equal(close.payload.connection.runtime.state, 'closed');
  assert.equal(close.payload.connection.runtime.owner, null);

  const persisted = store.listConnectionProfiles(projectId)[0];
  assert.equal(persisted.writeLock, 'LOCKED');
  assert.equal(persisted.ownerMode, 'none');
  assert.equal(persisted.enabled, false);
});

test('v8 shell websocket publishes runtime events', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const server = await v8.startV8WorkbenchServer({ store, broker, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;
  await json(`${base}/api/v8/connections`, {
    method: 'POST',
    body: JSON.stringify({ connectionId: 'ws-virtual', name: 'WS Virtual', transportKind: 'virtual' }),
  });

  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/v8`);
  t.after(() => ws.close());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('websocket open timeout')), 1000);
    ws.once('open', () => { clearTimeout(timer); resolve(); });
    ws.once('error', reject);
  });
  ws.on('message', (data) => {
    try { messages.push(JSON.parse(data.toString())); } catch { /* ignore malformed test noise */ }
  });

  await json(`${base}/api/v8/connections/ws-virtual/open`, {
    method: 'POST',
    body: JSON.stringify({ ownerMode: 'master' }),
  });

  await new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (messages.some((entry) => entry.type === 'runtime.event' || entry.type === 'connection.opened')) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 1000) {
        clearInterval(timer);
        reject(new Error('expected websocket runtime event'));
      }
    }, 10);
  });

  assert.equal(messages.some((entry) => entry.type === 'runtime.event' || entry.type === 'connection.opened'), true);
  await json(`${base}/api/v8/connections/ws-virtual/close`, { method: 'POST', body: '{}' });
});

test('v8 shell refuses project switching while a connection is active', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const secondProject = store.createProject({ name: 'Second' });
  const broker = new v8.ConnectionBroker();
  const server = await v8.startV8WorkbenchServer({ store, broker, host: '127.0.0.1', port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  await json(`${base}/api/v8/connections`, {
    method: 'POST',
    body: JSON.stringify({ connectionId: 'active-virtual', name: 'Active', transportKind: 'virtual' }),
  });
  await json(`${base}/api/v8/connections/active-virtual/open`, {
    method: 'POST',
    body: JSON.stringify({ ownerMode: 'master' }),
  });

  const switched = await json(`${base}/api/v8/projects/${encodeURIComponent(secondProject.id)}/active`, {
    method: 'POST',
    body: '{}',
  });
  assert.equal(switched.response.status, 409);
  assert.equal(switched.payload.error.code, 'CONNECTION_ACTIVE');

  await json(`${base}/api/v8/connections/active-virtual/close`, { method: 'POST', body: '{}' });
});
