'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

async function createRig(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-master-audit-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const pair = v8.createVirtualLoopbackPair({ names: ['audit-master', 'audit-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'slave', resourceKey: 'virtual:audit-slave', transportKind: 'virtual-rtu', transport: pair.b });
  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'slave', ownerId: 'slave-owner', framing: 'rtu', receivePollMs: 2 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 16, discreteInputs: 16, holdingRegisters: 32, inputRegisters: 16 } });
  device.seed('holdingRegisters', 0, [10, 20, 30, 40]);
  await slave.start();

  const store = new v8.V8ProjectStore({ dataDir, autoMigrate: false });
  const center = new v8.ConnectionCenterService({
    store,
    broker,
    transportFactory(profile) {
      if (profile.connectionId === 'master') return pair.a;
      throw new Error(`Unexpected profile ${profile.connectionId}`);
    },
  });
  center.saveProfile({ connectionId: 'master', name: 'Audit Master', transportKind: 'virtual', endpoint: 'loopback' });
  const service = new v8.MasterWorkspaceService({ store, broker, connectionCenter: center });

  t.after(async () => {
    try { await service.shutdown(); } catch { /* best effort */ }
    try { await slave.stop({ closeConnection: true }); } catch { /* best effort */ }
  });
  return { broker, device, store, center, service };
}

test('Master snapshot exposes live scheduler job state instead of only persisted job definitions', async (t) => {
  const rig = await createRig(t);
  rig.service.saveJob({ jobId: 'poll-a', connectionId: 'master', unitId: 1, functionCode: 3, address: 0, quantity: 1, intervalMs: 1000 });
  await rig.service.readJobNow('poll-a');

  const connection = rig.service.snapshot().connections.find((entry) => entry.connectionId === 'master');
  assert.ok(connection);
  assert.equal(Array.isArray(connection.schedulerJobs), true);
  assert.equal(connection.schedulerJobs.length, 1);
  assert.equal(connection.schedulerJobs[0].jobId, 'poll-a');
  assert.equal(connection.schedulerJobs[0].stats.successes, 1);
  assert.equal(connection.schedulerJobs[0].state, 'idle');
});

test('Master service aggregates per-session write audit and supports connection filtering', async (t) => {
  const rig = await createRig(t);
  await rig.service.writeOnce({
    connectionId: 'master',
    unitId: 1,
    functionCode: 6,
    address: 1,
    value: 222,
    confirmation: { confirmed: true },
    readBack: true,
  });

  const audit = rig.service.audit({ limit: 20 });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].connectionId, 'master');
  assert.equal(audit[0].result, 'success');
  assert.equal(audit[0].address, 1);
  assert.deepEqual(audit[0].requestedValues, [222]);
  assert.equal(rig.service.audit({ connectionId: 'missing' }).length, 0);
});

test('Master job edits preserve polling order and an in-flight edit cannot corrupt persisted state', async (t) => {
  const rig = await createRig(t);
  rig.service.saveJob({ jobId: 'first', connectionId: 'master', unitId: 1, functionCode: 3, address: 0, quantity: 1, intervalMs: 1000 });
  rig.service.saveJob({ jobId: 'second', connectionId: 'master', unitId: 1, functionCode: 3, address: 1, quantity: 1, intervalMs: 1000 });

  await rig.service.readJobNow('first');
  rig.service.saveJob({ jobId: 'first', connectionId: 'master', unitId: 1, functionCode: 3, address: 2, quantity: 1, intervalMs: 500, label: 'Edited first' });
  assert.deepEqual(rig.service.listJobs().map((job) => job.jobId), ['first', 'second']);
  assert.equal(rig.service.getJob('first').address, 2);

  const session = rig.service.sessions.get('master');
  const runtimeJob = session.scheduler.jobs.get('first');
  runtimeJob.inFlight = true;
  await assert.rejects(
    async () => rig.service.saveJob({ jobId: 'first', connectionId: 'master', unitId: 1, functionCode: 3, address: 3, quantity: 1, intervalMs: 250 }),
    (error) => error.code === 'JOB_BUSY',
  );
  runtimeJob.inFlight = false;

  const persisted = rig.store.getActiveProject().masterJobs;
  assert.deepEqual(persisted.map((job) => job.jobId), ['first', 'second']);
  assert.equal(persisted[0].address, 2);
  assert.equal(session.scheduler.getJob('first').metadata.address, 2);
});
