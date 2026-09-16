'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

async function createUdpRig() {
  const serverTransport = new v8.UdpServerTransport({ host: '127.0.0.1', port: 0 });
  const serverBroker = new v8.ConnectionBroker();
  serverBroker.defineConnection({
    connectionId: 'udp-slave',
    resourceKey: 'udp-listen:127.0.0.1:auto',
    transportKind: 'udp-server',
    transport: serverTransport,
  });
  const slave = new v8.VirtualSlaveServer({ broker: serverBroker, connectionId: 'udp-slave', ownerId: 'udp-slave-owner', framing: 'tcp', receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 64, inputRegisters: 32 } });
  device.seed('holdingRegisters', 0, [101, 102, 103, 104]);
  await slave.start();

  const address = serverTransport.address();
  const clientTransport = new v8.UdpClientTransport({ host: '127.0.0.1', port: address.port, receiveTimeoutMs: 300 });
  const clientBroker = new v8.ConnectionBroker();
  clientBroker.defineConnection({
    connectionId: 'udp-master',
    resourceKey: `udp-connect:127.0.0.1:${address.port}`,
    transportKind: 'udp-client',
    transport: clientTransport,
  });
  const master = new v8.MasterEngine({ broker: clientBroker, connectionId: 'udp-master', ownerId: 'udp-master-owner', framing: 'tcp', timeoutMs: 300, maxTcpConcurrency: 8 });
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

test('v8 Modbus UDP client/server carries MBAP requests through shared Master/Slave engine', async (t) => {
  const rig = await createUdpRig();
  t.after(() => rig.close());

  const result = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 2 }),
  });

  assert.deepEqual(result.decoded.values, [102, 103]);
  assert.equal(rig.clientTransport.status().capabilities.transport, 'udp-client');
  assert.equal(rig.serverTransport.status().capabilities.transport, 'udp-server');
  assert.equal(rig.serverTransport.listPeers().length, 1);
});

test('v8 Modbus UDP preserves transaction pairing under bounded concurrent Master reads', async (t) => {
  const rig = await createUdpRig();
  t.after(() => rig.close());

  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: index, quantity: 1 }),
  })));

  assert.deepEqual(results.map((row) => row.decoded.values[0]), [101, 102, 103, 104]);
  assert.equal(new Set(results.map((row) => row.transactionId)).size, 4);
});

test('v8 UDP server requires explicit reply route metadata and exposes peer evidence', async () => {
  const server = new v8.UdpServerTransport({ host: '127.0.0.1', port: 0 });
  await server.open();
  try {
    await assert.rejects(
      () => server.send(Buffer.from('000100000006010300000001', 'hex')),
      (error) => error.code === 'ROUTE_REQUIRED',
    );
  } finally {
    await server.close();
  }
});

test('v8 UDP transport rejects oversized datagrams before transmit', () => {
  assert.throws(
    () => v8.validateDatagram(Buffer.alloc(v8.MAX_MODBUS_DATAGRAM_BYTES + 1)),
    (error) => error.code === 'DATAGRAM_TOO_LARGE',
  );
});
