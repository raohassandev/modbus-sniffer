'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');
const { TestCenterWorkspaceService } = require('../src/v8/testCenter/testCenterWorkspaceServiceHardened');

function makeService() {
  const connectionCenter = {
    activeProjectId: () => 'project-default',
    listProfiles: () => [{ connectionId: 'bus', transportKind: 'serial-rtu' }],
  };
  const service = new TestCenterWorkspaceService({ store: {}, broker: {}, connectionCenter });
  let acquisitions = 0;
  service._ensureSession = async () => {
    acquisitions += 1;
    throw Object.assign(new Error('session-probe'), { code: 'SESSION_PROBE' });
  };
  return { service, acquisitions: () => acquisitions };
}

function rtuWriteHex() {
  return v8.protocol.encodeRtuAdu(1, v8.protocol.encodeWriteSingleRegisterRequest({ address: 10, value: 123 })).toString('hex');
}

function rtuReadHex() {
  return v8.protocol.encodeRtuAdu(1, v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 })).toString('hex');
}

test('v8 Test Center rejects unconfirmed raw write before opening a session', async () => {
  const probe = makeService();
  await assert.rejects(
    () => probe.service.sendRaw({ connectionId: 'bus', hex: rtuWriteHex() }),
    (error) => error.code === 'WRITE_CONFIRMATION_REQUIRED',
  );
  assert.equal(probe.acquisitions(), 0);
});

test('v8 Test Center rejects unarmed malformed/raw frame before opening a session', async () => {
  const probe = makeService();
  await assert.rejects(
    () => probe.service.sendRaw({ connectionId: 'bus', hex: '0103', confirmation: { raw: true } }),
    (error) => error.code === 'LAB_NOT_ARMED',
  );
  assert.equal(probe.acquisitions(), 0);
});

test('v8 Test Center validates repeat, LAB arm and write arm safety before session acquisition', async () => {
  const repeat = makeService();
  await assert.rejects(
    () => repeat.service.repeatRaw({ connectionId: 'bus', hex: rtuReadHex(), count: 10001 }),
    (error) => error.code === 'INVALID_REPEAT_COUNT',
  );
  assert.equal(repeat.acquisitions(), 0);

  const lab = makeService();
  await assert.rejects(
    () => lab.service.armLab('bus', { confirmation: { confirmed: true, raw: false } }),
    (error) => error.code === 'LAB_CONFIRMATION_REQUIRED',
  );
  assert.equal(lab.acquisitions(), 0);

  const writes = makeService();
  await assert.rejects(
    () => writes.service.armWrites('bus', { confirmation: { confirmed: false } }),
    (error) => error.code === 'CONFIRMATION_REQUIRED',
  );
  assert.equal(writes.acquisitions(), 0);
});

test('v8 Test Center safe validated read may acquire a session', async () => {
  const probe = makeService();
  await assert.rejects(
    () => probe.service.sendRaw({ connectionId: 'bus', hex: rtuReadHex() }),
    (error) => error.code === 'SESSION_PROBE',
  );
  assert.equal(probe.acquisitions(), 1);
});
