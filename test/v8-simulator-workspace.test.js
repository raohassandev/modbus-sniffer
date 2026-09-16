'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');
const { startV8ProductServer } = require('../src/v8/workbenchServerV8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createRig(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-simulator-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const pair = v8.createVirtualLoopbackPair({ names: ['sim-client', 'sim-server'] });
  const broker = new v8.ConnectionBroker();
  const store = new v8.V8ProjectStore({ dataDir, autoMigrate: false });
  const center = new v8.ConnectionCenterService({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'sim-link') return pair.b;
      if (profile.connectionId === 'wrong-client') return pair.b;
      throw new Error(`Unexpected profile ${profile.connectionId}`);
    },
  });
  center.saveProfile({ connectionId: 'sim-link', name: 'Simulator Link', transportKind: 'virtual', endpoint: 'loopback' });
  const simulator = new v8.SimulatorWorkspaceService({ store, broker, connectionCenter: center });

  const clientBroker = new v8.ConnectionBroker();
  clientBroker.defineConnection({ connectionId: 'client', resourceKey: 'virtual:sim-client', transportKind: 'virtual-rtu', transport: pair.a });
  const master = new v8.MasterEngine({ broker: clientBroker, connectionId: 'client', ownerId: 'sim-test-master', framing: 'rtu', timeoutMs: 80 });

  t.after(async () => {
    try { await master.close(); } catch { /* best effort */ }
    try { await simulator.shutdown(); } catch { /* best effort */ }
  });
  return { dataDir, pair, broker, store, center, simulator, clientBroker, master };
}

function createBasicSimulator(rig) {
  rig.simulator.saveServer({ serverId: 'srv-1', name: 'Server 1', connectionId: 'sim-link', framing: 'rtu', receivePollMs: 2 });
  rig.simulator.saveDevice({
    deviceId: 'srv-1-unit-1',
    serverId: 'srv-1',
    unitId: 1,
    name: 'Virtual Meter',
    identity: { vendorName: 'Automatrix', productCode: 'SIM-V8', revision: '8.0' },
    sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 64, inputRegisters: 64 },
  });
  rig.simulator.seedMemory('srv-1-unit-1', { area: 'holdingRegisters', address: 0, values: [10, 20, 30, 40] });
}

test('v8 Simulator persists configuration but never persists running/fault state', async (t) => {
  const rig = await createRig(t);
  createBasicSimulator(rig);
  rig.simulator.saveGenerator('srv-1-unit-1', {
    generatorId: 'counter-1', kind: 'counter', area: 'holdingRegisters', address: 5, intervalMs: 50,
    params: { start: 1, step: 1, min: 0, max: 10, wrap: true },
  });
  await rig.simulator.startServer('srv-1');
  rig.simulator.armFaultLab('srv-1', { dropEveryN: 3 }, { confirmed: true });
  assert.equal(rig.simulator.getServer('srv-1').runtime.faultLab.enabled, true);

  const project = rig.store.getActiveProject();
  const storedServer = project.slaveServers.find((item) => item.serverId === 'srv-1');
  const storedDevice = project.virtualDevices.find((item) => item.deviceId === 'srv-1-unit-1');
  assert.equal(Object.hasOwn(storedServer, 'runtime'), false);
  assert.equal(Object.hasOwn(storedServer, 'faultLab'), false);
  assert.equal(storedDevice.generators[0].generatorId, 'counter-1');
  assert.equal(Object.hasOwn(storedDevice.generators[0], 'runtime'), false);

  await rig.simulator.stopServer('srv-1');
  assert.equal(rig.broker.getConnection('sim-link').owner, null);
});

test('v8 Simulator rejects incompatible connection/framing and topology edits while running', async (t) => {
  const rig = await createRig(t);
  rig.center.saveProfile({ connectionId: 'wrong-client', name: 'Wrong TCP client', transportKind: 'tcp-client', tcp: { host: '127.0.0.1', port: 1502 } });
  assert.throws(
    () => rig.simulator.saveServer({ serverId: 'wrong', connectionId: 'wrong-client', framing: 'tcp' }),
    (error) => error.code === 'SIMULATOR_TRANSPORT_MISMATCH',
  );

  createBasicSimulator(rig);
  await rig.simulator.startServer('srv-1');
  assert.throws(
    () => rig.simulator.saveDevice({ deviceId: 'second', serverId: 'srv-1', unitId: 2 }),
    (error) => error.code === 'SERVER_RUNNING',
  );
});

