'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createRig() {
  const pair = v8.createVirtualLoopbackPair({ names: ['safety-master', 'safety-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'safety-master', resourceKey: 'virtual:safety:master', transportKind: 'virtual-rtu', transport: pair.a });
  broker.defineConnection({ connectionId: 'safety-slave', resourceKey: 'virtual:safety:slave', transportKind: 'virtual-rtu', transport: pair.b });
  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'safety-slave', ownerId: 'safety-slave-owner', framing: 'rtu', receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 64, inputRegisters: 64 } });
  device.seed('coils', 0, [false, true, false, true]);
  device.seed('holdingRegisters', 0, [100, 200, 300, 400]);
  const master = new v8.MasterEngine({ broker, connectionId: 'safety-master', ownerId: 'safety-master-owner', framing: 'rtu', timeoutMs: 100 });
  await slave.start();
  await master.open();
  return {
    broker,
    slave,
    device,
    master,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 address notation preserves canonical zero-based address across views', () => {
  assert.equal(v8.toCanonicalAddress('0', { mode: 'zero-based' }), 0);
  assert.equal(v8.toCanonicalAddress('1', { mode: 'one-based' }), 0);
  assert.equal(v8.toCanonicalAddress('40001', { mode: 'reference', area: 'holdingRegisters' }), 0);
  assert.equal(v8.toCanonicalAddress('400001', { mode: 'reference', area: 'holdingRegisters' }), 0);
  assert.equal(v8.formatAddress(0, { mode: 'reference', area: 'holdingRegisters' }), '40001');
  assert.equal(v8.formatAddress(0, { mode: 'reference', area: 'holdingRegisters', extended: true }), '400001');
  assert.equal(v8.addressView(123, 'inputRegisters').canonical, 123);
  assert.throws(() => v8.toCanonicalAddress('30001', { mode: 'reference', area: 'holdingRegisters' }), (error) => error.code === 'AREA_PREFIX_MISMATCH');
});

test('v8 PollScheduler retries failed jobs without starving healthy jobs', async () => {
  const attempts = [];
  const master = {
    connectionId: 'stub-master',
    async request({ unitId }) {
      attempts.push({ unitId, at: Date.now() });
      await sleep(1);
      if (unitId === 1) throw Object.assign(new Error('offline'), { code: 'TIMEOUT' });
      return { rttMs: 1, transactionId: null };
    },
  };
  const scheduler = new v8.PollScheduler({ master, tickMs: 2, minimumInterRequestDelayMs: 1 });
  scheduler.addJob({ jobId: 'dead', unitId: 1, pdu: Buffer.from([3, 0, 0, 0, 1]), intervalMs: 20, timeoutMs: 10, retries: 2, retryDelayMs: 2 });
  scheduler.addJob({ jobId: 'healthy', unitId: 2, pdu: Buffer.from([3, 0, 0, 0, 1]), intervalMs: 10, timeoutMs: 10 });
  scheduler.start();
  await sleep(65);
  scheduler.stop();

  const dead = scheduler.getJob('dead');
  const healthy = scheduler.getJob('healthy');
  assert.ok(dead.stats.timeouts >= 2);
  assert.ok(dead.stats.retries >= 1);
  assert.ok(healthy.stats.successes >= 2);
  assert.ok(attempts.some((entry) => entry.unitId === 2));
});

test('v8 PollScheduler pause/resume and disable-on-error are deterministic', async () => {
  let calls = 0;
  const master = {
    connectionId: 'stub-master',
    async request() {
      calls += 1;
      throw Object.assign(new Error('bad target'), { code: 'MODBUS_EXCEPTION' });
    },
  };
  const scheduler = new v8.PollScheduler({ master, tickMs: 2 });
  scheduler.addJob({ jobId: 'disable-me', unitId: 3, pdu: Buffer.from([3, 0, 0, 0, 1]), intervalMs: 10, timeoutMs: 10, disableOnError: true });
  scheduler.start();
  await sleep(15);
  assert.equal(scheduler.getJob('disable-me').enabled, false);
  const afterFailure = calls;
  scheduler.pause();
  await sleep(10);
  assert.equal(calls, afterFailure);
  scheduler.enableJob('disable-me', true);
  scheduler.resume();
  await sleep(12);
  scheduler.stop();
  assert.ok(calls > afterFailure);
});

test('v8 safe write service captures old value, verifies read-back and appends immutable audit', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  const audit = new v8.WriteAuditTrail();
  const safety = new v8.WriteSafetyController({ master: rig.master, auditTrail: audit, userId: 'engineer-1', sessionId: 'session-1' });

  assert.throws(() => safety.unlock(), (error) => error.code === 'CONFIRMATION_REQUIRED');
  safety.unlock({ confirmation: { confirmed: true } });
  await safety.execute({
    unitId: 1,
    pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 1, value: 999 }),
    confirmation: { confirmed: true },
    captureOldValue: true,
    readBack: true,
    context: { reason: 'commissioning test' },
  });

  assert.deepEqual(rig.device.read('holdingRegisters', 1, 1), [999]);
  const entries = audit.list();
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].oldValues, [200]);
  assert.deepEqual(entries[0].requestedValues, [999]);
  assert.equal(entries[0].verification.matched, true);
  assert.equal(entries[0].result, 'success');
  assert.equal(Object.isFrozen(entries[0]), true);
  assert.throws(() => audit.clear(), (error) => error.code === 'AUDIT_APPEND_ONLY');
});

test('v8 safe write service requires stronger confirmation for bulk and broadcast writes', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  const safety = new v8.WriteSafetyController({ master: rig.master });
  safety.unlock({ confirmation: { confirmed: true } });

  const bulk = v8.protocol.encodeWriteMultipleRegistersRequest({ address: 0, values: [7, 8] });
  await assert.rejects(
    () => safety.execute({ unitId: 1, pdu: bulk, confirmation: { confirmed: true } }),
    (error) => error.code === 'BULK_CONFIRMATION_REQUIRED',
  );
  await safety.execute({ unitId: 1, pdu: bulk, confirmation: { confirmed: true, bulk: true }, readBack: true });
  assert.deepEqual(rig.device.read('holdingRegisters', 0, 2), [7, 8]);

  const broadcast = v8.protocol.encodeWriteSingleRegisterRequest({ address: 2, value: 1234 });
  await assert.rejects(
    () => safety.execute({ unitId: 0, pdu: broadcast, confirmation: { confirmed: true } }),
    (error) => error.code === 'BROADCAST_CONFIRMATION_REQUIRED',
  );
  await safety.execute({ unitId: 0, pdu: broadcast, confirmation: { confirmed: true, broadcast: true }, captureOldValue: false });
  assert.deepEqual(rig.device.read('holdingRegisters', 2, 1), [1234]);
});

test('v8 timed write unlock automatically returns connection to LOCKED state', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  const safety = new v8.WriteSafetyController({ master: rig.master, defaultAutoLockMs: 15 });
  safety.unlock({ confirmation: { confirmed: true } });
  assert.equal(rig.broker.getConnection('safety-master').writeLock, 'ENABLED');
  await sleep(35);
  assert.equal(rig.broker.getConnection('safety-master').writeLock, 'LOCKED');
  assert.equal(safety.status().autoLockActive, false);
});
