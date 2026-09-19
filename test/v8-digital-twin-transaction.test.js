'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');
const { digitalTwinErrorStatus } = require('../src/v8/digitalTwin/digitalTwinRoutes');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function fixture() {
  let project = {
    id: 'p1', projectId: 'p1', name: 'Twin transaction',
    connections: [{ connectionId: 'source', transportKind: 'tcp-client' }, { connectionId: 'target', transportKind: 'virtual' }],
    digitalTwins: [], slaveServers: [], virtualDevices: [],
  };
  const store = {
    getActiveProject: () => clone(project),
    updateProject: (_id, patch) => { project = { ...project, ...clone(patch) }; return clone(project); },
  };
  const registerLab = {
    maxPoints: 100,
    list: () => [{ sourceKey: 's1', connectionId: 'source', unitId: 1, area: 'holdingRegisters', address: 0, rawValue: 7, sampleCount: 1, firstSeen: 1, lastSeen: 1, definition: null }],
  };
  return { store, registerLab, project: () => clone(project) };
}

test('v8 Digital Twin applyWithPatch restores the original twin when patched target conflicts', () => {
  const { store, registerLab } = fixture();
  const simulator = {
    getServer(serverId) {
      if (serverId === 'occupied') return { serverId, metadata: { purpose: 'operator-owned' } };
      throw Object.assign(new Error('missing'), { code: 'SERVER_NOT_FOUND' });
    },
    saveServer() { throw new Error('must not save'); },
    saveDevice() { throw new Error('must not save'); },
  };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'original-target' });

  assert.throws(
    () => service.applyWithPatch(draft.twinId, { serverId: 'occupied' }),
    (error) => error.code === 'TWIN_TARGET_CONFLICT',
  );
  const restored = service.get(draft.twinId);
  assert.equal(restored.status, 'draft');
  assert.equal(restored.target.serverId, 'original-target');
});

test('v8 Digital Twin refuses same-twin reapply while the generated server is running without mutation', () => {
  const { store, registerLab } = fixture();
  let removeCalls = 0;
  let saveCalls = 0;
  const service = new v8.DigitalTwinService({
    store,
    registerLab,
    simulator: {
      getServer: () => ({
        serverId: 'running-twin',
        runtime: { running: true },
        metadata: { digitalTwin: { twinId: 'placeholder' } },
      }),
      listDevices: () => [],
      removeServer() { removeCalls += 1; },
      saveServer() { saveCalls += 1; },
      saveDevice() { saveCalls += 1; },
    },
  });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'running-twin' });
  // Make the fake existing generated server identify as this exact twin.
  service.simulator.getServer = () => ({
    serverId: 'running-twin',
    runtime: { running: true },
    metadata: { digitalTwin: { twinId: draft.twinId } },
  });

  assert.throws(() => service.apply(draft.twinId), (error) => error.code === 'SERVER_RUNNING');
  assert.equal(removeCalls, 0);
  assert.equal(saveCalls, 0);
  assert.equal(service.get(draft.twinId).status, 'draft');
});

test('v8 Digital Twin target conflicts are returned as HTTP 409', () => {
  assert.equal(digitalTwinErrorStatus({ code: 'TWIN_TARGET_CONFLICT' }), 409);
  assert.equal(digitalTwinErrorStatus({ code: 'TWIN_SNAPSHOT_UNAVAILABLE' }), 409);
  assert.equal(digitalTwinErrorStatus({ code: 'SERVER_RUNNING' }), 409);
});
