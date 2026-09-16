'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');
const { startV8ProductServer } = require('../src/v8/workbenchServerV8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  return predicate();
}

async function createRig(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-discovery-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const pair = v8.createVirtualLoopbackPair({ names: ['discovery-master', 'discovery-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({
    connectionId: 'slave-runtime',
    resourceKey: 'virtual:discovery-slave',
    transportKind: 'virtual-rtu',
    transport: pair.b,
  });

  const slave = new v8.VirtualSlaveServer({
    broker,
    connectionId: 'slave-runtime',
    ownerId: 'discovery-slave-owner',
    framing: 'rtu',
    receivePollMs: 2,
  });
  const device = slave.addDevice({
    unitId: 1,
    identity: { vendorName: 'Automatrix', productCode: 'DISCOVERY-V8', revision: '8.0' },
    sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 64, inputRegisters: 64 },
  });
  device.seed('holdingRegisters', 0, [10, 20, 30, 40, 50]);
  await slave.start();

  const store = new v8.V8ProjectStore({ dataDir, autoMigrate: false });
  const center = new v8.ConnectionCenterService({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'discovery-virtual') return pair.a;
      throw new Error(`Unexpected profile ${profile.connectionId}`);
    },
  });
  center.saveProfile({
    connectionId: 'discovery-virtual',
    name: 'Discovery Virtual Bus',
    transportKind: 'virtual',
    endpoint: 'loopback',
  });

  const masterWorkspace = new v8.MasterWorkspaceService({ store, broker, connectionCenter: center });
  const discovery = new v8.DiscoveryScanService({ store, broker, connectionCenter: center, masterWorkspace });

  t.after(async () => {
    try { await discovery.shutdown(); } catch { /* best effort */ }
    try { await masterWorkspace.shutdown(); } catch { /* best effort */ }
    try { await slave.stop({ closeConnection: true }); } catch { /* best effort */ }
  });

  return { dataDir, pair, broker, slave, device, store, center, masterWorkspace, discovery };
}

async function waitForRun(service, runId) {
  const run = await waitFor(() => {
    try {
      const current = service.getRun(runId);
      return ['completed', 'cancelled', 'failed'].includes(current.state) ? current : null;
    } catch {
      return null;
    }
  });
  assert.ok(run, `run ${runId} did not finish`);
  return run;
}

test('v8 Discovery requires explicit serial maintenance/exclusive-bus interlock', async (t) => {
  const rig = await createRig(t);
  assert.throws(
    () => rig.discovery.startUnitScan({ connectionId: 'discovery-virtual', startUnit: 1, endUnit: 1 }),
    (error) => error.code === 'RTU_DISCOVERY_CONFIRMATION_REQUIRED',
  );
  assert.equal(rig.broker.getConnection('discovery-virtual').owner, null);
});

test('v8 Discovery request engine is read-only and cannot inherit Master write permission', async (t) => {
  const rig = await createRig(t);
  await rig.center.activate('discovery-virtual', { ownerMode: 'discovery', ownerId: 'read-only-discovery' });
  const engine = new v8.DiscoveryRequestEngine({
    broker: rig.broker,
    connectionId: 'discovery-virtual',
    ownerId: 'read-only-discovery',
    framing: 'rtu',
    timeoutMs: 100,
  });
  await engine.open();

  assert.throws(() => engine.setWriteEnabled(true), (error) => error.code === 'DISCOVERY_READ_ONLY');
  await assert.rejects(
    () => engine.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 0, value: 999 }) }),
    (error) => error.code === 'DISCOVERY_READ_ONLY',
  );
  assert.deepEqual(rig.device.read('holdingRegisters', 0, 1), [10]);
  assert.equal(rig.broker.getConnection('discovery-virtual').writeLock, 'LOCKED');
  await rig.center.deactivate('discovery-virtual');
});

