'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');
const { decodeFrame } = require('../src/modbus/decoder');

async function createRig({ framing = 'rtu', unitId = 1, sizes = {} } = {}) {
  const pair = v8.createVirtualLoopbackPair({ names: [`${framing}-master`, `${framing}-slave`] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({
    connectionId: `${framing}-master-connection`,
    resourceKey: `virtual:${framing}:master`,
    transportKind: `virtual-${framing}`,
    transport: pair.a,
  });
  broker.defineConnection({
    connectionId: `${framing}-slave-connection`,
    resourceKey: `virtual:${framing}:slave`,
    transportKind: `virtual-${framing}`,
    transport: pair.b,
  });

  const slave = new v8.VirtualSlaveServer({
    broker,
    connectionId: `${framing}-slave-connection`,
    ownerId: `${framing}-slave-owner`,
    framing,
  });
  const device = slave.addDevice({
    unitId,
    sizes: {
      coils: 64,
      discreteInputs: 64,
      holdingRegisters: 64,
      inputRegisters: 64,
      ...sizes,
    },
    identity: {
      vendorName: 'Automatrix',
      productCode: 'V8-RIG',
      revision: '8.0-test',
      modelName: 'Virtual Conformance Device',
    },
  });
  device.seed('coils', 0, [true, false, true, true, false, true]);
  device.seed('discreteInputs', 0, [false, true, false, true]);
  device.seed('holdingRegisters', 0, [100, 200, 300, 400, 500, 600]);
  device.seed('inputRegisters', 0, [230, 231, 232, 233]);

  const master = new v8.MasterEngine({
    broker,
    connectionId: `${framing}-master-connection`,
    ownerId: `${framing}-master-owner`,
    framing,
    timeoutMs: 100,
  });

  await slave.start();
  await master.open();

  return {
    broker,
    master,
    slave,
    device,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 Master reads all four core memory areas from virtual RTU Slave', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  const coils = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 1, address: 0, quantity: 6 }),
  });
  assert.deepEqual(coils.decoded.values, [true, false, true, true, false, true]);

  const inputs = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 2, address: 0, quantity: 4 }),
  });
  assert.deepEqual(inputs.decoded.values, [false, true, false, true]);

  const holding = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 3 }),
  });
  assert.deepEqual(holding.decoded.values, [200, 300, 400]);

  const inputRegisters = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 4, address: 0, quantity: 4 }),
  });
  assert.deepEqual(inputRegisters.decoded.values, [230, 231, 232, 233]);
});

test('v8 Master write lock blocks writes until explicitly armed and supports FC05/06/15/16', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  await assert.rejects(
    () => rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 1, value: 999 }) }),
    (error) => error.code === 'WRITE_LOCKED',
  );
  assert.deepEqual(rig.device.read('holdingRegisters', 1, 1), [200]);

  rig.master.setWriteEnabled(true);

  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 1, value: 999 }) });
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleCoilRequest({ address: 1, value: true }) });
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteMultipleRegistersRequest({ address: 2, values: [11, 22, 33] }) });
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteMultipleCoilsRequest({ address: 2, values: [false, true, false, true] }) });

  assert.deepEqual(rig.device.read('holdingRegisters', 1, 4), [999, 11, 22, 33]);
  assert.deepEqual(rig.device.read('coils', 1, 5), [true, false, true, false, true]);
});

test('v8 FC23 write/read operation is range-validated before mutation', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  rig.master.setWriteEnabled(true);

  const result = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadWriteMultipleRegistersRequest({
      readAddress: 0,
      readQuantity: 4,
      writeAddress: 2,
      values: [777, 888],
    }),
  });
  assert.deepEqual(result.decoded.values, [100, 200, 777, 888]);

  await assert.rejects(
    () => rig.master.request({
      unitId: 1,
      pdu: v8.protocol.encodeReadWriteMultipleRegistersRequest({
        readAddress: 63,
        readQuantity: 2,
        writeAddress: 2,
        values: [1, 2],
      }),
    }),
    (error) => error.code === 'MODBUS_EXCEPTION' && error.details.exceptionCode === 2,
  );
  assert.deepEqual(rig.device.read('holdingRegisters', 2, 2), [777, 888]);
});

