'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-transport-completion-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function createTunnelRig(framing) {
  const serverTransport = new v8.TunnelTcpServerTransport({ host: '127.0.0.1', port: 0, framing });
  const serverBroker = new v8.ConnectionBroker();
  serverBroker.defineConnection({ connectionId: 'slave', resourceKey: `tunnel:${framing}:server`, transportKind: `${framing}-tcp-server`, transport: serverTransport });
  const slave = new v8.VirtualSlaveServer({ broker: serverBroker, connectionId: 'slave', ownerId: 'slave-owner', framing, receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 64, inputRegisters: 32 } });
  device.seed('holdingRegisters', 0, [101, 202, 303, 404]);
  await slave.start();

  const port = serverTransport.address().port;
  const clientTransport = new v8.TunnelTcpClientTransport({ host: '127.0.0.1', port, framing, connectTimeoutMs: 1000 });
  const clientBroker = new v8.ConnectionBroker();
  clientBroker.defineConnection({ connectionId: 'master', resourceKey: `tunnel:${framing}:client`, transportKind: `${framing}-tcp-client`, transport: clientTransport, exclusive: false });
  const master = new v8.MasterEngine({ broker: clientBroker, connectionId: 'master', ownerId: 'master-owner', framing, timeoutMs: 500 });
  await master.open();
  return {
    serverTransport,
    clientTransport,
    slave,
    master,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 RTU-over-TCP framer survives fragmentation and coalesced frames', () => {
  const framer = new v8.RtuCrcStreamFramer();
  const first = v8.protocol.encodeRtuAdu(1, v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }));
  const second = v8.protocol.encodeRtuAdu(2, v8.protocol.encodeReadRequest({ functionCode: 4, address: 7, quantity: 2 }));
  assert.deepEqual(framer.push(first.subarray(0, 3)), []);
  const frames = framer.push(Buffer.concat([first.subarray(3), second]));
  assert.deepEqual(frames, [first, second]);
  assert.equal(framer.snapshot().bufferedBytes, 0);
});

test('v8 ASCII-over-TCP framer resynchronizes and validates LRC', () => {
  const framer = new v8.AsciiTunnelStreamFramer();
  const first = v8.protocol.encodeAsciiAdu(1, v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }));
  const second = v8.protocol.encodeAsciiAdu(2, v8.protocol.encodeReadRequest({ functionCode: 4, address: 3, quantity: 1 }));
  assert.deepEqual(framer.push(Buffer.concat([Buffer.from('junk'), first.subarray(0, 5)])), []);
  const frames = framer.push(Buffer.concat([first.subarray(5), second]));
  assert.deepEqual(frames, [first, second]);
});

test('v8 RTU-over-TCP is a distinct transport and drives the shared Master/Slave codec', async (t) => {
  const rig = await createTunnelRig('rtu');
  t.after(() => rig.close());
  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [202, 303]);
  assert.equal(rig.clientTransport.status().capabilities.transport, 'rtu-tcp-client');
  assert.equal(rig.clientTransport.status().capabilities.nativeMbap, false);
});

test('v8 ASCII-over-TCP drives the shared ASCII Master/Slave codec', async (t) => {
  const rig = await createTunnelRig('ascii');
  t.after(() => rig.close());
  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [101, 202]);
  assert.equal(result.requestRaw.toString('ascii').startsWith(':'), true);
});

