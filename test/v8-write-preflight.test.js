'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MasterWorkspaceService, preflightWriteConfirmation } = require('../src/v8/master/masterWorkspaceServiceHardened');

function serviceWithSessionProbe() {
  const service = new MasterWorkspaceService({
    store: {},
    broker: {},
    connectionCenter: { activeProjectId: () => 'project-default' },
  });
  let acquisitions = 0;
  service._ensureSession = async () => {
    acquisitions += 1;
    throw new Error('session acquisition should not occur for rejected preflight');
  };
  return { service, acquisitions: () => acquisitions };
}

test('v8 write confirmation preflight rejects missing confirmation before opening a session', async () => {
  const probe = serviceWithSessionProbe();
  await assert.rejects(
    () => probe.service.writeOnce({ connectionId: 'grid', unitId: 1, functionCode: 6, address: 1, value: 10 }),
    (error) => error.code === 'CONFIRMATION_REQUIRED',
  );
  assert.equal(probe.acquisitions(), 0);
});

test('v8 write confirmation preflight rejects bulk and broadcast gaps before session acquisition', async () => {
  const bulk = serviceWithSessionProbe();
  await assert.rejects(
    () => bulk.service.writeOnce({ connectionId: 'grid', unitId: 1, functionCode: 16, address: 1, values: [10, 20], confirmation: { confirmed: true } }),
    (error) => error.code === 'BULK_CONFIRMATION_REQUIRED',
  );
  assert.equal(bulk.acquisitions(), 0);

  const broadcast = serviceWithSessionProbe();
  await assert.rejects(
    () => broadcast.service.writeOnce({ connectionId: 'bus', unitId: 0, functionCode: 6, address: 1, value: 10, confirmation: { confirmed: true } }),
    (error) => error.code === 'BROADCAST_CONFIRMATION_REQUIRED',
  );
  assert.equal(broadcast.acquisitions(), 0);
});

test('v8 write preflight accepts explicit normal, bulk and broadcast confirmations', () => {
  assert.equal(preflightWriteConfirmation({ unitId: 1, functionCode: 6, confirmation: { confirmed: true } }), true);
  assert.equal(preflightWriteConfirmation({ unitId: 1, functionCode: 16, confirmation: { confirmed: true, bulk: true } }), true);
  assert.equal(preflightWriteConfirmation({ unitId: 0, functionCode: 6, confirmation: { confirmed: true, broadcast: true } }), true);
});
