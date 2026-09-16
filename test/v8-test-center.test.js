'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

async function createRecipeRig() {
  const pair = v8.createVirtualLoopbackPair({ names: ['recipe-master', 'recipe-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'master', resourceKey: 'virtual:recipe:master', transportKind: 'virtual-rtu', transport: pair.a });
  broker.defineConnection({ connectionId: 'slave', resourceKey: 'virtual:recipe:slave', transportKind: 'virtual-rtu', transport: pair.b });
  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'slave', ownerId: 'recipe-slave-owner', framing: 'rtu', receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 16, discreteInputs: 16, holdingRegisters: 32, inputRegisters: 16 } });
  device.seed('holdingRegisters', 0, [10, 20, 30]);
  const master = new v8.MasterEngine({ broker, connectionId: 'master', ownerId: 'recipe-master-owner', framing: 'rtu', timeoutMs: 200 });
  const writeAudit = new v8.WriteAuditTrail();
  const writeSafety = new v8.WriteSafetyController({ master, auditTrail: writeAudit, userId: 'recipe-test' });
  await slave.start();
  return {
    pair,
    broker,
    slave,
    device,
    master,
    writeSafety,
    writeAudit,
    async close() {
      try { await master.close(); } catch { /* may already be released */ }
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 Raw Frame Studio keeps malformed/manual traffic behind an explicit LAB latch', async () => {
  const pair = v8.createVirtualLoopbackPair({ names: ['raw-test', 'raw-peer'] });
  await pair.b.open();
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'raw', resourceKey: 'virtual:raw', transportKind: 'virtual-rtu', transport: pair.a });
  const studio = new v8.RawFrameStudio({ broker, connectionId: 'raw', framing: 'rtu' });
  await studio.open();

  await assert.rejects(
    () => studio.send({ hex: '010300', expectResponse: false, confirmation: { raw: true } }),
    (error) => error.code === 'LAB_NOT_ARMED',
  );

  studio.armLab({ confirmation: { confirmed: true, raw: true } });
  const sent = await studio.send({ hex: '010300', expectResponse: false, confirmation: { raw: true } });
  assert.equal(sent.intent, 'raw');
  assert.equal(broker.getTransmissionAudit().at(-1).intent, 'raw');
  assert.equal(studio.listAudit().at(-1).result, 'success');

  await studio.close();
  await pair.b.close();
});

test('v8 Raw Frame Studio routes validated write frames through the normal per-connection write latch', async () => {
  const pair = v8.createVirtualLoopbackPair({ names: ['raw-write', 'raw-write-peer'] });
  await pair.b.open();
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'raw-write', resourceKey: 'virtual:raw-write', transportKind: 'virtual-rtu', transport: pair.a });
  const studio = new v8.RawFrameStudio({ broker, connectionId: 'raw-write', framing: 'rtu' });
  await studio.open();

  await assert.rejects(
    () => studio.send({ hex: '010600010042', autoChecksum: true, expectResponse: false, confirmation: { write: true } }),
    (error) => error.code === 'WRITE_LOCKED',
  );

  studio.setWriteEnabled(true);
  const result = await studio.send({ hex: '010600010042', autoChecksum: true, expectResponse: false, confirmation: { write: true } });
  assert.equal(result.intent, 'write');
  assert.equal(result.classification.functionCode, v8.protocol.FC.WRITE_SINGLE_REGISTER);
  assert.equal(broker.getTransmissionAudit().at(-1).intent, 'write');

  await studio.close();
  await pair.b.close();
});

test('v8 Recipe Engine runs deterministic connect/read/assert/write/readback/lock/disconnect sequence with evidence', async (t) => {
  const rig = await createRecipeRig();
  t.after(() => rig.close());
  const engine = new v8.RecipeEngine({
    resolveContext(connectionId) {
      if (connectionId !== 'master') return null;
      return { master: rig.master, writeSafety: rig.writeSafety };
    },
  });

  const recipe = {
    schemaVersion: v8.RECIPE_SCHEMA_VERSION,
    id: 'commissioning-smoke',
    name: 'Commissioning smoke',
    steps: [
      { id: 'connect', type: 'connect' },
      { id: 'read-before', type: 'read', unitId: 1, functionCode: 3, address: 0, quantity: 1, saveAs: 'before' },
      { id: 'assert-before', type: 'assert', variable: 'before.0', operator: 'equals', expected: 10 },
      { id: 'arm', type: 'armWrites', confirmation: { confirmed: true } },
      { id: 'write', type: 'write', unitId: 1, functionCode: 6, address: 0, value: 77, confirmation: { confirmed: true }, readBack: true },
      { id: 'read-after', type: 'read', unitId: 1, functionCode: 3, address: 0, quantity: 1, saveAs: 'after' },
      { id: 'assert-after', type: 'assert', variable: 'after.0', operator: 'equals', expected: 77 },
      { id: 'lock', type: 'lockWrites' },
      { id: 'disconnect', type: 'disconnect' },
    ],
  };

  const result = await engine.run(recipe, { defaultConnectionId: 'master' });
  assert.equal(result.passed, true);
  assert.equal(result.variables.before[0], 10);
  assert.equal(result.variables.after[0], 77);
  assert.deepEqual(rig.device.read('holdingRegisters', 0, 1), [77]);
  assert.equal(rig.writeAudit.list().length, 1);
  assert.ok(result.evidence.find((row) => row.stepId === 'write').requestRawHex);
  assert.equal(result.evidence.every((row) => row.result === 'passed'), true);
});

test('v8 Recipe Engine cancellation interrupts long delay and returns traceable failed run evidence', async () => {
  const fakeMaster = { open: async () => ({}), close: async () => ({}), request: async () => ({}) };
  const engine = new v8.RecipeEngine({ resolveContext: () => ({ master: fakeMaster }) });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    () => engine.run({ schemaVersion: 1, steps: [{ id: 'wait', type: 'delay', ms: 500 }] }, { defaultConnectionId: 'fake', signal: controller.signal }),
    (error) => error.code === 'ABORTED' && error.recipeResult?.passed === false && error.recipeResult?.evidence[0]?.stepId === 'wait',
  );
});

test('v8 Recipe Engine rejects unsupported schema versions and duplicate step IDs before I/O', () => {
  assert.throws(
    () => v8.validateRecipe({ schemaVersion: 2, steps: [{ type: 'delay', ms: 1 }] }),
    (error) => error.code === 'UNSUPPORTED_RECIPE_VERSION',
  );
  assert.throws(
    () => v8.validateRecipe({ schemaVersion: 1, steps: [{ id: 'same', type: 'delay', ms: 1 }, { id: 'same', type: 'delay', ms: 1 }] }),
    (error) => error.code === 'DUPLICATE_STEP_ID',
  );
});
