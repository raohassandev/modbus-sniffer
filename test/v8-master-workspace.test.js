'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');
const { startV8ProductServer } = require('../src/v8/workbenchServerV8');
const { validateWriteBody } = require('../src/v8/master/masterWorkspaceRoutes');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeoutMs = 800, intervalMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return Boolean(predicate());
}

async function createRig(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-master-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const pair = v8.createVirtualLoopbackPair({ names: ['workspace-master', 'workspace-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({
    connectionId: 'slave-runtime',
    resourceKey: 'virtual:workspace-slave',
    transportKind: 'virtual-rtu',
    transport: pair.b,
  });

  const slave = new v8.VirtualSlaveServer({
    broker,
    connectionId: 'slave-runtime',
    ownerId: 'workspace-slave-owner',
    framing: 'rtu',
    receivePollMs: 2,
  });
  const device = slave.addDevice({
    unitId: 1,
    sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 64, inputRegisters: 64 },
  });
  device.seed('holdingRegisters', 0, [100, 200, 300, 400, 500]);
  device.seed('coils', 0, [false, true, false, true]);
  await slave.start();

  const store = new v8.V8ProjectStore({ dataDir, autoMigrate: false });
  const center = new v8.ConnectionCenterService({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'master-virtual') return pair.a;
      throw new Error(`Unexpected profile ${profile.connectionId}`);
    },
  });
  center.saveProfile({
    connectionId: 'master-virtual',
    name: 'Virtual Master',
    transportKind: 'virtual',
    endpoint: 'loopback',
  });

  const service = new v8.MasterWorkspaceService({
    store,
    broker,
    connectionCenter: center,
    minimumInterRequestDelayMs: 1,
  });

  t.after(async () => {
    try { await service.shutdown(); } catch { /* best effort */ }
    try { await slave.stop({ closeConnection: true }); } catch { /* best effort */ }
  });

  return { dataDir, pair, broker, slave, device, store, center, service };
}

test('v8 Master Workstation performs one-shot read and keeps writes relocked', async (t) => {
  const rig = await createRig(t);
  const read = await rig.service.readOnce({
    connectionId: 'master-virtual',
    unitId: 1,
    functionCode: 3,
    address: 1,
    quantity: 3,
  });
  assert.deepEqual(read.decoded.values, [200, 300, 400]);
  assert.ok(read.requestRawHex);
  assert.ok(read.responseRawHex);

  const write = await rig.service.writeOnce({
    connectionId: 'master-virtual',
    unitId: 1,
    functionCode: 6,
    address: 2,
    value: 777,
    confirmation: { confirmed: true },
    readBack: true,
  });
  assert.equal(write.ok, true);
  assert.deepEqual(rig.device.read('holdingRegisters', 2, 1), [777]);
  assert.equal(rig.broker.getConnection('master-virtual').writeLock, 'LOCKED');
});

test('v8 Master poll jobs persist, run cyclically and reload stopped', async (t) => {
  const rig = await createRig(t);
  const job = rig.service.saveJob({
    jobId: 'holding-fast',
    label: 'Holding fast',
    connectionId: 'master-virtual',
    unitId: 1,
    functionCode: 3,
    address: 0,
    quantity: 2,
    intervalMs: 20,
    timeoutMs: 100,
    retries: 1,
    retryDelayMs: 5,
  });
  assert.equal(job.jobId, 'holding-fast');
  assert.equal(rig.store.getActiveProject().masterJobs.length, 1);

  await rig.service.start('master-virtual');
  const session = rig.service.sessions.get('master-virtual');
  const ran = await waitFor(() => session?.scheduler.getJob('holding-fast').stats.successes >= 2);
  assert.equal(ran, true);
  assert.equal(session.scheduler.snapshot().running, true);
  rig.service.stop('master-virtual');
  assert.equal(session.scheduler.snapshot().running, false);

  await rig.service.disconnect('master-virtual');
  const reopenedStore = new v8.V8ProjectStore({ dataDir: rig.dataDir, autoMigrate: false });
  assert.equal(reopenedStore.getActiveProject().masterJobs.length, 1);
  assert.equal(reopenedStore.getActiveProject().masterJobs[0].jobId, 'holding-fast');
  assert.equal(rig.broker.getConnection('master-virtual').writeLock, 'LOCKED');
});

test('v8 Master saved job supports edit, read-now and delete', async (t) => {
  const rig = await createRig(t);
  rig.service.saveJob({
    jobId: 'job-1',
    connectionId: 'master-virtual',
    unitId: 1,
    functionCode: 3,
    address: 0,
    quantity: 1,
    intervalMs: 1000,
  });
  const updated = rig.service.saveJob({
    jobId: 'job-1',
    connectionId: 'master-virtual',
    label: 'Edited job',
    unitId: 1,
    functionCode: 3,
    address: 3,
    quantity: 1,
    intervalMs: 500,
  });
  assert.equal(updated.label, 'Edited job');
  assert.equal(updated.address, 3);

  const result = await rig.service.readJobNow('job-1');
  assert.deepEqual(result.decoded.values, [400]);
  rig.service.removeJob('job-1');
  assert.equal(rig.service.listJobs().length, 0);
});

test('v8 Master route guard rejects invalid coil coercion', () => {
  assert.doesNotThrow(() => validateWriteBody({ functionCode: 15, values: [true, false, 1, 0] }));
  assert.throws(() => validateWriteBody({ functionCode: 15, values: [2] }), (error) => error.code === 'INVALID_COIL_VALUE');
  assert.throws(() => validateWriteBody({ functionCode: 5, value: 'yes' }), (error) => error.code === 'INVALID_COIL_VALUE');
});

test('v8 integrated server exposes Master API and persistent job endpoints', async (t) => {
  const rig = await createRig(t);
  const flags = Object.freeze({ ...v8.DEFAULT_FLAGS, shell: true, connectionCenter: true, masterWorkspace: true });
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

  const snapshot = await fetch(`${base}/api/v8/master`).then((response) => response.json());
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.connections.some((entry) => entry.connectionId === 'master-virtual' && entry.masterEligible), true);

  const readResponse = await fetch(`${base}/api/v8/master/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId: 'master-virtual', unitId: 1, functionCode: 3, address: 0, quantity: 2 }),
  });
  assert.equal(readResponse.status, 200);
  const readPayload = await readResponse.json();
  assert.deepEqual(readPayload.result.decoded.values, [100, 200]);

  const jobResponse = await fetch(`${base}/api/v8/master/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'api-job', connectionId: 'master-virtual', unitId: 1, functionCode: 3, address: 1, quantity: 1, intervalMs: 100 }),
  });
  assert.equal(jobResponse.status, 201);
  const jobs = await fetch(`${base}/api/v8/master/jobs`).then((response) => response.json());
  assert.equal(jobs.jobs.some((job) => job.jobId === 'api-job'), true);

  const invalidWrite = await fetch(`${base}/api/v8/master/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connectionId: 'master-virtual', unitId: 1, functionCode: 15, address: 0, values: [2], confirmation: { confirmed: true, bulk: true } }),
  });
  assert.equal(invalidWrite.status, 400);
});
