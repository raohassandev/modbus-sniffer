'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function createStore() {
  let project = {
    id: 'project-test',
    projectId: 'project-test',
    name: 'Twin Test',
    connections: [
      { connectionId: 'source', transportKind: 'tcp-client' },
      { connectionId: 'target', transportKind: 'virtual' },
    ],
    slaveServers: [],
    virtualDevices: [],
    digitalTwins: [],
  };
  return {
    getActiveProject: () => clone(project),
    updateProject: (_id, patch) => { project = { ...project, ...clone(patch) }; return clone(project); },
    snapshot: () => clone(project),
  };
}

function sourcePoints() {
  return [
    {
      sourceKey: '["source",1,"holdingRegisters",0]', connectionId: 'source', unitId: 1,
      area: 'holdingRegisters', address: 0, rawValue: 100, sampleCount: 5, firstSeen: 1, lastSeen: 5,
      definition: { name: 'Voltage', type: 'uint16', scale: 0.1, offset: 0, unit: 'V', provenance: { confidence: 0.98 } },
    },
    {
      sourceKey: '["source",1,"holdingRegisters",1]', connectionId: 'source', unitId: 1,
      area: 'holdingRegisters', address: 1, rawValue: 200, sampleCount: 5, firstSeen: 1, lastSeen: 5,
      definition: null,
    },
    {
      sourceKey: '["source",1,"coils",4]', connectionId: 'source', unitId: 1,
      area: 'coils', address: 4, rawValue: true, sampleCount: 2, firstSeen: 2, lastSeen: 5,
      definition: { name: 'Run', type: 'bool', provenance: { confidence: 1 } },
    },
  ];
}

test('v8 VirtualDevice can enforce generated-twin read-only write policy', () => {
  const device = new v8.VirtualDevice({
    unitId: 1,
    sizes: { coils: 8, discreteInputs: 0, holdingRegisters: 8, inputRegisters: 0 },
    writableAreas: { coils: false, holdingRegisters: false },
  });
  device.seed('holdingRegisters', 0, [10]);
  device.seed('coils', 0, [true]);
  assert.throws(() => device.write('holdingRegisters', 0, [20]), (error) => error.code === 'READ_ONLY_AREA');
  assert.throws(() => device.write('coils', 0, [false]), (error) => error.code === 'READ_ONLY_AREA');
  assert.deepEqual(device.read('holdingRegisters', 0, 1), [10]);
});

test('v8 Digital Twin preview preserves values/definitions/provenance and defaults writable areas off', () => {
  const store = createStore();
  const registerLab = { maxPoints: 100000, list: ({ connectionId }) => sourcePoints().filter((point) => point.connectionId === connectionId) };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator: {} });
  const twin = service.preview({ sourceConnectionId: 'source', targetConnectionId: 'target' });
  assert.equal(twin.target.framing, 'tcp');
  assert.deepEqual(twin.safety.writableAreas, { coils: false, discreteInputs: false, holdingRegisters: false, inputRegisters: false });
  assert.equal(twin.devices.length, 1);
  assert.deepEqual(twin.devices[0].memory.holdingRegisters, [{ address: 0, values: [100, 200] }]);
  assert.deepEqual(twin.devices[0].memory.coils, [{ address: 4, values: [true] }]);
  const voltage = twin.devices[0].metadata.pointDefinitions.find((point) => point.area === 'holdingRegisters' && point.address === 0);
  assert.equal(voltage.definition.name, 'Voltage');
  assert.equal(voltage.evidence.sampleCount, 5);
  assert.equal(twin.quality.uncertainPoints, 1);
});

test('v8 Digital Twin can be retargeted after capture evidence is no longer live', () => {
  const store = createStore();
  let live = true;
  const registerLab = { maxPoints: 100000, list: () => live ? sourcePoints() : [] };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator: {} });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'generated-a' });
  live = false;
  const retargeted = service.retarget(draft.twinId, {
    targetConnectionId: 'target',
    serverId: 'generated-b',
    writableAreas: { holdingRegisters: true },
  });
  assert.equal(retargeted.target.serverId, 'generated-b');
  assert.equal(retargeted.devices[0].serverId, 'generated-b');
  assert.equal(retargeted.devices[0].metadata.pointDefinitions.length, 3);
  assert.equal(retargeted.safety.writableAreas.holdingRegisters, true);
});

