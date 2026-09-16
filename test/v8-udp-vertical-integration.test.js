'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function dataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-udp-vertical-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function createUdpSimulatorRig(t) {
  const store = new v8.V8ProjectStore({ dataDir: dataDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker });
  const simulator = new v8.SimulatorWorkspaceService({ store, broker, connectionCenter: center });
  const master = new v8.MasterWorkspaceService({ store, broker, connectionCenter: center });
  const testCenter = new v8.TestCenterWorkspaceService({ store, broker, connectionCenter: center });

  center.saveProfile({
    connectionId: 'udp-server',
    name: 'UDP Simulator',
    transportKind: 'udp-server',
    endpoint: '127.0.0.1',
    udp: { host: '127.0.0.1', port: 0, family: 4, maxPeers: 32 },
  });
  simulator.saveServer({
    serverId: 'udp-sim',
    name: 'UDP simulator',
    connectionId: 'udp-server',
    framing: 'udp',
    receivePollMs: 5,
  });
  simulator.saveDevice({
    serverId: 'udp-sim',
    deviceId: 'udp-unit-250',
    unitId: 250,
    sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 64, inputRegisters: 32 },
  });
  simulator.seedMemory('udp-unit-250', { area: 'holdingRegisters', address: 0, values: [101, 202, 303, 404] });
  await simulator.startServer('udp-sim');

  const listenAddress = center.get('udp-server').diagnostics.listenAddress;
  assert.ok(listenAddress?.port > 0);
  center.saveProfile({
    connectionId: 'udp-client',
    name: 'UDP Master',
    transportKind: 'udp-client',
    endpoint: '127.0.0.1',
    udp: { host: '127.0.0.1', port: listenAddress.port, family: 4, receiveTimeoutMs: 300 },
  });

  t.after(async () => {
    try { await testCenter.shutdown(); } catch { /* best effort */ }
    try { await master.shutdown(); } catch { /* best effort */ }
    try { await simulator.shutdown(); } catch { /* best effort */ }
  });

  return { store, broker, center, simulator, master, testCenter };
}

test('v8 project schema persists UDP configuration but never live/armed runtime state', (t) => {
  const store = new v8.V8ProjectStore({ dataDir: dataDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker });
  center.saveProfile({
    connectionId: 'udp-profile',
    name: 'UDP profile',
    transportKind: 'udp-client',
    endpoint: '192.0.2.10',
    udp: { host: '192.0.2.10', port: 1502, family: 4, localPort: 12000, receiveTimeoutMs: 750 },
    ownerMode: 'master',
    writesEnabled: true,
    writeLock: 'ENABLED',
  });

  const saved = store.listConnectionProfiles(store.exportAll().activeProjectId)[0];
  assert.deepEqual(saved.udp, { host: '192.0.2.10', port: 1502, family: 4, localPort: 12000, receiveTimeoutMs: 750 });
  assert.equal(saved.ownerMode, 'none');
  assert.equal(saved.transmitCapability, 'none');
  assert.equal(saved.writeLock, 'LOCKED');
  assert.equal(saved.writesEnabled, false);
  assert.equal(saved.enabled, false);
});

test('v8 Connection Center constructs UDP client/server transports with correct ownership semantics', (t) => {
  const store = new v8.V8ProjectStore({ dataDir: dataDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker });
  center.saveProfile({ connectionId: 'server', transportKind: 'udp-server', udp: { host: '127.0.0.1', port: 0 } });
  center.saveProfile({ connectionId: 'client-a', transportKind: 'udp-client', udp: { host: '127.0.0.1', port: 1502 } });
  center.saveProfile({ connectionId: 'client-b', transportKind: 'udp-client', udp: { host: '127.0.0.1', port: 1502 } });

  const server = center.get('server');
  const clientA = center.get('client-a');
  assert.equal(server.runtime.transportKind, 'udp-server');
  assert.equal(server.runtime.exclusive, true);
  assert.equal(server.diagnostics.capabilities.datagram, true);
  assert.equal(clientA.runtime.transportKind, 'udp-client');
  assert.equal(clientA.runtime.exclusive, false);
  assert.equal(clientA.diagnostics.capabilities.supportsMatchedReceive, true);
  assert.notEqual(center.get('client-a').runtime.resourceKey, center.get('client-b').runtime.resourceKey);
});

test('v8 UDP Simulator and Master round-trip MBAP transactions including Unit ID 250', async (t) => {
  const rig = await createUdpSimulatorRig(t);
  const read = await rig.master.readOnce({
    connectionId: 'udp-client',
    unitId: 250,
    functionCode: 3,
    address: 1,
    quantity: 2,
    timeoutMs: 300,
  });
  assert.deepEqual(read.decoded.values, [202, 303]);
  assert.equal(read.transactionId > 0, true);
  assert.equal(rig.master.snapshot().connections.find((entry) => entry.connectionId === 'udp-client').masterEligible, true);
  assert.equal(rig.simulator.getServer('udp-sim').runtime.framing, 'udp');
  assert.equal(rig.simulator.getServer('udp-sim').runtime.protocolFraming, 'tcp-mbap');
});

test('v8 UDP Master writes stay guarded and Test Center accepts the same native UDP client profile', async (t) => {
  const rig = await createUdpSimulatorRig(t);
  const write = await rig.master.writeOnce({
    connectionId: 'udp-client',
    unitId: 250,
    functionCode: 6,
    address: 2,
    value: 999,
    confirmation: { confirmed: true },
    readBack: true,
  });
  assert.equal(write.ok, true);
  assert.deepEqual(rig.simulator.readMemory('udp-unit-250', { area: 'holdingRegisters', address: 2, quantity: 1 }).values, [999]);
  assert.equal(rig.broker.getConnection('udp-client').writeLock, 'LOCKED');

  await rig.master.disconnect('udp-client');
  const testSnapshot = rig.testCenter.snapshot();
  const connection = testSnapshot.connections.find((entry) => entry.connectionId === 'udp-client');
  assert.equal(connection.eligible, true);
  const opened = await rig.testCenter.open('udp-client');
  assert.equal(opened.session.framing, 'tcp');
  assert.equal(opened.session.raw.armed, false);
  assert.equal(opened.session.writes.writeLock, 'LOCKED');
});
