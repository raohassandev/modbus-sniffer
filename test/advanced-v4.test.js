'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');
const { AdvancedRuntimeState } = require('../src/advancedRuntimeState');
const { analyzeWords } = require('../src/dataTypeAnalyzer');

function req(slaveId, startAddress, quantity, timestamp) {
  return { slaveId, functionCode: 3, functionName: 'Read Holding Registers', kind: 'request', startAddress, quantity, timestamp };
}

function recordRead(state, slaveId, startAddress, values, requestAt, responseAt) {
  const request = req(slaveId, startAddress, values.length, requestAt);
  state.recordFrame({ direction: 'REQ', decoded: request, request, rttMs: null }, requestAt, Buffer.from([slaveId,3,0,0,0,values.length,0,0]));
  const decoded = {
    slaveId, functionCode: 3, functionName: 'Read Holding Registers', kind: 'response',
    words: values, registers: values.map((value, i) => ({ address: startAddress + i, value }))
  };
  state.recordFrame({ direction: 'RSP', decoded, request, rttMs: responseAt - requestAt }, responseAt, Buffer.from([slaveId,3,values.length*2,...values.flatMap(v=>[(v>>8)&255,v&255]),0,0]));
}

test('tracker emits an explicit missing-response timeout', () => {
  const seen = [];
  const tracker = new AdvancedTransactionTracker({ requestTimeoutMs: 100, onTimeout: (r, now, ms) => seen.push({ r, now, ms }) });
  tracker.process(req(7, 44112, 2, 1000), 1000);
  assert.equal(tracker.pending.length, 1);
  tracker.expire(1101);
  assert.equal(tracker.pending.length, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].r.slaveId, 7);
  assert.equal(seen[0].r.startAddress, 44112);
  assert.equal(seen[0].ms, 100);
});

test('multiple Slave IDs automatically become separate devices with grouped registers and polling intervals', () => {
  const state = new AdvancedRuntimeState({ historyLimit: 1000 });
  recordRead(state, 1, 100, [10,20], 1000, 1040);
  recordRead(state, 2, 500, [30,40,50], 1200, 1250);
  recordRead(state, 1, 100, [11,21], 2000, 2045);
  recordRead(state, 2, 500, [31,41,51], 2200, 2255);

  const devices = state.getDevices();
  assert.equal(devices.length, 2);
  assert.deepEqual(devices.map(d => d.slaveId), [1,2]);
  assert.equal(devices[0].registerCount, 2);
  assert.equal(devices[1].registerCount, 3);
  assert.equal(devices[0].pollGroupCount, 1);
  assert.equal(devices[1].pollGroupCount, 1);
  assert.equal(devices[0].expectedPollIntervalMs, 1000);
  assert.equal(devices[1].expectedPollIntervalMs, 1000);

  const d1 = state.getDevice(1);
  assert.equal(d1.polls[0].startAddress, 100);
  assert.equal(d1.polls[0].quantity, 2);
  assert.equal(d1.polls[0].medianIntervalMs, 1000);
  assert.deepEqual(d1.registers.map(r => r.address), [100,101]);
  assert.deepEqual(d1.registers.map(r => r.lastValue), [11,21]);

  const d2 = state.getDevice(2);
  assert.deepEqual(d2.registers.map(r => r.address), [500,501,502]);
  assert.deepEqual(d2.registers.map(r => r.lastValue), [31,41,51]);
});

test('same register addresses on different slave IDs never mix values', () => {
  const state = new AdvancedRuntimeState();
  recordRead(state, 1, 44112, [111, 112], 1000, 1020);
  recordRead(state, 2, 44112, [211, 212], 1100, 1125);
  recordRead(state, 10, 44112, [1011, 1012], 1200, 1230);

  assert.deepEqual(state.getRegisters({ slave: 1 }).map(r => r.lastValue), [111, 112]);
  assert.deepEqual(state.getRegisters({ slave: 2 }).map(r => r.lastValue), [211, 212]);
  assert.deepEqual(state.getRegisters({ slave: 10 }).map(r => r.lastValue), [1011, 1012]);
  assert.equal(state.getDevices().length, 3);
  assert.equal(state.getPollGroups().length, 3);
});

test('timeouts are assigned to the correct slave and polling group', () => {
  const state = new AdvancedRuntimeState();
  const request = req(10, 3000, 4, 1000);
  state.recordFrame({ direction:'REQ', decoded:request, request, rttMs:null }, 1000, Buffer.alloc(8));
  state.recordTimeout(request, 1500, 500);
  const device = state.getDevice(10);
  assert.equal(device.summary.timeouts, 1);
  assert.equal(device.polls.length, 1);
  assert.equal(device.polls[0].timeouts, 1);
  assert.equal(state.getStatus().totals.timeouts, 1);
  const timeouts = state.getTransactions({ direction:'TIMEOUT' });
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].slaveId, 10);
});

test('datatype analyzer exposes common 32-bit byte orders', () => {
  const result = analyzeWords([0x3F80, 0x0000]);
  const float = result.interpretations.find(x => x.type === 'float32' && x.order === 'ABCD');
  assert.ok(float);
  assert.equal(float.value, 1);
  const uint = result.interpretations.find(x => x.type === 'uint32' && x.order === 'ABCD');
  assert.equal(uint.value, 0x3F800000);
});

test('capture export/import rebuilds devices and registers', () => {
  const a = new AdvancedRuntimeState();
  recordRead(a, 3, 900, [123,456], 1000, 1020);
  const capture = a.exportCapture();
  const b = new AdvancedRuntimeState();
  b.loadCapture(capture);
  assert.equal(b.getDevices().length, 1);
  assert.equal(b.getDevices()[0].slaveId, 3);
  assert.deepEqual(b.getRegisters({ slave:3 }).map(r => r.lastValue), [123,456]);
});
