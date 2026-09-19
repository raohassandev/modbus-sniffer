'use strict';

const v8 = require('../src/v8');
const { ChartService } = require('../src/v8/history/chartService');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const seconds = Math.max(1, Math.min(86400, arg('--seconds', 60)));
  const devices = Math.max(2, Math.min(100, Math.trunc(arg('--devices', 10))));
  const intervalMs = Math.max(20, Math.min(5000, Math.trunc(arg('--interval-ms', 100))));
  const maxHeapMb = Math.max(128, arg('--max-heap-mb', 512));

  const pair = v8.createVirtualLoopbackPair({ names: ['v8-soak-master', 'v8-soak-slave'] });
  const broker = new v8.ConnectionBroker();
  broker.defineConnection({ connectionId: 'v8-soak-master', resourceKey: 'virtual:v8-soak:master', transportKind: 'virtual-rtu', transport: pair.a });
  broker.defineConnection({ connectionId: 'v8-soak-slave', resourceKey: 'virtual:v8-soak:slave', transportKind: 'virtual-rtu', transport: pair.b });

  const slave = new v8.VirtualSlaveServer({ broker, connectionId: 'v8-soak-slave', ownerId: 'v8-soak-slave-owner', framing: 'rtu', receivePollMs: 5 });
  for (let unitId = 1; unitId <= devices; unitId += 1) {
    const device = slave.addDevice({
      unitId,
      sizes: { coils: 16, discreteInputs: 16, holdingRegisters: 16, inputRegisters: 16 },
      identity: { vendorName: 'Automatrix', productCode: 'V8-SOAK', revision: '8.0.0', modelName: `Soak Device ${unitId}` },
    });
    device.seed('holdingRegisters', 0, [unitId * 100, unitId * 100 + 1, unitId * 100 + 2, unitId * 100 + 3]);
  }

  const master = new v8.MasterEngine({ broker, connectionId: 'v8-soak-master', ownerId: 'v8-soak-master-owner', framing: 'rtu', timeoutMs: 250 });
  const timeline = new v8.TrafficTimelineService({ maxEvents: 50000, maxBookmarks: 1000 });
  const lab = new v8.RegisterLabService({ broker, maxPoints: devices * 16 + 100 });
  const charts = new ChartService({ maxDocuments: 2, defaultMaxPoints: 20000 });
  charts.createDocument({ documentId: 'soak-live', title: 'compatibility concurrent soak', maxPoints: 20000 });
  for (let unitId = 1; unitId <= devices; unitId += 1) charts.addSeries('soak-live', { seriesId: `unit-${unitId}`, label: `Unit ${unitId}`, unit: 'raw' });

  master.on('event', (event) => {
    timeline.ingest(event);
    lab.ingest(event);
  });
  lab.on('point', (point) => {
    if (point.area !== 'holdingRegisters' || point.address !== 0) return;
    charts.appendSample('soak-live', `unit-${point.unitId}`, { timestamp: point.lastSeen, value: Number(point.rawValue), quality: point.quality });
  });

  const scheduler = new v8.PollScheduler({ master, tickMs: 5, minimumInterRequestDelayMs: 1, maxDispatchPerTick: 8 });
  const pdu = v8.protocol.encodeReadRequest({ functionCode: 3, address: 0, quantity: 4 });
  for (let unitId = 1; unitId <= devices; unitId += 1) {
    scheduler.addJob({ jobId: `unit-${unitId}`, unitId, pdu, intervalMs, timeoutMs: 250, retries: 1, retryDelayMs: 20 });
  }

  const startedAt = Date.now();
  try {
    await slave.start();
    await master.open();
    scheduler.start();
    await sleep(seconds * 1000);
    scheduler.stop();

    const jobs = scheduler.listJobs();
    assert(jobs.length === devices, `Expected ${devices} poll jobs`);
    assert(jobs.every((job) => job.stats.successes > 0), 'Every soak poll job must complete successfully');
    assert(jobs.every((job) => job.stats.failures === 0), 'Soak must not contain poll failures');

    const traffic = timeline.stats();
    assert(traffic.tx > 0 && traffic.rx > 0, 'Soak must retain Tx and Rx evidence');
    assert(traffic.errors === 0, `Soak Traffic contains ${traffic.errors} errors`);

    const points = lab.list({ limit: devices * 16 + 100 });
    assert(new Set(points.map((point) => point.unitId)).size === devices, `Expected Register Lab evidence for ${devices} devices`);

    for (let unitId = 1; unitId <= devices; unitId += 1) {
      const samples = charts.querySeries('soak-live', `unit-${unitId}`, { maxPoints: 1000 });
      assert(samples.length > 0, `Expected chart samples for Unit ${unitId}`);
    }

    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    assert(heapMb <= maxHeapMb, `compatibility soak exceeded ${maxHeapMb} MB heap: ${heapMb.toFixed(1)} MB`);

    console.log('\n=== Modbus Engineering Tool Compatibility Concurrent Soak ===');
    console.log(`PASS  duration               : ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    console.log(`PASS  Master poll jobs       : ${jobs.length}`);
    console.log(`PASS  Virtual Slave devices  : ${devices}`);
    console.log(`PASS  Traffic Tx / Rx        : ${traffic.tx} / ${traffic.rx}`);
    console.log(`PASS  Register Lab devices   : ${new Set(points.map((point) => point.unitId)).size}`);
    console.log(`PASS  Chart series           : ${devices}`);
    console.log(`INFO  heap used              : ${heapMb.toFixed(1)} MB / ${maxHeapMb} MB`);
    console.log('\nCOMPATIBILITY CONCURRENT SOAK: PASS\n');
  } finally {
    scheduler.stop();
    await master.close().catch(() => undefined);
    await slave.stop({ closeConnection: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error('\nV8 CONCURRENT SOAK: FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
});
