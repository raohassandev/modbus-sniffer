'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

async function createRig() {
  const pair = v8.createVirtualLoopbackPair({ names: ['ext-master', 'ext-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'master', resourceKey: 'virtual:ext-master', transportKind: 'virtual-rtu', transport: pair.a });
  broker.defineConnection({ connectionId: 'slave', resourceKey: 'virtual:ext-slave', transportKind: 'virtual-rtu', transport: pair.b });
  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'slave', ownerId: 'ext-slave-owner', framing: 'rtu', receivePollMs: 5 });
  const device = slave.addDevice({
    unitId: 1,
    exceptionStatus: 0x5A,
    diagnosticRegister: 0x1234,
    identity: { productCode: 'V8EXT', revision: '8.1' },
    sizes: { coils: 32, discreteInputs: 32, holdingRegisters: 64, inputRegisters: 64 },
  });
  device.seedFileRecord(4, 10, [0x1111, 0x2222, 0x3333]);
  device.setFifoQueue(20, [7, 8, 9]);
  const master = new v8.MasterEngine({ broker, connectionId: 'master', ownerId: 'ext-master-owner', framing: 'rtu', timeoutMs: 250 });
  await slave.start();
  await master.open();
  return {
    broker,
    slave,
    device,
    master,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 Master/Slave runtime handles FC07/08/11/12/17', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  const status = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadExceptionStatusRequest() });
  assert.equal(status.decoded.status, 0x5A);

  const diagnostics = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeDiagnostics({ subFunction: v8.protocol.DIAGNOSTIC_SUBFUNCTION.RETURN_DIAGNOSTIC_REGISTER, data: 0 }),
  });
  assert.equal(diagnostics.decoded.dataUInt16, 0x1234);

  const counter = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeGetCommEventCounterRequest() });
  assert.ok(counter.decoded.eventCount >= 3);

  const log = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeGetCommEventLogRequest() });
  assert.ok(log.decoded.eventCount >= counter.decoded.eventCount);

  const serverId = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReportServerIdRequest() });
  assert.equal(serverId.decoded.runIndicator, 'V8EXT'.charCodeAt(1));
  assert.ok(serverId.responsePdu.length > 3);
});

test('v8 Master/Slave runtime handles FC20 and FC24', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());

  const file = await rig.master.request({
    unitId: 1,
    pdu: v8.protocol.encodeReadFileRecordRequest({ records: [{ fileNumber: 4, recordNumber: 10, recordLength: 3 }] }),
  });
  assert.deepEqual(file.decoded.records[0].values, [0x1111, 0x2222, 0x3333]);

  const fifo = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadFifoQueueRequest({ address: 20 }) });
  assert.deepEqual(fifo.decoded.values, [7, 8, 9]);
});

test('v8 FC21 is classified as a write, requires write lock and safe file confirmation', async (t) => {
  const rig = await createRig();
  t.after(() => rig.close());
  const pdu = v8.protocol.encodeWriteFileRecord({ records: [{ fileNumber: 4, recordNumber: 11, values: [0xAAAA, 0xBBBB] }] });

  await assert.rejects(() => rig.master.request({ unitId: 1, pdu }), (error) => error.code === 'WRITE_LOCKED');

  const audit = new v8.WriteAuditTrail();
  const safety = new v8.WriteSafetyController({ master: rig.master, auditTrail: audit });
  safety.unlock({ confirmation: { confirmed: true } });
  await assert.rejects(
    () => safety.execute({ unitId: 1, pdu, confirmation: { confirmed: true, bulk: true } }),
    (error) => error.code === 'FILE_RECORD_CONFIRMATION_REQUIRED',
  );

  const result = await safety.execute({
    unitId: 1,
    pdu,
    confirmation: { confirmed: true, bulk: true, fileRecord: true },
    captureOldValue: false,
  });
  assert.equal(result.decoded.records[0].fileNumber, 4);
  assert.deepEqual(rig.device.readFileRecord(4, 11, 2), [0xAAAA, 0xBBBB]);
  const record = audit.list().at(-1);
  assert.equal(record.result, 'success');
  assert.equal(record.fileRecords[0].recordNumber, 11);
  assert.deepEqual(record.fileRecords[0].values, [0xAAAA, 0xBBBB]);

  await assert.rejects(
    () => safety.execute({
      unitId: 1,
      pdu,
      confirmation: { confirmed: true, bulk: true, fileRecord: true },
      readBack: true,
    }),
    (error) => error.code === 'READBACK_UNSUPPORTED',
  );
});
