'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');
const v8Dev = require('../src/index-v8-dev');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function json(response) {
  const body = await response.json();
  return { response, body };
}

async function createShellRig(t) {
  const dir = tempDir('modbus-v8-shell-');
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const project = store.getActiveProject();
  store.upsertConnectionProfile(project.id, {
    connectionId: 'lab-loop',
    name: 'Lab Loopback',
    transport: 'VIRTUAL',
    transportKind: 'virtual',
    metadata: { resourceKey: 'virtual:lab-loop' },
  });
  const shell = v8.createV8ShellServer({ dataDir: dir, store });
  const address = await shell.start({ host: '127.0.0.1', port: 0 });
  t.after(() => shell.stop());
  return { dir, store, shell, base: address.url };
}

test('v8 development shell renders a real Connection Center with stable-v7 boundary', async (t) => {
  const rig = await createShellRig(t);
  const response = await fetch(`${rig.base}/v8/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Modbus Engineering Workbench/);
  assert.match(html, /WRITE LOCKED/);
  assert.match(html, /Connection Center/);

  const status = await json(await fetch(`${rig.base}/api/v8/status`));
  assert.equal(status.response.status, 200);
  assert.equal(status.body.stableProductVersion, '7.0.0');
  assert.equal(status.body.workbenchVersion, '8-dev');
  assert.equal(status.body.schemaVersion, 3);
  assert.equal(status.body.features.appShell, true);
  assert.equal(status.body.features.connectionCenter, true);
  assert.equal(status.body.features.masterWorkspace, false);
});

test('v8 Connection Center exposes exact broker ownership and never opens a profile implicitly', async (t) => {
  const rig = await createShellRig(t);
  let listed = await json(await fetch(`${rig.base}/api/v8/connections`));
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].runtime.state, 'closed');
  assert.equal(listed.body[0].runtime.owner, null);
  assert.equal(listed.body[0].runtime.transmitCapability, 'none');
  assert.equal(listed.body[0].runtime.writeLock, 'LOCKED');

  const opened = await json(await fetch(`${rig.base}/api/v8/connections/lab-loop/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerMode: 'master' }),
  }));
  assert.equal(opened.response.status, 200);
  assert.equal(opened.body.state, 'open');
  assert.equal(opened.body.owner.ownerMode, 'master');
  assert.equal(opened.body.transmitCapability, 'active');
  assert.equal(opened.body.writeLock, 'LOCKED');

  const status = await json(await fetch(`${rig.base}/api/v8/status`));
  const active = status.body.connections.find((entry) => entry.connectionId === 'lab-loop');
  assert.equal(active.state, 'open');
  assert.equal(active.ownerMode, 'master');
  assert.equal(active.transmitCapability, 'active');
  assert.equal(active.writeLock, 'LOCKED');

  const conflict = await json(await fetch(`${rig.base}/api/v8/connections/lab-loop/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerMode: 'test' }),
  }));
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.code, 'CONNECTION_BUSY');

  const closed = await json(await fetch(`${rig.base}/api/v8/connections/lab-loop/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }));
  assert.equal(closed.response.status, 200);
  assert.equal(closed.body.state, 'closed');
  assert.equal(closed.body.owner, null);
  assert.equal(closed.body.writeLock, 'LOCKED');

  listed = await json(await fetch(`${rig.base}/api/v8/connections`));
  assert.equal(listed.body[0].runtime.state, 'closed');
  assert.equal(listed.body[0].runtime.owner, null);
  assert.equal(listed.body[0].runtime.writeLock, 'LOCKED');
});

test('v8 Connection Center sanitizes attempted persisted live/write/fault state', async (t) => {
  const rig = await createShellRig(t);
  const created = await json(await fetch(`${rig.base}/api/v8/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connectionId: 'dangerous-import',
      name: 'Dangerous Import',
      transport: 'VIRTUAL',
      transportKind: 'virtual',
      ownerMode: 'test',
      transmitCapability: 'active',
      activation: 'automatic',
      enabled: true,
      writeLock: 'ENABLED',
      writesEnabled: true,
      faultInjectionEnabled: true,
    }),
  }));
  assert.equal(created.response.status, 201);
  assert.equal(created.body.activation, 'manual');
  assert.equal(created.body.ownerMode, 'none');
  assert.equal(created.body.transmitCapability, 'none');
  assert.equal(created.body.enabled, false);
  assert.equal(created.body.writeLock, 'LOCKED');
  assert.equal(created.body.writesEnabled, false);
  assert.equal(created.body.faultInjectionEnabled, false);

  const persisted = rig.store.listConnectionProfiles(rig.store.getActiveProject().id)
    .find((entry) => entry.connectionId === 'dangerous-import');
  assert.equal(persisted.writeLock, 'LOCKED');
  assert.equal(persisted.ownerMode, 'none');
  assert.equal(persisted.enabled, false);
});

test('v8 shell blocks cross-origin mutations and non-loopback development binds', async (t) => {
  const rig = await createShellRig(t);
  const blocked = await json(await fetch(`${rig.base}/api/v8/connections/lab-loop/open`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ownerMode: 'master' }),
  }));
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.code, 'CROSS_ORIGIN_MUTATION_BLOCKED');

  const isolated = v8.createV8ShellServer({ dataDir: tempDir('modbus-v8-bind-') });
  await assert.rejects(
    () => isolated.start({ host: '0.0.0.0', port: 0 }),
    (error) => error.code === 'V8_DEV_LOCAL_ONLY',
  );
  await isolated.stop();
});

test('v8 project switch closes runtime ownership before changing active profile set', async (t) => {
  const rig = await createShellRig(t);
  const second = rig.store.createProject({ name: 'Second Project' });

  const opened = await fetch(`${rig.base}/api/v8/connections/lab-loop/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerMode: 'master' }),
  });
  assert.equal(opened.status, 200);
  assert.equal(rig.shell.broker.listConnections().length, 1);

  const selected = await json(await fetch(`${rig.base}/api/v8/projects/${encodeURIComponent(second.id)}/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }));
  assert.equal(selected.response.status, 200);
  assert.equal(selected.body.id, second.id);
  assert.equal(rig.shell.broker.listConnections().length, 0);
});

test('v8 dev entry parser keeps a separate explicit local development command', () => {
  const parsed = v8Dev.parseArgs(['--host', '127.0.0.1', '--port', '9191', '--data-dir', './tmp-v8']);
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.port, 9191);
  assert.equal(path.isAbsolute(parsed.dataDir), true);
  assert.match(v8Dev.usage(), /stable product runtime remains v7/i);
  assert.throws(() => v8Dev.parseArgs(['--port', '0']), /1\.\.65535/);
});
