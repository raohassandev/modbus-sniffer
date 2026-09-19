'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { V8ProjectStore } = require('../src/v8/project');
const { ConnectionBroker } = require('../src/v8/connectionBroker');
const { ConnectionCenterServiceV8 } = require('../src/v8/connectionCenterServiceRelease');

function transport(marker = null) {
  return {
    async open() {}, async close() {}, async send() {}, async receive() { return null; },
    status() { return { marker }; },
  };
}

test('v8 connection import preflights the whole payload and cannot partially mutate on failure', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-import-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  const center = new ConnectionCenterServiceV8({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'bad') throw Object.assign(new Error('bad transport'), { code: 'UNSUPPORTED_TRANSPORT' });
      return transport(profile.endpoint || profile.connectionId);
    },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  const before = store.listConnectionProfiles(store.getActiveProject().id);

  assert.throws(() => center.importProfiles({
    format: 'modbus-workbench-v8-connections',
    version: 1,
    profiles: [
      { connectionId: 'good', transportKind: 'virtual' },
      { connectionId: 'bad', transportKind: 'virtual' },
    ],
  }), /bad transport/);
  assert.deepEqual(store.listConnectionProfiles(store.getActiveProject().id), before);
});

test('v8 connection import rolls broker definitions back after a later apply-time failure', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-import-rollback-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  let badBuilds = 0;
  const center = new ConnectionCenterServiceV8({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'bad' && ++badBuilds > 1) throw Object.assign(new Error('apply-time transport failure'), { code: 'UNSUPPORTED_TRANSPORT' });
      return transport(profile.endpoint || profile.connectionId);
    },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));

  center.saveProfile({ connectionId: 'good', transportKind: 'virtual', endpoint: 'original' });
  assert.equal(center.get('good').diagnostics.marker, 'original');

  assert.throws(() => center.importProfiles({
    format: 'modbus-workbench-v8-connections', version: 1,
    profiles: [
      { connectionId: 'good', transportKind: 'virtual', endpoint: 'replacement' },
      { connectionId: 'bad', transportKind: 'virtual', endpoint: 'bad' },
    ],
  }), /apply-time transport failure/);

  const persisted = store.listConnectionProfiles(store.getActiveProject().id).find((entry) => entry.connectionId === 'good');
  assert.equal(persisted.endpoint, 'original');
  assert.equal(center.get('good').diagnostics.marker, 'original');
  assert.equal(broker.listConnections().some((entry) => entry.connectionId === 'bad'), false);
});

test('v8 connection import rejects duplicate IDs and wrong format before mutation', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-import-format-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const broker = new ConnectionBroker();
  const center = new ConnectionCenterServiceV8({ store, broker });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));

  assert.throws(() => center.importProfiles({ format: 'other-format', version: 1, profiles: [] }), (error) => error.code === 'INVALID_IMPORT');
  assert.throws(() => center.importProfiles({
    format: 'modbus-workbench-v8-connections', version: 1,
    profiles: [{ connectionId: 'dup', transportKind: 'virtual' }, { connectionId: 'dup', transportKind: 'virtual' }],
  }), (error) => error.code === 'INVALID_IMPORT');
  assert.equal(store.listConnectionProfiles(store.getActiveProject().id).length, 0);
});