test('v8 native Modbus UDP uses MBAP framing end to end without being confused with RTU-over-UDP', async (t) => {
  const serverTransport = new v8.UdpServerTransport({ host: '127.0.0.1', port: 0 });
  const serverBroker = new v8.ConnectionBroker();
  serverBroker.defineConnection({ connectionId: 'udp-slave', resourceKey: 'udp:server', transportKind: 'udp-server', transport: serverTransport });
  const slave = new v8.VirtualSlaveServer({ broker: serverBroker, connectionId: 'udp-slave', ownerId: 'udp-slave-owner', framing: 'tcp', receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 5, sizes: { coils: 8, discreteInputs: 8, holdingRegisters: 16, inputRegisters: 8 } });
  device.seed('holdingRegisters', 0, [1111, 2222]);
  await slave.start();

  const address = serverTransport.address();
  const clientTransport = new v8.UdpClientTransport({ host: '127.0.0.1', port: address.port });
  const clientBroker = new v8.ConnectionBroker();
  clientBroker.defineConnection({ connectionId: 'udp-master', resourceKey: 'udp:client', transportKind: 'udp-client', transport: clientTransport, exclusive: false });
  const master = new v8.MasterEngine({ broker: clientBroker, connectionId: 'udp-master', ownerId: 'udp-master-owner', framing: 'tcp', timeoutMs: 500 });
  await master.open();
  t.after(async () => {
    await master.close();
    await slave.stop({ closeConnection: true });
  });

  const result = await master.request({ unitId: 5, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [1111, 2222]);
  assert.ok(result.transactionId > 0);
});

test('v8 Connection Center persists transport configuration safely and keeps tunnel/native/TLS kinds distinct', (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const center = new v8.ConnectionCenterService({ store, broker });

  center.saveProfile({
    connectionId: 'rtu-tunnel',
    name: 'RTU tunnel',
    transportKind: 'rtu-tcp-client',
    endpoint: '127.0.0.1',
    tunnel: { host: '127.0.0.1', port: 1502, connectTimeoutMs: 900 },
  });
  center.saveProfile({
    connectionId: 'udp-native',
    name: 'Native Modbus UDP',
    transportKind: 'udp-client',
    endpoint: '127.0.0.1',
    udp: { host: '127.0.0.1', port: 1503 },
  });
  center.saveProfile({
    connectionId: 'tls-secure',
    name: 'Secure Modbus',
    transportKind: 'tls-client',
    endpoint: 'localhost',
    tls: { host: 'localhost', port: 802, rejectUnauthorized: true, servername: 'localhost' },
  });

  const profiles = new Map(center.listProfiles().map((profile) => [profile.connectionId, profile]));
  assert.equal(profiles.get('rtu-tunnel').metadata.transportOptions.tunnel.port, 1502);
  assert.equal(profiles.get('udp-native').metadata.transportOptions.udp.port, 1503);
  assert.equal(profiles.get('tls-secure').metadata.transportOptions.tls.rejectUnauthorized, true);
  assert.equal(profiles.get('tls-secure').metadata.transportOptions.tls.key, undefined);
  assert.equal(center.get('rtu-tunnel').runtime.transportKind, 'rtu-tcp-client');
  assert.equal(center.get('udp-native').runtime.transportKind, 'udp-client');
  assert.equal(center.get('tls-secure').runtime.transportKind, 'tls-client');
});

test('v8 TLS policy is fail closed and requires complete server/client identity material', () => {
  const client = v8.normalizeClientTlsOptions({});
  assert.equal(client.rejectUnauthorized, true);
  assert.equal(client.minVersion, 'TLSv1.2');
  assert.throws(() => v8.normalizeClientTlsOptions({ cert: 'cert-only' }), (error) => error.code === 'TLS_CLIENT_CERT_INCOMPLETE');
  assert.throws(() => v8.normalizeServerTlsOptions({ cert: 'cert-only' }), (error) => error.code === 'TLS_MATERIAL_REQUIRED');
  const server = v8.normalizeServerTlsOptions({ cert: 'cert', key: 'key', requestCert: true, rejectUnauthorized: true });
  assert.equal(server.requestCert, true);
  assert.equal(server.rejectUnauthorized, true);
});

test('v8 Master workspace classifies native UDP/TLS as MBAP and tunnel profiles by encapsulated framing', () => {
  const proto = v8.MasterWorkspaceService.prototype;
  assert.equal(proto._framing({ transportKind: 'udp-client' }), 'tcp');
  assert.equal(proto._framing({ transportKind: 'tls-client' }), 'tcp');
  assert.equal(proto._framing({ transportKind: 'rtu-tcp-client' }), 'rtu');
  assert.equal(proto._framing({ transportKind: 'ascii-udp-client' }), 'ascii');
  assert.equal(proto._isMasterEligible({ transportKind: 'tls-client' }), true);
  assert.equal(proto._isMasterEligible({ transportKind: 'tls-server' }), false);
});
