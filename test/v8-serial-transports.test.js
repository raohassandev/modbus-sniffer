'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const v8 = require('../src/v8');

class FakeSerialPort extends EventEmitter {
  constructor({ path, echo = false }) {
    super();
    this.path = path;
    this.echo = echo;
    this.peer = null;
    this.isOpen = false;
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
      this.emit('close');
      callback?.(null);
    });
  }

  write(bytes, callback) {
    const payload = Buffer.from(bytes);
    queueMicrotask(() => {
      if (!this.isOpen) return callback?.(Object.assign(new Error('not open'), { code: 'NOT_OPEN' }));
      if (this.echo) this.emit('data', Buffer.from(payload));
      if (this.peer?.isOpen) this.peer.emit('data', Buffer.from(payload));
      callback?.(null);
    });
    return true;
  }

  drain(callback) { queueMicrotask(() => callback?.(null)); }

  set(signals, callback) {
    this.signalHistory.push({ ...signals });
    queueMicrotask(() => callback?.(null));
  }
}

function createFakeSerialPair({ echoMaster = false } = {}) {
  const masterPort = new FakeSerialPort({ path: 'FAKE-MASTER', echo: echoMaster });
  const slavePort = new FakeSerialPort({ path: 'FAKE-SLAVE' });
  masterPort.peer = slavePort;
  slavePort.peer = masterPort;
  return { masterPort, slavePort };
}

async function createSerialRig({ framing = 'rtu', echoMaster = false, rtsTxMode = 'none' } = {}) {
  const ports = createFakeSerialPair({ echoMaster });
  const masterTransport = new v8.SerialTransport({
    path: ports.masterPort.path,
    baudRate: 115200,
    framing,
    echoSuppression: echoMaster,
    rtsTxMode,
    portFactory: () => ports.masterPort,
  });
  const slaveTransport = new v8.SerialTransport({
    path: ports.slavePort.path,
    baudRate: 115200,
    framing,
    portFactory: () => ports.slavePort,
  });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'serial-master', resourceKey: 'serial:FAKE-MASTER', transportKind: `serial-${framing}`, transport: masterTransport });
  broker.defineConnection({ connectionId: 'serial-slave', resourceKey: 'serial:FAKE-SLAVE', transportKind: `serial-${framing}`, transport: slaveTransport });

  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'serial-slave', ownerId: 'serial-slave-owner', framing, receivePollMs: 5 });
  const device = slave.addDevice({ unitId: 1, sizes: { coils: 64, discreteInputs: 64, holdingRegisters: 64, inputRegisters: 64 } });
  device.seed('holdingRegisters', 0, [10, 20, 30, 40, 50, 60]);
  const master = new v8.MasterEngine({ broker, connectionId: 'serial-master', ownerId: 'serial-master-owner', framing, timeoutMs: 300 });
  await slave.start();
  await master.open();

  return {
    ports,
    broker,
    masterTransport,
    slaveTransport,
    slave,
    device,
    master,
    async close() {
      await master.close();
      await slave.stop({ closeConnection: true });
    },
  };
}

test('v8 RTU frame gap follows Modbus low/high baud timing rules', () => {
  const slow = v8.calculateRtuFrameGapMs({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });
  assert.ok(slow > 3.5 && slow < 4.5);
  assert.equal(v8.calculateRtuFrameGapMs({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' }), 1.75);
});

test('v8 RTU idle framer joins fragmented chunks and emits after inter-frame silence', async () => {
  const framer = new v8.RtuIdleFramer({ baudRate: 115200 });
  const framePromise = new Promise((resolve) => framer.once('frame', resolve));
  framer.push(Buffer.from('010300', 'hex'));
  framer.push(Buffer.from('000001840A', 'hex'));
  assert.equal((await framePromise).toString('hex').toUpperCase(), '010300000001840A');
});

test('v8 ASCII framer resynchronizes on colon and handles fragmented CRLF', async () => {
  const framer = new v8.AsciiLineFramer();
  const received = [];
  framer.on('frame', (frame) => received.push(frame.toString('ascii')));
  framer.push(Buffer.from('noise:0103'));
  framer.push(Buffer.from('00000001FB\r'));
  framer.push(Buffer.from('\n:020300000001FA\r\n'));
  assert.deepEqual(received, [':010300000001FB\r\n', ':020300000001FA\r\n']);
});

test('v8 real serial transport contract drives RTU Master and Slave through injected serial driver', async (t) => {
  const rig = await createSerialRig({ framing: 'rtu' });
  t.after(() => rig.close());
  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 3 }) });
  assert.deepEqual(result.decoded.values, [20, 30, 40]);
  assert.equal(rig.masterTransport.status().capabilities.transport, 'serial-rtu');
  assert.ok(rig.masterTransport.status().frameGapMs >= 1.75);
});

test('v8 ASCII Master and Slave run through the same serial transport abstraction', async (t) => {
  const rig = await createSerialRig({ framing: 'ascii' });
  t.after(() => rig.close());
  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 2, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [30, 40]);
  assert.equal(result.requestRaw.toString('ascii').startsWith(':'), true);
});

test('v8 serial echo suppression prevents local adapter echo from becoming a false response', async (t) => {
  const rig = await createSerialRig({ framing: 'rtu', echoMaster: true });
  t.after(() => rig.close());
  const result = await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 2 }) });
  assert.deepEqual(result.decoded.values, [10, 20]);
  assert.equal(rig.masterTransport.status().echo.enabled, true);
});

test('v8 serial RTS transmit mode asserts and releases direction around a drained frame', async (t) => {
  const rig = await createSerialRig({ framing: 'rtu', rtsTxMode: 'high-during-tx' });
  t.after(() => rig.close());
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 }) });
  assert.deepEqual(rig.ports.masterPort.signalHistory.slice(0, 2), [{ rts: true }, { rts: false }]);
});

test('v8 serial writes remain locked until explicitly armed', async (t) => {
  const rig = await createSerialRig({ framing: 'rtu' });
  t.after(() => rig.close());
  await assert.rejects(
    () => rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 0, value: 999 }) }),
    (error) => error.code === 'WRITE_LOCKED',
  );
  rig.master.setWriteEnabled(true);
  await rig.master.request({ unitId: 1, pdu: v8.protocol.encodeWriteSingleRegisterRequest({ address: 0, value: 999 }) });
  assert.deepEqual(rig.device.read('holdingRegisters', 0, 1), [999]);
});

test('v8 serial port enumeration normalizes platform-specific driver metadata', async () => {
  class FakeListDriver {
    static async list() {
      return [{ path: 'COM9', manufacturer: 'Automatrix', vendorId: '1234', productId: 'ABCD' }];
    }
  }
  const ports = await v8.listSerialPorts({ SerialPortClass: FakeListDriver });
  assert.equal(ports[0].path, 'COM9');
  assert.equal(ports[0].manufacturer, 'Automatrix');
  assert.equal(ports[0].vendorId, '1234');
});
