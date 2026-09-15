'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

test('v8 PollScheduler rejects every active-write function even when Master writes are armed', () => {
  const master = {
    framing: 'rtu',
    connectionId: 'poll-safety',
    request: async () => ({ ok: true, rttMs: 1 }),
  };
  const scheduler = new v8.PollScheduler({ master });
  const writes = [
    v8.protocol.encodeWriteSingleCoilRequest({ address: 0, value: true }),
    v8.protocol.encodeWriteSingleRegisterRequest({ address: 0, value: 1 }),
    v8.protocol.encodeWriteMultipleCoilsRequest({ address: 0, values: [true, false] }),
    v8.protocol.encodeWriteMultipleRegistersRequest({ address: 0, values: [1, 2] }),
    v8.protocol.encodeMaskWriteRegisterRequest({ address: 0, andMask: 0xFF00, orMask: 0x0055 }),
    v8.protocol.encodeReadWriteMultipleRegistersRequest({ readAddress: 0, readQuantity: 1, writeAddress: 0, values: [1] }),
  ];

  for (const [index, pdu] of writes.entries()) {
    assert.throws(
      () => scheduler.addJob({ jobId: `write-${index}`, unitId: 1, pdu }),
      (error) => error.code === 'UNSAFE_POLL_FUNCTION',
    );
  }
  assert.equal(scheduler.snapshot().jobCount, 0);
});

test('v8 PollScheduler rejects Unit 0 and >247 for serial polling but accepts byte-wide TCP Unit IDs', () => {
  const readPdu = v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 });
  const serialMaster = { framing: 'rtu', connectionId: 'serial', request: async () => ({ ok: true, rttMs: 1 }) };
  const serialScheduler = new v8.PollScheduler({ master: serialMaster });
  assert.throws(
    () => serialScheduler.addJob({ jobId: 'broadcast-read', unitId: 0, pdu: readPdu }),
    (error) => error.code === 'INVALID_SERIAL_POLL_UNIT',
  );
  assert.throws(
    () => serialScheduler.addJob({ jobId: 'invalid-serial', unitId: 248, pdu: readPdu }),
    (error) => error.code === 'INVALID_SERIAL_POLL_UNIT',
  );

  const tcpMaster = { framing: 'tcp', connectionId: 'tcp', request: async () => ({ ok: true, rttMs: 1 }) };
  const tcpScheduler = new v8.PollScheduler({ master: tcpMaster });
  assert.equal(tcpScheduler.addJob({ jobId: 'gateway-unit', unitId: 255, pdu: readPdu }).unitId, 255);
});

test('v8 virtual device model allows TCP Unit 255 while RTU/ASCII servers reject it', () => {
  const device = new v8.VirtualDevice({ unitId: 255, sizes: { coils: 1, discreteInputs: 1, holdingRegisters: 1, inputRegisters: 1 } });
  assert.equal(device.unitId, 255);

  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'dummy', resourceKey: 'virtual:dummy', transportKind: 'virtual' });
  const tcpServer = new v8.VirtualSlaveServer({ broker, connectionId: 'dummy', framing: 'tcp' });
  assert.equal(tcpServer.addDevice(device).unitId, 255);

  const rtuServer = new v8.VirtualSlaveServer({ broker, connectionId: 'dummy', framing: 'rtu' });
  assert.throws(
    () => rtuServer.addDevice(device),
    (error) => error.code === 'INVALID_SERIAL_UNIT_ID',
  );
});