test('v8 Unit discovery confirms identity, persists evidence and converts to a Master poll job', async (t) => {
  const rig = await createRig(t);
  const started = rig.discovery.startUnitScan({
    connectionId: 'discovery-virtual',
    startUnit: 1,
    endUnit: 2,
    timeoutMs: 25,
    interRequestDelayMs: 1,
    maintenanceConfirmed: true,
    exclusiveBusConfirmed: true,
  });
  const run = await waitForRun(rig.discovery, started.runId);
  assert.equal(run.state, 'completed');
  const unit1 = run.results.find((result) => result.unitId === 1);
  const unit2 = run.results.find((result) => result.unitId === 2);
  assert.equal(unit1.confirmed, true);
  assert.equal(unit1.classification, 'confirmed-identity');
  assert.equal(unit1.identity.some((item) => item.text === 'Automatrix'), true);
  assert.equal(unit2.classification, 'silent');
  assert.equal(rig.store.getActiveProject().discoveryRuns.some((entry) => entry.runId === run.runId), true);
  assert.equal(rig.broker.getConnection('discovery-virtual').owner, null);

  const job = rig.discovery.convertUnitToMasterJob(run.runId, 1, {
    jobId: 'discovered-unit-1',
    functionCode: 3,
    address: 0,
    quantity: 2,
    intervalMs: 500,
  });
  assert.equal(job.connectionId, 'discovery-virtual');
  assert.equal(job.unitId, 1);
  assert.equal(rig.masterWorkspace.getJob('discovered-unit-1').quantity, 2);
});

test('v8 adaptive address discovery splits failing blocks and records readable addresses', async (t) => {
  const rig = await createRig(t);
  const started = rig.discovery.startAddressScan({
    connectionId: 'discovery-virtual',
    unitId: 1,
    functionCode: 3,
    startAddress: 0,
    endAddress: 70,
    strategy: 'adaptive',
    blockSize: 64,
    timeoutMs: 50,
    interRequestDelayMs: 0,
    maintenanceConfirmed: true,
    exclusiveBusConfirmed: true,
  });
  const run = await waitForRun(rig.discovery, started.runId);
  assert.equal(run.state, 'completed');
  assert.equal(run.progress.percent, 100);
  assert.equal(run.results.find((row) => row.address === 0).value, 10);
  assert.equal(run.results.find((row) => row.address === 63).classification, 'readable');
  assert.equal(run.results.find((row) => row.address === 64).classification, 'exception');
  assert.equal(run.results.length, 71);
});

test('v8 Discovery cancellation aborts an in-flight scan and releases ownership', async (t) => {
  const rig = await createRig(t);
  const started = rig.discovery.startUnitScan({
    connectionId: 'discovery-virtual',
    startUnit: 2,
    endUnit: 247,
    timeoutMs: 200,
    interRequestDelayMs: 50,
    maintenanceConfirmed: true,
    exclusiveBusConfirmed: true,
  });
  await waitFor(() => {
    try { return rig.discovery.getRun(started.runId).state === 'running'; } catch { return false; }
  });
  rig.discovery.cancel(started.runId);
  const run = await waitForRun(rig.discovery, started.runId);
  assert.equal(run.state, 'cancelled');
  assert.ok(run.progress.completed < run.progress.total);
  assert.equal(rig.broker.getConnection('discovery-virtual').owner, null);
});

test('v8 integrated product server exposes feature-gated Discovery API', async (t) => {
  const rig = await createRig(t);
  const flags = Object.freeze({ ...v8.DEFAULT_FLAGS, discoveryWorkspace: true });
  const web = await startV8ProductServer({
    store: rig.store,
    broker: rig.broker,
    connectionCenter: rig.center,
    host: '127.0.0.1',
    port: 0,
    flags,
  });
  t.after(() => web.close());
  const base = `http://127.0.0.1:${web.port}`;

  const initial = await fetch(`${base}/api/v8/discovery/runs`).then((response) => response.json());
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.runs, []);

  const denied = await fetch(`${base}/api/v8/discovery/unit-scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId: 'discovery-virtual', startUnit: 1, endUnit: 1 }),
  });
  assert.equal(denied.status, 400);
  const deniedPayload = await denied.json();
  assert.equal(deniedPayload.error.code, 'RTU_DISCOVERY_CONFIRMATION_REQUIRED');

  const response = await fetch(`${base}/api/v8/discovery/unit-scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      connectionId: 'discovery-virtual',
      startUnit: 1,
      endUnit: 1,
      timeoutMs: 50,
      maintenanceConfirmed: true,
      exclusiveBusConfirmed: true,
    }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  const run = await waitForRun(web.discovery, payload.run.runId);
  assert.equal(run.results[0].confirmed, true);

  const persisted = await fetch(`${base}/api/v8/discovery/runs/${encodeURIComponent(run.runId)}`).then((item) => item.json());
  assert.equal(persisted.ok, true);
  assert.equal(persisted.run.state, 'completed');
});
