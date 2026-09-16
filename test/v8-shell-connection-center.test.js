'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-shell-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function json(base, pathname, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) } };
  if (init.body && typeof init.body !== 'string') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(init.body);
  }
  const response = await fetch(`${base}${pathname}`, init);
  const payload = await response.json();
  return { response, payload };
}

test('v8 connection-profile runtime describes serial/TCP/virtual resources without opening them', () => {
  const serial = v8.describeProfileRuntime({ connectionId: 's1', name: 'RTU', transportKind: 'serial-rtu', serial: { path: 'COM9', baudRate: 19200, parity: 'even' } });
  assert.equal(serial.kind, 'serial-rtu');
  assert.equal(serial.resourceKey, 'serial:COM9');
  assert.equal(serial.exclusive, true);
  assert.equal(serial.options.baudRate, 19200);

  const tcp = v8.describeProfileRuntime({ connectionId: 't1', name: 'TCP', transportKind: 'tcp-client', tcp: { host: '127.0.0.1', port: 1502 } });
  assert.equal(tcp.kind, 'tcp-client');
  assert.equal(tcp.exclusive, false);
  assert.match(tcp.resourceKey, /127\.0\.0\.1:1502$/);

  const virtual = v8.describeProfileRuntime({ connectionId: 'v1', name: 'Loop', transportKind: 'virtual-rtu' });
  assert.equal(virtual.kind, 'virtual-rtu');
  assert.equal(virtual.exclusive, true);
});

test('v8 preview Connection Center opens virtual profile with writes locked and does not persist runtime ownership', async (t) => {
  const dataDir = tempDir(t);
  const preview = await v8.startV8WorkbenchServer({ dataDir, port: 0, quiet: true });
  t.after(() => preview.close());
  const base = preview.url.replace(/\/v8\/$/, '');

  const status = await json(base, '/api/v8/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.payload.preview, true);
  assert.equal(status.payload.stableRelease, '7.0.0');
  assert.equal(status.payload.writePolicy, 'locked-by-default');
  const projectId = status.payload.activeProject.id;

  const saved = await json(base, `/api/v8/projects/${encodeURIComponent(projectId)}/connections/loop-1`, {
    method: 'PUT',
    body: { connectionId: 'loop-1', name: 'Loop 1', transport: 'VIRTUAL', transportKind: 'virtual-rtu', endpoint: 'Loop 1' },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.writeLock, 'LOCKED');
  assert.equal(saved.payload.ownerMode, 'none');
  assert.equal(saved.payload.writesEnabled, false);

  const opened = await json(base, '/api/v8/connections/loop-1/open', { method: 'POST', body: { projectId, ownerMode: 'master' } });
  assert.equal(opened.response.status, 200);
  assert.equal(opened.payload.state, 'open');
  assert.equal(opened.payload.ownerMode, 'master');
  assert.equal(opened.payload.writeLock, 'LOCKED');
  assert.equal(opened.payload.faultInjectionEnabled, false);

  const inventory = await json(base, '/api/v8/connections');
  assert.equal(inventory.payload.connections[0].runtime.state, 'open');
  assert.equal(inventory.payload.connections[0].runtime.writeLock, 'LOCKED');

  const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'workbench-v8.json'), 'utf8'));
  const persisted = disk.projects[0].connections[0];
  assert.equal(persisted.ownerMode, 'none');
  assert.equal(persisted.writeLock, 'LOCKED');
  assert.equal(persisted.writesEnabled, false);
  assert.equal(persisted.faultInjectionEnabled, false);

  const closed = await json(base, '/api/v8/connections/loop-1/close', { method: 'POST', body: { projectId } });
  assert.equal(closed.response.status, 200);
  assert.equal(closed.payload.state, 'closed');

  const tested = await json(base, '/api/v8/connections/loop-1/test', { method: 'POST', body: { projectId } });
  assert.equal(tested.response.status, 200);
  assert.equal(tested.payload.ok, true);
  assert.equal(tested.payload.writesArmed, false);
  assert.equal(tested.payload.broker.writeLock, 'LOCKED');
});

