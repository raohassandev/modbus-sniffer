'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createSerialRig({ framing = 'rtu', units = [1], timeoutMs = 80 } = {}) {
  const pair = v8.createVirtualLoopbackPair({ names: [`audit-${framing}-master`, `audit-${framing}-slave`] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'master', resourceKey: `virtual:audit:${framing}:master`, transportKind: `virtual-${framing}`, transport: pair.a });
  broker.defineConnection({ connectionId: 'slave', resourceKey: `virtual:audit:${framing}:slave`, transportKind: `virtual-${framing}`, transport: pair.b });
  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'slave', ownerId: 'slave-owner', framing, receivePollMs: 5 });
  const devices = units.map((unitId) => slave.addDevice({
    unitId,
    sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 32, inputRegisters: 32 },
  }));
  const master = new v8.MasterEngine({ broker, connectionId: 'master', ownerId: 'master-owner', framing, timeoutMs });
  await slave.start();
  await master.open();
  return {
    pair,
    broker,
    slave,
    master,
    devices,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 broker cannot pre-arm writes before open and always relocks on reopen', async () => {
  const pair = v8.createVirtualLoopbackPair();
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'c1', resourceKey: 'virtual:c1', transportKind: 'virtual', transport: pair.a });
  broker.acquire('c1', { ownerMode: 'master', ownerId: 'owner' });
  assert.throws(
    () => broker.setWriteLock('c1', { ownerId: 'owner', enabled: true }),
    (error) => error.code === 'CONNECTION_NOT_OPEN',
  );
  await broker.open('c1', { ownerMode: 'master', ownerId: 'owner' });
  broker.setWriteLock('c1', { ownerId: 'owner', enabled: true });
  assert.equal(broker.getConnection('c1').writeLock, 'ENABLED');
  await broker.close('c1', { ownerId: 'owner' });
  assert.equal(broker.getConnection('c1').writeLock, 'LOCKED');
  await broker.open('c1', { ownerMode: 'master', ownerId: 'owner' });
  assert.equal(broker.getConnection('c1').writeLock, 'LOCKED');
  await broker.close('c1', { ownerId: 'owner' });
  broker.release('c1', { ownerId: 'owner' });
});

test('v8 serial Master rejects Unit IDs above 247 and unsupported FC23 broadcast before transmit', async (t) => {
  const rig = await createSerialRig();
  t.after(() => rig.close());
  rig.master.setWriteEnabled(true);

  await assert.rejects(
    () => rig.master.request({ unitId: 248, pdu: v8.protocol.encodeReadRequest({ functionCode: v8.protocol.FC.READ_HOLDING_REGISTERS, address: 0, quantity: 1 }) }),
    (error) => error.code === 'INVALID_SERIAL_UNIT_ID',
  );

  await assert.rejects(
    () => rig.master.request({ unitId: 0, pdu: v8.protocol.encodeReadWriteMultipleRegistersRequest({ readAddress: 0, readQuantity: 1, writeAddress: 0, values: [7] }) }),
    (error) => error.code === 'INVALID_BROADCAST',
  );
  assert.equal(rig.broker.getTransmissionAudit().length, 0);
});

test('v8 ASCII Unit 0 broadcast applies supported writes to every virtual device without a response', async (t) => {
  const rig = await createSerialRig({ framing: 'ascii', units: [1, 2] });
  t.after(() => rig.close());
  rig.master.setWriteEnabled(true);

  const result = await rig.master.request({
    unitId: 0,
    pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 3, value: 4321 }),
  });
  assert.equal(result.broadcast, true);
  await sleep(20);
  assert.deepEqual(rig.devices[0].read('holdingRegisters', 3, 1), [4321]);
  assert.deepEqual(rig.devices[1].read('holdingRegisters', 3, 1), [4321]);
  assert.equal(rig.slave.snapshot().stats.broadcasts, 1);
});

test('v8 FC22 Mask Write Register codec, runtime and read-back use the same shared implementation', async (t) => {
  const pdu = v8.protocol.encodeMaskWriteRegisterRequest({ address: 1, andMask: 0xFF00, orMask: 0x0055 });
  assert.equal(pdu.toString('hex').toUpperCase(), '160001FF000055');
  assert.deepEqual(v8.protocol.decodeMaskWriteRegisterRequest(pdu), {
    functionCode: v8.protocol.FC.MASK_WRITE_REGISTER,
    address: 1,
    andMask: 0xFF00,
    orMask: 0x0055,
  });

  const rig = await createSerialRig();
  t.after(() => rig.close());
  rig.devices[0].seed('holdingRegisters', 1, [0xAAAA]);
  const audit = new v8.WriteAuditTrail();
  const safety = new v8.WriteSafetyController({ master: rig.master, auditTrail: audit });
  safety.unlock({ confirmation: { confirmed: true } });

  const result = await safety.execute({
    unitId: 1,
    pdu,
    confirmation: { confirmed: true },
    readBack: true,
  });
  assert.equal(result.decoded.functionCode, v8.protocol.FC.MASK_WRITE_REGISTER);
  assert.deepEqual(rig.devices[0].read('holdingRegisters', 1, 1), [0xAA55]);
  const record = audit.list()[0];
  assert.deepEqual(record.oldValues, [0xAAAA]);
  assert.deepEqual(record.requestedValues, [0xAA55]);
  assert.deepEqual(record.maskWrite, { andMask: 0xFF00, orMask: 0x0055 });
  assert.equal(record.verification.matched, true);
});

test('v8 broker keeps immutable raw evidence for direct writes and safe-write timeout audit keeps transmitted request bytes', async () => {
  const pair = v8.createVirtualLoopbackPair({ names: ['timeout-master', 'timeout-peer'] });
  await pair.b.open();
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'timeout-master', resourceKey: 'virtual:timeout-master', transportKind: 'virtual-rtu', transport: pair.a });
  const master = new v8.MasterEngine({ broker, connectionId: 'timeout-master', ownerId: 'timeout-owner', framing: 'rtu', timeoutMs: 15 });
  await master.open();
  const audit = new v8.WriteAuditTrail();
  const safety = new v8.WriteSafetyController({ master, auditTrail: audit });
  safety.unlock({ confirmation: { confirmed: true } });

  await assert.rejects(
    () => safety.execute({
      unitId: 1,
      pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 0, value: 55 }),
      confirmation: { confirmed: true },
      captureOldValue: false,
    }),
    (error) => error.code === 'TIMEOUT',
  );

  const enriched = audit.list()[0];
  assert.equal(enriched.result, 'failed');
  assert.ok(enriched.requestRawHex);
  const lowLevel = broker.getTransmissionAudit();
  assert.equal(lowLevel.length, 1);
  assert.equal(lowLevel[0].intent, 'write');
  assert.ok(lowLevel[0].rawHex);
  assert.equal(Object.isFrozen(lowLevel[0]), true);
  assert.equal(Object.isFrozen(lowLevel), true);

  await master.close();
  await pair.b.close();
});

test('v8 VirtualDevice seed validates values instead of silently wrapping typed-array data', () => {
  const device = new v8.VirtualDevice({ unitId: 1, sizes: { coils: 4, discreteInputs: 4, holdingRegisters: 4, inputRegisters: 4 } });
  assert.throws(() => device.seed('holdingRegisters', 0, [70000]), (error) => error.code === 'ILLEGAL_VALUE');
  assert.throws(() => device.seed('discreteInputs', 0, [2]), (error) => error.code === 'ILLEGAL_VALUE');
  device.seed('inputRegisters', 0, [65535]);
  assert.deepEqual(device.read('inputRegisters', 0, 1), [65535]);
});