test('v8 Simulator serves reads/writes through shared Slave core and audits incoming writes', async (t) => {
  const rig = await createRig(t);
  createBasicSimulator(rig);
  await rig.simulator.startServer('srv-1');
  await rig.master.open();

  const read = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 4 }) });
  assert.deepEqual(read.decoded.values, [10, 20, 30, 40]);

  rig.master.setWriteEnabled(true);
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 1, value: 4321 }) });
  assert.deepEqual(rig.simulator.readMemory('srv-1-unit-1', { area: 'holdingRegisters', address: 1, quantity: 1 }).values, [4321]);
  const audit = rig.simulator.getWriteAudit('srv-1');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].unitId, 1);
  assert.equal(audit[0].functionCode, 6);
  assert.ok(audit[0].rawHex);
  assert.equal(Object.isFrozen(audit[0]), true);
});

test('v8 dynamic generators update memory asynchronously and safe formulas do not use eval', async (t) => {
  const rig = await createRig(t);
  createBasicSimulator(rig);
  rig.simulator.saveGenerator('srv-1-unit-1', {
    generatorId: 'counter', kind: 'counter', area: 'holdingRegisters', address: 6, intervalMs: 20,
    params: { start: 7, step: 2, min: 0, max: 100, wrap: true },
  });
  rig.simulator.saveGenerator('srv-1-unit-1', {
    generatorId: 'formula', kind: 'formula', area: 'holdingRegisters', address: 7, intervalMs: 20,
    params: { expression: 'x + i + 2' },
  });
  assert.throws(() => v8.compileFormula('process.exit(1)'), (error) => error.code === 'INVALID_FORMULA');

  await rig.simulator.startServer('srv-1');
  await sleep(90);
  const counter = rig.simulator.readMemory('srv-1-unit-1', { area: 'holdingRegisters', address: 6, quantity: 1 }).values[0];
  const formula = rig.simulator.readMemory('srv-1-unit-1', { area: 'holdingRegisters', address: 7, quantity: 1 }).values[0];
  assert.ok(counter >= 7);
  assert.ok(formula >= 2);
  assert.ok(rig.simulator.generators.snapshot().updates >= 2);
});

test('v8 Fault Injection LAB requires confirmation, can drop traffic, and disarms cleanly', async (t) => {
  const rig = await createRig(t);
  createBasicSimulator(rig);
  await rig.simulator.startServer('srv-1');
  await rig.master.open();

  assert.throws(
    () => rig.simulator.armFaultLab('srv-1', { dropEveryN: 1 }, { confirmed: false }),
    (error) => error.code === 'LAB_CONFIRMATION_REQUIRED',
  );
  rig.simulator.armFaultLab('srv-1', { dropEveryN: 1 }, { confirmed: true });
  await assert.rejects(
    () => rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }), timeoutMs: 25 }),
    (error) => error.code === 'TIMEOUT',
  );
  rig.simulator.disarmFaultLab('srv-1');
  const healthy = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }), timeoutMs: 80 });
  assert.deepEqual(healthy.decoded.values, [10]);
});

test('v8 Simulator API is feature-gated and exposes persistent server/device configuration', async (t) => {
  const rig = await createRig(t);
  const flags = Object.freeze({ ...v8.DEFAULT_FLAGS, simulatorWorkspace: true });
  const web = await startV8ProductServer({ store: rig.store, broker: rig.broker, connectionCenter: rig.center, host: '127.0.0.1', port: 0, flags });
  t.after(() => web.close());
  const base = `http://127.0.0.1:${web.port}`;

  const created = await fetch(`${base}/api/v8/simulator/servers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ serverId: 'api-srv', name: 'API Server', connectionId: 'sim-link', framing: 'rtu' }),
  });
  assert.equal(created.status, 201);
  const device = await fetch(`${base}/api/v8/simulator/devices`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'api-device', serverId: 'api-srv', unitId: 2, sizes: { coils: 16, discreteInputs: 16, holdingRegisters: 16, inputRegisters: 16 } }),
  });
  assert.equal(device.status, 201);
  const inventory = await fetch(`${base}/api/v8/simulator/servers`).then((response) => response.json());
  assert.equal(inventory.ok, true);
  assert.equal(inventory.servers.some((item) => item.serverId === 'api-srv'), true);
});
