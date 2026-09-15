'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

async function createTcpRig() {
  const serverTransport = new v8.TcpServerTransport({ host: '127.0.0.1', port: 0 });
  const serverBroker = new v8.ConnectionBroker();
  serverBroker.defineConnection({
    connectionId: 'tcp-slave',
    resourceKey: 'tcp-listen:127.0.0.1:auto',
    transportKind: 'tcp-server',
    transport: serverTransport,
  });
  const slave = new v8.VirtualSlaveServer({
    broker: serverBroker,
    connectionId: 'tcp-slave',
    ownerId: 'tcp-slave-owner',
    framing: 'tcp',
  });
  const device = slave.addDevice({
    unitId: 1,
    sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 128, inputRegisters: 64 },
    identity: { vendorName: 'Automatrix', productCode: 'TCP-V8', revision: '8.0' },
  });
  device.seed('holdingRegisters', 0, Array.from({ length: 32 }, (_, index) => 1000 + index));
  await slave.start();

  const address = serverTransport.address();
  assert.ok(address?.port > 0);
  const clientTransport = new v8.TcpClientTransport({ host: '127.0.0.1', port: address.port, connectTimeoutMs: 1000 });
  const clientBroker = new v8.ConnectionBroker();
  clientBroker.defineConnection({
    connectionId: 'tcp-master',
    resourceKey: `tcp-connect:127.0.0.1:${address.port}`,
    transportKind: 'tcp-client',
    transport: clientTransport,
  });
  const master = new v8.MasterEngine({
    broker: clientBroker,
    connectionId: 'tcp-master',
    ownerId: 'tcp-master-owner',
    framing: 'tcp',
    timeoutMs: 500,
    maxTcpConcurrency: 8,
  });
  await master.open();

  return {
    serverTransport,
    clientTransport,
    serverBroker,
    clientBroker,
    slave,
    device,
    master,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 TCP stream framer handles fragmentation and coalesced ADUs', () => {
  const framer = new v8.ModbusTcpStreamFramer();
  const first = v8.protocol.encodeTcpAdu({
    transactionId: 10,
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 2 }),
  });
  const second = v8.protocol.encodeTcpAdu({
    transactionId: 11,
    unitId: 2,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 4, address: 8, quantity: 1 }),
  });

  assert.deepEqual(framer.push(first.subarray(0, 3)), []);
  assert.deepEqual(framer.push(first.subarray(3, 8)), []);
  const frames = framer.push(Buffer.concat([first.subarray(8), second]));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], first);
  assert.deepEqual(frames[1], second);
  assert.equal(framer.snapshot().bufferedBytes, 0);
});

test('v8 bounded receive queue matches out-of-order TCP transactions without stealing frames', async () => {
  const queue = new v8.BoundedReceiveQueue({ maxFrames: 4, maxBytes: 1024 });
  const one = v8.protocol.encodeTcpAdu({ transactionId: 1, unitId: 1, pdu: Buffer.from([3, 2, 0, 1]) });
  const two = v8.protocol.encodeTcpAdu({ transactionId: 2, unitId: 1, pdu: Buffer.from([3, 2, 0, 2]) });

  const waitingForTwo = queue.receive({ timeoutMs: 100, match: (raw) => raw.readUInt16BE(0) === 2 });
  queue.push(one, { transactionId: 1 });
  queue.push(two, { transactionId: 2 });

  assert.equal((await waitingForTwo).readUInt16BE(0), 2);
  assert.equal((await queue.receive({ timeoutMs: 100 })).readUInt16BE(0), 1);
});

test('v8 real TCP client/server connects Master to virtual Slave with read and write safety', async (t) => {
  const rig = await createTcpRig();
  t.after(() => rig.close());

  const status = rig.clientBroker.getConnection('tcp-master');
  assert.equal(status.state, 'open');
  assert.equal(status.transportState, 'open');
  assert.equal(status.transportCapabilities.transport, 'tcp-client');

  const read = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 3, quantity: 3 }),
  });
  assert.deepEqual(read.decoded.values, [1003, 1004, 1005]);

  await assert.rejects(
    () => rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 3, value: 4444 }) }),
    (error) => error.code === 'WRITE_LOCKED',
  );
  rig.master.setWriteEnabled(true);
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 3, value: 4444 }) });
  assert.deepEqual(rig.device.read('holdingRegisters', 3, 1), [4444]);
  assert.equal(rig.serverTransport.listClients().length, 1);
});

test('v8 TCP Master safely pairs concurrent responses by MBAP Transaction ID', async (t) => {
  const rig = await createTcpRig();
  t.after(() => rig.close());

  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: index, quantity: 1 }),
  })));

  assert.deepEqual(results.map((result) => result.decoded.values[0]), Array.from({ length: 8 }, (_, index) => 1000 + index));
  assert.equal(new Set(results.map((result) => result.transactionId)).size, 8);
  assert.equal(rig.master.status().tcpConcurrency.active, 0);
});

test('v8 TCP server routes responses to the correct client when multiple clients are connected', async (t) => {
  const server = new v8.TcpServerTransport({ host: '127.0.0.1', port: 0 });
  await server.open();
  t.after(() => server.close());
  const port = server.address().port;

  const clientA = new v8.TcpClientTransport({ host: '127.0.0.1', port });
  const clientB = new v8.TcpClientTransport({ host: '127.0.0.1', port });
  await Promise.all([clientA.open(), clientB.open()]);
  t.after(async () => { await Promise.all([clientA.close(), clientB.close()]); });

  const requestA = v8.protocol.encodeTcpAdu({ transactionId: 101, unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }) });
  const requestB = v8.protocol.encodeTcpAdu({ transactionId: 202, unitId: 2, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }) });
  await Promise.all([clientA.send(requestA), clientB.send(requestB)]);

  const first = await server.receive({ timeoutMs: 500, withMeta: true });
  const second = await server.receive({ timeoutMs: 500, withMeta: true });
  const requests = new Map([[first.bytes.readUInt16BE(0), first], [second.bytes.readUInt16BE(0), second]]);
  assert.equal(requests.size, 2);
  assert.notEqual(requests.get(101).meta.clientId, requests.get(202).meta.clientId);

  for (const [tid, received] of requests) {
    const decoded = v8.protocol.decodeTcpAdu(received.bytes);
    const response = v8.protocol.encodeTcpAdu({
      transactionId: decoded.transactionId,
      unitId: decoded.unitId,
      pdu: v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [tid] }),
    });
    await server.send(response, { route: received.meta });
  }

  const [responseA, responseB] = await Promise.all([clientA.receive({ timeoutMs: 500 }), clientB.receive({ timeoutMs: 500 })]);
  assert.equal(responseA.readUInt16BE(0), 101);
  assert.equal(responseB.readUInt16BE(0), 202);
  assert.equal(server.listClients().length, 2);
});

test('v8 TCP receive cancellation and timeout are deterministic', async () => {
  const queue = new v8.BoundedReceiveQueue();
  await assert.rejects(() => queue.receive({ timeoutMs: 10 }), (error) => error.code === 'TIMEOUT');

  const controller = new AbortController();
  const pending = queue.receive({ timeoutMs: 1000, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (error) => error.code === 'ABORTED');
});
