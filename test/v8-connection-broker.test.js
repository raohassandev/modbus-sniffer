'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ConnectionBroker } = require('../src/v8/connectionBroker');
const { createWorkbenchEvent } = require('../src/v8/events');
const { createVirtualLoopbackPair } = require('../src/v8/transports/virtualLoopback');

test('v8 Connection Broker prevents two owners from claiming the same exclusive serial resource', () => {
  const broker = new ConnectionBroker();
  broker.defineConnection({ connectionId: 'passive-com7', resourceKey: 'serial:COM7', transportKind: 'serial-rtu' });
  broker.defineConnection({ connectionId: 'master-com7', resourceKey: 'serial:COM7', transportKind: 'serial-rtu' });

  const passive = broker.acquire('passive-com7', { ownerMode: 'analyzer', ownerId: 'analyzer-workspace' });
  assert.equal(passive.transmitCapability, 'none');
  assert.equal(passive.writeLock, 'LOCKED');

  assert.throws(
    () => broker.acquire('master-com7', { ownerMode: 'master', ownerId: 'master-workspace' }),
    (error) => error.code === 'RESOURCE_BUSY',
  );

  broker.release('passive-com7', { ownerId: 'analyzer-workspace' });
  const active = broker.acquire('master-com7', { ownerMode: 'master', ownerId: 'master-workspace' });
  assert.equal(active.transmitCapability, 'active');
  assert.equal(active.writeLock, 'LOCKED');
});

test('v8 write lock is limited to Master/Test ownership and always resets on release', () => {
  const broker = new ConnectionBroker();
  broker.defineConnection({ connectionId: 'master-1', resourceKey: 'tcp-client:10.0.0.10:502', transportKind: 'tcp-client' });
  broker.acquire('master-1', { ownerMode: 'master', ownerId: 'master' });
  assert.equal(broker.setWriteLock('master-1', { ownerId: 'master', enabled: true }).writeLock, 'ENABLED');
  broker.release('master-1', { ownerId: 'master' });
  assert.equal(broker.acquire('master-1', { ownerMode: 'master', ownerId: 'master' }).writeLock, 'LOCKED');

  broker.defineConnection({ connectionId: 'discovery-1', resourceKey: 'tcp-client:10.0.0.11:502', transportKind: 'tcp-client' });
  broker.acquire('discovery-1', { ownerMode: 'discovery', ownerId: 'discovery' });
  assert.throws(
    () => broker.setWriteLock('discovery-1', { ownerId: 'discovery', enabled: true }),
    (error) => error.code === 'WRITE_NOT_ALLOWED',
  );
});

test('v8 Connection Broker opens virtual transport and emits normalized state events', async () => {
  const { a, b } = createVirtualLoopbackPair({ names: ['master-side', 'slave-side'] });
  await b.open();

  const broker = new ConnectionBroker();
  const events = [];
  broker.on('event', (event) => events.push(event));
  broker.defineConnection({
    connectionId: 'virtual-master',
    resourceKey: 'virtual:test-master',
    transportKind: 'virtual',
    transport: a,
  });

  const status = await broker.open('virtual-master', { ownerMode: 'master', ownerId: 'master-engine' });
  assert.equal(status.state, 'open');
  assert.equal(status.owner.ownerMode, 'master');
  assert.ok(events.some((event) => event.type === 'connection.opened' && event.connectionId === 'virtual-master'));

  await broker.close('virtual-master', { ownerId: 'master-engine' });
  broker.release('virtual-master', { ownerId: 'master-engine' });
  assert.equal(broker.getConnection('virtual-master').writeLock, 'LOCKED');
});

test('v8 virtual loopback transports bytes exactly and supports timeout/abort semantics', async () => {
  const { a, b } = createVirtualLoopbackPair();
  await a.open();
  await b.open();

  const receive = b.receive({ timeoutMs: 100 });
  await a.send(Buffer.from('010300000001', 'hex'));
  assert.equal((await receive).toString('hex'), '010300000001');

  await assert.rejects(() => b.receive({ timeoutMs: 5 }), (error) => error.code === 'TIMEOUT');

  const controller = new AbortController();
  const aborted = b.receive({ timeoutMs: 100, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => aborted, (error) => error.code === 'ABORTED');
});

test('v8 event envelope preserves raw evidence without coupling to UI state', () => {
  const event = createWorkbenchEvent({
    eventId: 'evt-1',
    timestamp: 1234,
    type: 'traffic.tx',
    source: 'master-engine',
    connectionId: 'master-1',
    ownerMode: 'master',
    direction: 'tx',
    unitId: 1,
    functionCode: 3,
    raw: Buffer.from('010300000001', 'hex'),
    details: { address: 0, quantity: 1 },
  });
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.rawHex, '010300000001');
  assert.equal(event.details.quantity, 1);
  assert.ok(Object.isFrozen(event));
  assert.ok(Object.isFrozen(event.details));
});
