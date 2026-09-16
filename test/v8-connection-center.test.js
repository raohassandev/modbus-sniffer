'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-center-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function virtualFactory(profile) {
  return new v8.VirtualLoopbackEndpoint({ name: `profile:${profile.connectionId}` });
}

test('v8 Connection Center keeps saved profiles configuration-only and runtime state separate', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker, transportFactory: virtualFactory });

  center.saveProfile({
    connectionId: 'meter-1',
    name: 'Meter 1',
    transportKind: 'serial-rtu',
    serial: { path: 'COM9', baudRate: 19200, parity: 'even', dataBits: 8, stopBits: 1 },
  });

  const persisted = store.listConnectionProfiles(store.exportAll().activeProjectId)[0];
  assert.equal(persisted.ownerMode, 'none');
  assert.equal(persisted.transmitCapability, 'none');
  assert.equal(persisted.writeLock, 'LOCKED');
  assert.equal(persisted.writesEnabled, false);
  assert.equal(persisted.faultInjectionEnabled, false);
  assert.equal(persisted.enabled, false);

  const opened = await center.activate('meter-1', { ownerMode: 'master' });
  assert.equal(opened.runtime.state, 'open');
  assert.equal(opened.runtime.owner.ownerMode, 'master');
  assert.equal(opened.runtime.writeLock, 'LOCKED');

  const persistedWhileOpen = store.listConnectionProfiles(store.exportAll().activeProjectId)[0];
  assert.equal(persistedWhileOpen.ownerMode, 'none');
  assert.equal(persistedWhileOpen.writeLock, 'LOCKED');

  const closed = await center.deactivate('meter-1');
  assert.equal(closed.runtime.state, 'closed');
  assert.equal(closed.runtime.owner, null);
});

test('v8 Connection Center rejects serial ownership conflicts and allows handover after close', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker, transportFactory: virtualFactory });

  for (const connectionId of ['serial-a', 'serial-b']) {
    center.saveProfile({
      connectionId,
      name: connectionId,
      transportKind: 'serial-rtu',
      serial: { path: 'COM4', baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 },
    });
  }

  await center.activate('serial-a', { ownerMode: 'master' });
  await assert.rejects(
    () => center.activate('serial-b', { ownerMode: 'slave' }),
    (error) => error.code === 'RESOURCE_BUSY',
  );
  await center.deactivate('serial-a');
  const second = await center.activate('serial-b', { ownerMode: 'slave' });
  assert.equal(second.runtime.owner.ownerMode, 'slave');
  await center.deactivate('serial-b');
});

test('v8 Connection Center test action opens and releases an inactive profile', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker, transportFactory: virtualFactory });
  center.saveProfile({ connectionId: 'virtual-test', name: 'Virtual Test', transportKind: 'virtual' });

  const result = await center.testConnection('virtual-test');
  assert.equal(result.ok, true);
  const after = center.get('virtual-test');
  assert.equal(after.runtime.state, 'closed');
  assert.equal(after.runtime.owner, null);
  assert.equal(after.runtime.writeLock, 'LOCKED');
});

test('v8 Connection Center duplicate/export/import keeps runtime state disarmed', (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker, transportFactory: virtualFactory });
  center.saveProfile({ connectionId: 'source', name: 'Source', transportKind: 'virtual' });
  const duplicate = center.duplicateProfile('source', { connectionId: 'copy' });
  assert.equal(duplicate.profile.connectionId, 'copy');

  const exported = center.exportProfiles();
  assert.equal(exported.profiles.length, 2);
  assert.equal(exported.profiles.every((profile) => profile.writeLock === 'LOCKED' && profile.ownerMode === 'none'), true);

  const secondStore = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const second = new v8.ConnectionCenterService({ store: secondStore, broker: new v8.ConnectionBroker(), transportFactory: virtualFactory });
  const imported = second.importProfiles(exported);
  assert.equal(imported.length, 2);
  assert.equal(second.listProfiles().every((profile) => profile.writesEnabled === false && profile.faultInjectionEnabled === false), true);
});
