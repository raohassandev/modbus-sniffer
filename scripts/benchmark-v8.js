'use strict';

const v8 = require('../src/v8');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function trafficEvent({ connectionId, unitId, direction, raw, timestamp }) {
  const decoded = v8.protocol.decodeRtuAdu(raw);
  return v8.createWorkbenchEvent({
    timestamp,
    type: direction === 'tx' ? 'traffic.tx' : 'traffic.rx',
    source: 'v8-scale-benchmark',
    connectionId,
    ownerMode: 'master',
    direction,
    unitId: decoded.unitId,
    functionCode: decoded.pdu[0],
    raw,
    details: { framing: 'rtu' },
  });
}

async function main() {
  const pollJobs = Math.max(100, Math.min(1000, Math.trunc(arg('--poll-jobs', 100))));
  const devices = Math.max(100, Math.min(247, Math.trunc(arg('--devices', 100))));
  const registersPerDevice = Math.max(100, Math.min(125, Math.trunc(arg('--registers-per-device', 100))));
  const trafficEvents = Math.max(100000, Math.min(500000, Math.trunc(arg('--traffic-events', 100000))));
  const maxHeapMb = Math.max(128, arg('--max-heap-mb', 512));
  const maxElapsedMs = Math.max(1000, arg('--max-ms', 15000));

  const started = process.hrtime.bigint();

  const master = {
    connectionId: 'benchmark-master',
    framing: 'tcp',
    request: async () => ({ rttMs: 0, transactionId: null }),
  };
  const scheduler = new v8.PollScheduler({ master, tickMs: 1000, maxDispatchPerTick: 128 });
  const readPdu = v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 1 });
  for (let index = 0; index < pollJobs; index += 1) {
    scheduler.addJob({
      jobId: `scale-job-${index + 1}`,
      unitId: (index % 247) + 1,
      pdu: readPdu,
      intervalMs: 1000,
      timeoutMs: 1000,
    });
  }
  assert(scheduler.snapshot().jobCount === pollJobs, `Expected ${pollJobs} poll jobs`);
  await Promise.all(scheduler.listJobs().map((job) => scheduler.readNow(job.jobId)));
  assert(scheduler.listJobs().every((job) => job.stats.successes === 1), 'Every scale poll job must complete once');
  scheduler.stop();

  const simulator = new v8.VirtualSlaveServer({
    broker: new v8.ConnectionBroker(),
    connectionId: 'scale-simulator',
    ownerId: 'scale-simulator-owner',
    framing: 'rtu',
  });
  for (let unitId = 1; unitId <= devices; unitId += 1) {
    simulator.addDevice({
      unitId,
      sizes: { coils: 8, discreteInputs: 8, holdingRegisters: registersPerDevice, inputRegisters: 8 },
      identity: { vendorName: 'Automatrix', productCode: 'V8-SCALE', revision: '8.0.0', modelName: `Scale Device ${unitId}` },
    });
  }
  const simulatorSnapshot = simulator.snapshot();
  assert(simulatorSnapshot.unitIds.length === devices, `Expected ${devices} simulated Unit IDs`);
  assert(simulatorSnapshot.unitIds[0] === 1 && simulatorSnapshot.unitIds.at(-1) === devices, 'Simulator Unit-ID range mismatch');

  const lab = new v8.RegisterLabService({ maxPoints: devices * registersPerDevice + 100 });
  for (let unitId = 1; unitId <= devices; unitId += 1) {
    const connectionId = `scale-line-${unitId}`;
    const request = v8.protocol.encodeRtuAdu(
      unitId,
      v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: registersPerDevice }),
    );
    const values = Array.from({ length: registersPerDevice }, (_value, index) => (unitId * 1000 + index) & 0xFFFF);
    const response = v8.protocol.encodeRtuAdu(
      unitId,
      v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values }),
    );
    const timestamp = 1_000_000 + unitId * 10;
    lab.ingest(trafficEvent({ connectionId, unitId, direction: 'tx', raw: request, timestamp }));
    lab.ingest(trafficEvent({ connectionId, unitId, direction: 'rx', raw: response, timestamp: timestamp + 2 }));
  }
  const expectedPoints = devices * registersPerDevice;
  const points = lab.list({ limit: expectedPoints });
  assert(points.length === expectedPoints, `Expected ${expectedPoints} Register Lab points, got ${points.length}`);
  assert(new Set(points.map((point) => point.connectionId)).size === devices, `Expected ${devices} isolated device channels`);

  const timeline = new v8.TrafficTimelineService({ maxEvents: trafficEvents, maxBookmarks: 1000 });
  for (let index = 0; index < trafficEvents; index += 1) {
    timeline.ingest({
      timestamp: index,
      type: index % 10000 === 0 ? 'master.timeout' : (index % 2 ? 'traffic.rx' : 'traffic.tx'),
      source: 'v8-scale-benchmark',
      connectionId: `line-${index % devices}`,
      ownerMode: 'master',
      direction: index % 2 ? 'rx' : 'tx',
      unitId: (index % devices) + 1,
      functionCode: 3,
      raw: Buffer.from([index & 0xFF, 3, (index >> 8) & 0xFF, index & 0xFF]),
      details: index % 10000 === 0 ? { errorCode: 'TIMEOUT' } : {},
    });
  }
  const stats = timeline.stats();
  assert(stats.retained === trafficEvents, `Expected ${trafficEvents} retained events, got ${stats.retained}`);
  assert(stats.connections === devices, `Expected ${devices} traffic connections, got ${stats.connections}`);
  assert(timeline.query({ limit: 5000 }).length === 5000, 'Expected bounded 5000-row Traffic query');
  assert(timeline.query({ errorOnly: true, limit: 5000 }).length === Math.ceil(trafficEvents / 10000), 'Traffic error filter mismatch');

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
  assert(elapsedMs <= maxElapsedMs, `v8 scale benchmark exceeded ${maxElapsedMs} ms: ${elapsedMs.toFixed(1)} ms`);
  assert(heapMb <= maxHeapMb, `v8 scale benchmark exceeded ${maxHeapMb} MB heap: ${heapMb.toFixed(1)} MB`);

  console.log('\n=== Modbus Engineering Workbench v8 Scale Benchmark ===');
  console.log(`PASS  poll jobs              : ${pollJobs}`);
  console.log(`PASS  simulated Unit IDs     : ${devices}`);
  console.log(`PASS  isolated devices       : ${devices}`);
  console.log(`PASS  Register Lab points    : ${expectedPoints.toLocaleString()}`);
  console.log(`PASS  Traffic events         : ${trafficEvents.toLocaleString()}`);
  console.log('PASS  bounded Traffic query  : 5,000 rows');
  console.log(`INFO  elapsed                : ${elapsedMs.toFixed(1)} ms / ${maxElapsedMs} ms`);
  console.log(`INFO  heap used              : ${heapMb.toFixed(1)} MB / ${maxHeapMb} MB`);
  console.log('\nV8 SCALE BENCHMARK: PASS\n');
}

main().catch((error) => {
  console.error('\nV8 SCALE BENCHMARK: FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
