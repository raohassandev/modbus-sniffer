'use strict';

const assert = require('node:assert/strict');
const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame } = require('../src/modbus/decoder');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');
const { AdvancedRuntimeState } = require('../src/advancedRuntimeState');
const { analyzeWords } = require('../src/dataTypeAnalyzer');

function reqRead(slave, fc, address, qty) {
  return appendCrc(Buffer.from([slave, fc, address >> 8, address & 0xff, qty >> 8, qty & 0xff]));
}
function rspRead(slave, fc, words) {
  const data = [];
  for (const w of words) data.push((w >> 8) & 0xff, w & 0xff);
  return appendCrc(Buffer.from([slave, fc, data.length, ...data]));
}
function rspBits(slave, fc, bytes) {
  return appendCrc(Buffer.from([slave, fc, bytes.length, ...bytes]));
}
function exception(slave, fc, code) {
  return appendCrc(Buffer.from([slave, fc | 0x80, code]));
}
function writeSingle(slave, address, value) {
  return appendCrc(Buffer.from([slave, 6, address >> 8, address & 0xff, value >> 8, value & 0xff]));
}

function main() {
  const started = Date.now();
  const state = new AdvancedRuntimeState({ historyLimit: 20000 });
  const tracker = new AdvancedTransactionTracker({
    requestTimeoutMs: 500,
    onTimeout: (request, now, timeoutMs) => state.recordTimeout(request, now, timeoutMs)
  });

  const feed = (raw, ts) => {
    const tx = tracker.process(decodeFrame(raw), ts);
    state.recordFrame(tx, ts, raw, []);
    return tx;
  };

  // 10 devices, all intentionally using the same register addresses.
  // This proves Slave ID is part of register/device ownership.
  for (let cycle = 0; cycle < 20; cycle++) {
    for (let slave = 1; slave <= 10; slave++) {
      const t = 100000 + cycle * 1000 + slave * 10;
      feed(reqRead(slave, 3, 100, 4), t);
      const base = slave * 1000 + cycle;
      feed(rspRead(slave, 3, [base, base + 1, base + 2, base + 3]), t + 20 + slave);
    }
  }

  // Explicit missing reply.
  feed(reqRead(7, 3, 200, 2), 130000);
  tracker.expire(130501);

  // Exception response.
  feed(reqRead(4, 3, 300, 2), 131000);
  feed(exception(4, 3, 2), 131040);

  // Write request + echo response.
  const write = writeSingle(2, 500, 77);
  feed(write, 132000);
  feed(write, 132025);

  // FC01 response with 3 data bytes is exactly 8 bytes and must still be a response.
  feed(reqRead(5, 1, 1000, 24), 133000);
  const fc1 = feed(rspBits(5, 1, [0x55, 0xaa, 0x0f]), 133030);
  assert.equal(fc1.direction, 'RSP');
  assert.equal(fc1.decoded.points.length, 24);

  const devices = state.getDevices();
  assert.equal(devices.length, 10, '10 Slave IDs must become 10 automatic devices');
  for (let slave = 1; slave <= 10; slave++) {
    const d = state.getDevice(slave);
    assert.ok(d, `Slave ${slave} device missing`);
    assert.ok(d.registers.length >= 4, `Slave ${slave} registers not formed`);
    const r100 = d.registers.find(r => r.address === 100);
    assert.ok(r100, `Slave ${slave} register 100 missing`);
    assert.equal(r100.lastValue, slave * 1000 + 19, `Slave ${slave} value mixed with another device`);
    const poll = d.polls.find(p => p.functionCode === 3 && p.startAddress === 100 && p.quantity === 4);
    assert.ok(poll, `Slave ${slave} polling group missing`);
    assert.equal(poll.medianIntervalMs, 1000, `Slave ${slave} poll interval not learned`);
  }

  assert.equal(state.getDevice(7).summary.timeouts, 1, 'Timeout not assigned to Slave 7');
  assert.equal(state.getStatus().totals.timeouts, 1, 'Bus timeout counter incorrect');
  assert.ok(state.getDevice(4).summary.exceptions >= 1, 'Exception not assigned to Slave 4');
  assert.ok(state.getDevice(2).registers.some(r => r.address === 500 && r.lastValue === 77), 'FC06 write not learned');

  const capture = state.exportCapture();
  const restored = new AdvancedRuntimeState({ historyLimit: 20000 });
  restored.loadCapture(capture);
  assert.equal(restored.getDevices().length, 10, 'Capture import did not rebuild devices');
  assert.equal(restored.getDevice(10).registers.find(r => r.address === 100).lastValue, 10019, 'Capture replay/import lost values');

  const decoded = analyzeWords([0x3f80, 0x0000]);
  assert.equal(decoded.interpretations.find(x => x.type === 'float32' && x.order === 'ABCD').value, 1, 'Float32 decoder failed');

  const status = state.getStatus();
  const elapsed = Date.now() - started;
  console.log('\n=== Modbus Sniffer v4 Software Acceptance ===');
  console.log(`PASS  Automatic devices          : ${devices.length}/10`);
  console.log(`PASS  Slave register isolation   : identical addresses kept separate`);
  console.log(`PASS  Poll interval learning     : 1000 ms median`);
  console.log(`PASS  Missing-response detection : ${status.totals.timeouts} timeout`);
  console.log(`PASS  Exception handling         : detected`);
  console.log(`PASS  Write tracking             : FC06 value 77`);
  console.log(`PASS  FC01 8-byte response       : request-context disambiguation`);
  console.log(`PASS  Capture export/import      : device model rebuilt`);
  console.log(`PASS  Data-type decoder          : Float32 ABCD = 1`);
  console.log(`PASS  Frames processed           : ${status.totals.frames}`);
  console.log(`\nSOFTWARE ACCEPTANCE: PASS (${elapsed} ms)\n`);
}

try { main(); }
catch (err) {
  console.error('\nSOFTWARE ACCEPTANCE: FAIL');
  console.error(err.stack || err.message);
  process.exitCode = 1;
}