test('v8 Digital Twin apply is review-gated and explicit approval updates simulator metadata', () => {
  const store = createStore();
  const registerLab = { maxPoints: 100000, list: () => sourcePoints() };
  const calls = { servers: [], devices: [] };
  let server = null;
  const simulator = {
    saveServer(input) { server = clone(input); calls.servers.push(clone(input)); return clone(input); },
    saveDevice(input) { calls.devices.push(clone(input)); return clone(input); },
    getServer() {
      if (!server) throw Object.assign(new Error('missing'), { code: 'SERVER_NOT_FOUND' });
      return clone(server);
    },
    listDevices() { return clone(calls.devices); },
    removeServer() { server = null; calls.devices.length = 0; return true; },
  };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'generated-1' });
  const applied = service.apply(draft.twinId);
  assert.equal(applied.status, 'applied-review-required');
  assert.equal(calls.servers[0].metadata.digitalTwin.approved, false);
  assert.equal(calls.devices[0].writableAreas.holdingRegisters, false);
  assert.throws(() => service.approve(draft.twinId), (error) => error.code === 'CONFIRMATION_REQUIRED');
  const approved = service.approve(draft.twinId, { confirmed: true });
  assert.equal(approved.status, 'approved');
  assert.equal(calls.servers.at(-1).metadata.digitalTwin.approved, true);
});

test('v8 Digital Twin apply refuses to overwrite an unrelated Simulator server', () => {
  const store = createStore();
  const registerLab = { maxPoints: 100000, list: () => sourcePoints() };
  let saveCalls = 0;
  const simulator = {
    getServer: () => ({ serverId: 'generated-conflict', metadata: { purpose: 'operator-configured' } }),
    saveServer() { saveCalls += 1; },
    saveDevice() { saveCalls += 1; },
  };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'generated-conflict' });
  assert.throws(
    () => service.apply(draft.twinId),
    (error) => error.code === 'TWIN_TARGET_CONFLICT' && error.details?.serverId === 'generated-conflict',
  );
  assert.equal(saveCalls, 0);
  assert.equal(service.get(draft.twinId).status, 'draft');
});

test('v8 Digital Twin reapply restores the previous same-twin topology after a partial failure', () => {
  const store = createStore();
  const registerLab = { maxPoints: 100000, list: () => sourcePoints() };
  let server = null;
  let devices = [];
  let failNextDevice = false;
  const simulator = {
    getServer() {
      if (!server) throw Object.assign(new Error('missing'), { code: 'SERVER_NOT_FOUND' });
      return clone(server);
    },
    listDevices() { return clone(devices); },
    saveServer(input) { server = clone(input); return clone(server); },
    saveDevice(input) {
      if (failNextDevice) {
        failNextDevice = false;
        throw Object.assign(new Error('device apply failed'), { code: 'DEVICE_APPLY_FAILED' });
      }
      devices.push(clone(input));
      return clone(input);
    },
    removeServer() {
      if (!server) throw Object.assign(new Error('missing'), { code: 'SERVER_NOT_FOUND' });
      server = null;
      devices = [];
      return true;
    },
  };
  const service = new v8.DigitalTwinService({ store, registerLab, simulator });
  const draft = service.saveDraft({ sourceConnectionId: 'source', targetConnectionId: 'target', serverId: 'generated-rollback' });

  const previousServer = {
    serverId: 'generated-rollback',
    name: 'Previous generated topology',
    connectionId: 'target', framing: 'tcp', receivePollMs: 25,
    metadata: { digitalTwin: { twinId: draft.twinId, requiresApproval: true, approved: false } },
  };
  const previousDevice = {
    deviceId: 'generated-rollback:unit:9', serverId: 'generated-rollback', unitId: 9,
    name: 'Previous Unit 9', sizes: { coils: 0, discreteInputs: 0, holdingRegisters: 1, inputRegisters: 0 },
    identity: {}, memory: { holdingRegisters: [{ address: 0, values: [999] }] }, generators: [], metadata: {},
  };
  server = clone(previousServer);
  devices = [clone(previousDevice)];
  failNextDevice = true;

  assert.throws(() => service.apply(draft.twinId), (error) => error.code === 'DEVICE_APPLY_FAILED');
  assert.equal(server.name, previousServer.name);
  assert.deepEqual(devices, [previousDevice]);
  assert.equal(service.get(draft.twinId).status, 'draft');
});

test('v8 Simulator refuses to start an unapproved generated digital twin', async (t) => {
  const store = createStore();
  store.updateProject('project-test', {
    slaveServers: [{
      serverId: 'generated-locked', name: 'Generated', connectionId: 'target', framing: 'tcp', receivePollMs: 25,
      metadata: { digitalTwin: { twinId: 'twin-1', requiresApproval: true, approved: false } },
    }],
  });
  const broker = new v8.ConnectionBroker();
  const center = { get: () => ({ profile: { transportKind: 'virtual' } }) };
  const simulator = new v8.SimulatorWorkspaceService({ store, broker, connectionCenter: center });
  t.after(() => simulator.shutdown());
  await assert.rejects(() => simulator.startServer('generated-locked'), (error) => error.code === 'DIGITAL_TWIN_APPROVAL_REQUIRED');
});