test('v8 RTU Unit 0 broadcast write produces no response and is applied before next serialized read', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  rig.master.setWriteEnabled(true);

  const broadcast = await rig.master.request({
    unitId: 0,
    pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 5, value: 4321 }),
  });
  assert.equal(broadcast.broadcast, true);
  assert.equal(broadcast.responseRaw, null);

  const readBack = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 5, quantity: 1 }),
  });
  assert.deepEqual(readBack.decoded.values, [4321]);
  assert.equal(rig.slave.snapshot().stats.broadcasts, 1);
});

test('v8 virtual Slave returns standard exceptions and stays silent for an unknown Unit ID', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  await assert.rejects(
    () => rig.master.request({
      unitId: 1,
      pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 60, quantity: 8 }),
    }),
    (error) => error.code === 'MODBUS_EXCEPTION' && error.details.exceptionCode === 2,
  );

  await assert.rejects(
    () => rig.master.request({
      unitId: 2,
      pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }),
      timeoutMs: 20,
    }),
    (error) => error.code === 'TIMEOUT',
  );
  assert.ok(rig.slave.snapshot().stats.silentUnknownUnits >= 1);
});

test('v8 Master/Slave FC43 identity round-trips through shared protocol core', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  const result = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeDeviceIdRequest({ readDeviceIdCode: 2, objectId: 0 }),
  });
  const map = Object.fromEntries(result.decoded.objects.map((object) => [object.id, object.text]));
  assert.equal(map[0], 'Automatrix');
  assert.equal(map[1], 'V8-RIG');
  assert.equal(map[2], '8.0-test');
  assert.equal(map[5], 'Virtual Conformance Device');
});

test('v8 serial Master requests are strictly serialized under concurrent callers', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  const results = await Promise.all([
    rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }) }),
    rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 1 }) }),
    rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 2, quantity: 1 }) }),
  ]);
  assert.deepEqual(results.map((result) => result.decoded.values[0]), [100, 200, 300]);
});

test('v8 TCP virtual Master/Slave preserves MBAP Transaction ID and response pairing', async (t) => {
  const rig = await createRig({ framing: 'tcp' });
  t.after(() => rig.close());

  const first = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }) });
  const second = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 1 }) });
  assert.equal(first.transactionId, 1);
  assert.equal(second.transactionId, 2);
  assert.deepEqual(first.decoded.values, [100]);
  assert.deepEqual(second.decoded.values, [200]);
});

test('v8 ASCII virtual Master/Slave shares the same PDU behavior', async (t) => {
  const rig = await createRig({ framing: 'ascii' });
  t.after(() => rig.close());

  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 4, address: 1, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [231, 232]);
  assert.equal(result.requestRaw.toString('ascii').startsWith(':'), true);
  assert.equal(result.responseRaw.toString('ascii').endsWith('\r\n'), true);
});

test('v8 RTU exchange remains decodable by the existing v7 analyzer decoder', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  const events = [];
  rig.master.on('event', (event) => events.push(event));

  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 2 }) });
  const tx = events.find((event) => event.type === 'traffic.tx');
  const rx = events.find((event) => event.type === 'traffic.rx');
  assert.ok(tx && rx);

  const txDecoded = decodeFrame(Buffer.from(tx.rawHex, 'hex'));
  const rxDecoded = decodeFrame(Buffer.from(rx.rawHex, 'hex'));
  assert.equal(txDecoded.kind, 'request');
  assert.equal(txDecoded.functionCode, 3);
  assert.equal(txDecoded.startAddress, 1);
  assert.equal(txDecoded.quantity, 2);
  assert.equal(rxDecoded.kind, 'response');
  assert.deepEqual(rxDecoded.words, [200, 300]);
});