test('v8 Connection Center rejects cross-site mutations', async (t) => {
  const dataDir = tempDir(t);
  const preview = await v8.startV8WorkbenchServer({ dataDir, port: 0, quiet: true });
  t.after(() => preview.close());
  const base = preview.url.replace(/\/v8\/$/, '');
  const projectId = (await json(base, '/api/v8/status')).payload.activeProject.id;

  const result = await json(base, `/api/v8/projects/${encodeURIComponent(projectId)}/connections/bad`, {
    method: 'PUT',
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    body: { connectionId: 'bad', name: 'Bad', transportKind: 'virtual-rtu' },
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.payload.code, 'CROSS_SITE_MUTATION_BLOCKED');
  const inventory = await json(base, '/api/v8/connections');
  assert.equal(inventory.payload.connections.length, 0);
});

test('v8 Connection Center prevents edits/deletes while a profile owns a live runtime', async (t) => {
  const dataDir = tempDir(t);
  const preview = await v8.startV8WorkbenchServer({ dataDir, port: 0, quiet: true });
  t.after(() => preview.close());
  const base = preview.url.replace(/\/v8\/$/, '');
  const projectId = (await json(base, '/api/v8/status')).payload.activeProject.id;
  const profilePath = `/api/v8/projects/${encodeURIComponent(projectId)}/connections/loop`;

  await json(base, profilePath, { method: 'PUT', body: { connectionId: 'loop', name: 'Loop', transport: 'VIRTUAL', transportKind: 'virtual-rtu' } });
  await json(base, '/api/v8/connections/loop/open', { method: 'POST', body: { projectId, ownerMode: 'master' } });

  const edit = await json(base, profilePath, { method: 'PUT', body: { connectionId: 'loop', name: 'Changed', transport: 'VIRTUAL', transportKind: 'virtual-rtu' } });
  assert.equal(edit.response.status, 400);
  assert.equal(edit.payload.code, 'CONNECTION_ACTIVE');
  const remove = await json(base, profilePath, { method: 'DELETE' });
  assert.equal(remove.response.status, 400);
  assert.equal(remove.payload.code, 'CONNECTION_ACTIVE');

  await json(base, '/api/v8/connections/loop/close', { method: 'POST', body: { projectId } });
  const after = await json(base, profilePath, { method: 'PUT', body: { connectionId: 'loop', name: 'Changed', transport: 'VIRTUAL', transportKind: 'virtual-rtu' } });
  assert.equal(after.response.status, 200);
  assert.equal(after.payload.name, 'Changed');
});

test('v8 preview restart restores profiles but no live owner/write capability', async (t) => {
  const dataDir = tempDir(t);
  const first = await v8.startV8WorkbenchServer({ dataDir, port: 0, quiet: true });
  const base1 = first.url.replace(/\/v8\/$/, '');
  const projectId = (await json(base1, '/api/v8/status')).payload.activeProject.id;
  await json(base1, `/api/v8/projects/${encodeURIComponent(projectId)}/connections/loop`, { method: 'PUT', body: { connectionId: 'loop', name: 'Loop', transport: 'VIRTUAL', transportKind: 'virtual-rtu' } });
  await json(base1, '/api/v8/connections/loop/open', { method: 'POST', body: { projectId, ownerMode: 'master' } });
  await first.close();

  const second = await v8.startV8WorkbenchServer({ dataDir, port: 0, quiet: true });
  t.after(() => second.close());
  const base2 = second.url.replace(/\/v8\/$/, '');
  const inventory = await json(base2, '/api/v8/connections');
  assert.equal(inventory.payload.connections.length, 1);
  assert.equal(inventory.payload.connections[0].runtime, null);
  assert.equal(inventory.payload.connections[0].profile.writeLock, 'LOCKED');
  assert.equal(inventory.payload.connections[0].profile.ownerMode, 'none');
  assert.equal(inventory.payload.connections[0].profile.writesEnabled, false);
});
