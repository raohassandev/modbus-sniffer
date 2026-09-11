'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeState } = require('../src/runtimeState');

function raw(...bytes) { return Buffer.from(bytes); }

test('runtime state tracks frames, RTT and discovered registers', () => {
  const state = new RuntimeState({ historyLimit: 100 });
  const now = Date.now();
  const tx = {
    direction: 'RSP', rttMs: 25,
    request: { slaveId: 1, functionCode: 3, startAddress: 100, quantity: 2 },
    decoded: {
      slaveId: 1, functionCode: 3, functionName: 'Read Holding Registers', exception: false,
      registers: [{ address: 100, value: 123 }, { address: 101, value: 456 }]
    }
  };
  state.recordFrame(tx, now, raw(1, 3, 4, 0, 123, 1, 200, 0, 0));
  const status = state.getStatus();
  assert.equal(status.totals.frames, 1);
  assert.equal(status.totals.slaves, 1);
  assert.equal(status.totals.registers, 2);
  assert.equal(status.totals.avgRttMs, 25);
  assert.equal(state.getRegisters({})[0].reads, 1);
});

test('analysis counts exceptions and unmatched responses', () => {
  const state = new RuntimeState();
  state.recordFrame({
    direction: 'RSP', request: null, rttMs: null,
    decoded: { slaveId: 4, functionCode: 3, functionName: 'Read Holding Registers', exception: true, exceptionCode: 2, exceptionName: 'Illegal Data Address' }
  }, Date.now(), raw(4, 0x83, 2, 0, 0));
  const analysis = state.getAnalysis();
  assert.equal(analysis.slaves[0].exceptions, 1);
  assert.equal(analysis.rates.exceptionRate, 100);
  assert.equal(analysis.rates.unmatchedResponseRate, 100);
  assert.ok(analysis.healthScore < 100);
});

test('clearCapture resets analysis but preserves connection/config', () => {
  const state = new RuntimeState();
  state.setConfig({ port: 'COM9', baudRate: 9600 });
  state.setConnection('open', { path: 'COM9' });
  state.recordNoise(10);
  state.clearCapture();
  assert.equal(state.getStatus().totals.frames, 0);
  assert.equal(state.getStatus().totals.noiseBytes, 0);
  assert.equal(state.getStatus().connection.status, 'open');
  assert.equal(state.getStatus().config.port, 'COM9');
});
