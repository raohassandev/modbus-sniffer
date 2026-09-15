'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const v8 = require('../src/v8');

class ControlledSerialPort extends EventEmitter {
  constructor({ writeDelayMs = 0, drainDelayMs = 0, hangDrain = false } = {}) {
    super();
    this.isOpen = false;
    this.writeDelayMs = writeDelayMs;
    this.drainDelayMs = drainDelayMs;
    this.hangDrain = hangDrain;
    this.writes = [];
    this.activeWrites = 0;
    this.maxActiveWrites = 0;
    this.signalHistory = [];
  }

  open(callback) {
    queueMicrotask(() => {
      this.isOpen = true;
      this.emit('open');
      callback?.(null);
    });
  }

  close(callback) {
    queueMicrotask(() => {
      this.isOpen = false;
      this.activeWrites = 0;
      this.emit('close');
      callback?.(null);
    });
  }

  write(bytes, callback) {
    const payload = Buffer.from(bytes);
    this.writes.push(payload.toString('hex').toUpperCase());
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
    setTimeout(() => callback?.(null), this.writeDelayMs);
    return true;
  }

  drain(callback) {
    if (this.hangDrain) return;
    setTimeout(() => {
      this.activeWrites = Math.max(0, this.activeWrites - 1);
      callback?.(null);
    }, this.drainDelayMs);
  }

  set(signals, callback) {
    this.signalHistory.push({ ...signals });
    queueMicrotask(() => callback?.(null));
  }
}

test('v8 public SerialTransport serializes concurrent low-level sends', async (t) => {
  const port = new ControlledSerialPort({ writeDelayMs: 3, drainDelayMs: 5 });
  const transport = new v8.SerialTransport({
    path: 'SERIALIZED-TX',
    baudRate: 115200,
    framing: 'rtu',
    writeTimeoutMs: 100,
    portFactory: () => port,
  });
  await transport.open();
  t.after(() => transport.close());

  await Promise.all([
    transport.send(Buffer.from('010600010001', 'hex')),
    transport.send(Buffer.from('010600020002', 'hex')),
    transport.send(Buffer.from('010600030003', 'hex')),
  ]);

  assert.deepEqual(port.writes, [
    '010600010001',
    '010600020002',
    '010600030003',
  ]);
  assert.equal(port.maxActiveWrites, 1);
  assert.deepEqual(transport.status().transmitQueue, { pending: 0, active: false });
  assert.equal(transport.status().txOutcomeUnknown, false);
});

test('v8 uncertain serial write outcome is audited, relocked and cannot be retried on the same live session', async (t) => {
  const port = new ControlledSerialPort({ hangDrain: true });
  const transport = new v8.SerialTransport({
    path: 'AMBIGUOUS-TX',
    baudRate: 115200,
    framing: 'rtu',
    writeTimeoutMs: 12,
    portFactory: () => port,
  });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({
    connectionId: 'ambiguous-master',
    resourceKey: 'serial:AMBIGUOUS-TX',
    transportKind: 'serial-rtu',
    transport,
  });
  const master = new v8.MasterEngine({
    broker,
    connectionId: 'ambiguous-master',
    ownerId: 'ambiguous-owner',
    framing: 'rtu',
    timeoutMs: 50,
  });
  await master.open();
  t.after(async () => {
    const status = broker.getConnection('ambiguous-master');
    if (status.state === 'open' || status.state === 'error') await master.close();
  });

  const writeAudit = new v8.WriteAuditTrail();
  const safety = new v8.WriteSafetyController({ master, auditTrail: writeAudit });
  safety.unlock({ confirmation: { confirmed: true } });
  const writePdu = v8.protocol.encodeWriteSingleRegisterRequest({ address: 7, value: 3210 });

  let failure;
  try {
    await safety.execute({
      unitId: 1,
      pdu: writePdu,
      confirmation: { confirmed: true },
      captureOldValue: false,
    });
    assert.fail('expected uncertain transmission failure');
  } catch (error) {
    failure = error;
  }

  assert.equal(failure.code, 'TRANSMISSION_OUTCOME_UNKNOWN');
  assert.equal(failure.details.mayHaveTransmitted, true);
  assert.equal(failure.details.transmissionOutcome, 'unknown');
  assert.ok(Buffer.isBuffer(failure.details.requestRaw));
  assert.equal(broker.getConnection('ambiguous-master').writeLock, 'LOCKED');
  assert.equal(transport.status().txOutcomeUnknown, true);
  assert.equal(transport.status().stats.ambiguousTransmissions, 1);

  const lowLevel = broker.getTransmissionAudit();
  assert.equal(lowLevel.length, 1);
  assert.equal(lowLevel[0].intent, 'write');
  assert.equal(lowLevel[0].outcome, 'unknown');
  assert.equal(lowLevel[0].errorCode, 'TRANSMISSION_OUTCOME_UNKNOWN');
  assert.equal(lowLevel[0].rawHex, failure.details.requestRaw.toString('hex').toUpperCase());

  const enriched = writeAudit.list();
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].result, 'failed');
  assert.equal(enriched[0].error.code, 'TRANSMISSION_OUTCOME_UNKNOWN');
  assert.equal(enriched[0].requestRawHex, lowLevel[0].rawHex);

  await assert.rejects(
    () => master.request({ unitId: 1, pdu: writePdu }),
    (error) => error.code === 'CONNECTION_NOT_OPEN',
  );
  assert.equal(port.writes.length, 1);

  await master.close();
  await master.open();
  assert.equal(broker.getConnection('ambiguous-master').writeLock, 'LOCKED');
  await assert.rejects(
    () => master.request({ unitId: 1, pdu: writePdu }),
    (error) => error.code === 'WRITE_LOCKED',
  );
  assert.equal(port.writes.length, 1);
});
