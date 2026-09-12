'use strict';

const { appendCrc } = require('../src/modbus/crc16');
const { decodeFrame } = require('../src/modbus/decoder');
const { AdvancedTransactionTracker } = require('../src/modbus/advancedTransactionTracker');
const { AdvancedRuntimeState } = require('../src/advancedRuntimeState');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? Number(process.argv[i + 1]) : fallback;
}
function reqRead(slave, address, qty) {
  return appendCrc(Buffer.from([slave, 3, address >> 8, address & 0xff, qty >> 8, qty & 0xff]));
}
function rspRead(slave, words) {
  const data = [];
  for (const w of words) data.push((w >> 8) & 0xff, w & 0xff);
  return appendCrc(Buffer.from([slave, 3, data.length, ...data]));
}

const cycles = Math.max(100, Math.min(1000000, arg('--cycles', 25000)));
const devices = Math.max(1, Math.min(247, arg('--devices', 20)));
const historyLimit = Math.max(100, Math.min(100000, arg('--history', 10000)));
const state = new AdvancedRuntimeState({ historyLimit });
const tracker = new AdvancedTransactionTracker({ requestTimeoutMs: 1000, onTimeout: (r, n, m) => state.recordTimeout(r, n, m) });

const started = process.hrtime.bigint();
for (let i = 0; i < cycles; i++) {
  const slave = 1 + (i % devices);
  const group = i % 4;
  const address = 100 + group * 16;
  const t = 1000000 + i * 20;
  const req = reqRead(slave, address, 4);
  const reqTx = tracker.process(decodeFrame(req), t);
  state.recordFrame(reqTx, t, req, []);
  const base = (slave * 100 + i) & 0xffff;
  const rsp = rspRead(slave, [base, base + 1, base + 2, base + 3].map(x => x & 0xffff));
  const rspTx = tracker.process(decodeFrame(rsp), t + 7 + (slave % 5));
  state.recordFrame(rspTx, t + 7 + (slave % 5), rsp, []);
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const s = state.getStatus();
const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
const fps = s.totals.frames / (elapsedMs / 1000);

if (s.totals.devices !== devices) throw new Error(`Expected ${devices} devices, got ${s.totals.devices}`);
if (state.transactions.length > historyLimit) throw new Error(`History limit exceeded: ${state.transactions.length}/${historyLimit}`);
if (s.totals.frames !== cycles * 2) throw new Error(`Frame count mismatch: ${s.totals.frames}/${cycles * 2}`);

console.log('\n=== Modbus Sniffer v4 Soak Test ===');
console.log(`PASS  request/response cycles : ${cycles.toLocaleString()}`);
console.log(`PASS  frames processed        : ${s.totals.frames.toLocaleString()}`);
console.log(`PASS  devices maintained      : ${s.totals.devices}`);
console.log(`PASS  polling groups          : ${s.totals.pollGroups}`);
console.log(`PASS  discovered registers    : ${s.totals.registers}`);
console.log(`PASS  bounded history         : ${state.transactions.length}/${historyLimit}`);
console.log(`INFO  elapsed                 : ${elapsedMs.toFixed(1)} ms`);
console.log(`INFO  processing throughput   : ${fps.toFixed(0)} frames/s`);
console.log(`INFO  heap used               : ${heapMb.toFixed(1)} MB`);
console.log('\nSOAK TEST: PASS\n');
