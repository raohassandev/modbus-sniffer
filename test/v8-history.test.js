'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('../src/v8');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('v8 ChartService keeps multiple series isolated, applies engineering scaling and decimates bounded history', () => {
  const charts = new v8.ChartService({ defaultMaxPoints: 1000 });
  charts.createDocument({ documentId: 'power', title: 'Power', maxPoints: 1000 });
  charts.addSeries('power', { seriesId: 'grid', unit: 'kW', axis: 'left', scale: 0.1, source: { connectionId: 'grid-meter', address: 100 } });
  charts.addSeries('power', { seriesId: 'pf', unit: 'PF', axis: 'right', scale: 0.001, source: { connectionId: 'grid-meter', address: 110 } });

  for (let index = 0; index < 200; index += 1) {
    charts.appendSample('power', 'grid', { timestamp: index * 1000, value: index });
    charts.appendSample('power', 'pf', { timestamp: index * 1000, value: 900 + (index % 50) });
  }
  charts.addMarker('power', { timestamp: 50000, type: 'write', label: 'Setpoint changed' });

  const grid = charts.querySeries('power', 'grid', { maxPoints: 25 });
  const pf = charts.querySeries('power', 'pf', { from: 10000, to: 20000 });
  assert.ok(grid.length <= 25);
  assert.equal(grid[0].value, 0);
  assert.ok(Math.abs(grid.at(-1).value - 19.9) < 1e-12);
  assert.equal(pf.length, 11);
  assert.equal(charts.getDocument('power').series.find((series) => series.seriesId === 'pf').axis, 'right');
  assert.match(charts.exportCsv('power'), /grid/);
});

test('v8 RotatingJsonlLogger supports every/fixed/change-only sampling, flush visibility and retention', () => {
  const directory = tempDir('modbus-v8-logger-');
  let now = Date.UTC(2026, 8, 16, 0, 0, 0);
  const logger = new v8.RotatingJsonlLogger({ directory, prefix: 'site', maxBytes: 1024, retentionFiles: 2, immediateFlush: true, clock: () => now });
  logger.addStream({ streamId: 'every', mode: 'every', source: { tagId: 'power' } });
  logger.addStream({ streamId: 'fixed', mode: 'fixed', intervalMs: 1000 });
  logger.addStream({ streamId: 'change', mode: 'change-only' });

  assert.equal(logger.ingest('every', { timestamp: now, value: 1 }), true);
  assert.equal(logger.ingest('fixed', { timestamp: now, value: 10 }), true);
  assert.equal(logger.ingest('fixed', { timestamp: now + 500, value: 11 }), false);
  assert.equal(logger.ingest('fixed', { timestamp: now + 1000, value: 12 }), true);
  assert.equal(logger.ingest('change', { timestamp: now, value: 5 }), true);
  assert.equal(logger.ingest('change', { timestamp: now + 1, value: 5 }), false);
  assert.equal(logger.ingest('change', { timestamp: now + 2, value: 6 }), true);

  for (let index = 0; index < 50; index += 1) {
    now += 10;
    logger.ingest('every', { timestamp: now, value: { index, payload: 'x'.repeat(40) } });
  }
  logger.flush();
  const status = logger.status();
  assert.ok(status.stats.written >= 55);
  assert.ok(status.stats.rotations >= 2);
  logger.close();
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonl'));
  assert.ok(files.length <= 2);
  assert.ok(files.every((name) => fs.statSync(path.join(directory, name)).size > 0));
  fs.rmSync(directory, { recursive: true, force: true });
});

test('v8 SQLite historian stores indexed samples/events, preserves exact non-number values and enforces retention', { skip: !v8.sqliteAvailable() }, () => {
  const directory = tempDir('modbus-v8-historian-');
  const filePath = path.join(directory, 'history.sqlite');
  const historian = new v8.SqliteHistorian({ filePath });
  try {
    historian.upsertTag({ tagId: 'grid.kw', name: 'Grid Power', unit: 'kW', source: { connectionId: 'grid', address: 100 } });
    historian.upsertTag({ tagId: 'counter', name: 'Counter' });
    historian.recordSample({ tagId: 'grid.kw', timestamp: 1000, value: 10.5, quality: 'good' });
    historian.recordSample({ tagId: 'grid.kw', timestamp: 2000, value: 11.5, quality: 'good' });
    historian.recordSample({ tagId: 'grid.kw', timestamp: 3000, value: 12.5, quality: 'stale' });
    historian.recordSample({ tagId: 'counter', timestamp: 1000, value: 9007199254740993n, quality: 'good' });
    historian.recordEvent({ timestamp: 1500, type: 'write', source: 'master', connectionId: 'grid', details: { address: 100 } });

    assert.deepEqual(historian.querySamples('grid.kw', { from: 1500, to: 3000 }).map((row) => row.value), [11.5, 12.5]);
    assert.equal(historian.querySamples('counter')[0].value, 9007199254740993n);
    assert.equal(historian.queryEvents({ type: 'write' }).length, 1);
    assert.equal(historian.integrityCheck().ok, true);

    historian.enforceRetention({ maxSamplesPerTag: 2 });
    assert.equal(historian.querySamples('grid.kw').length, 2);
    assert.equal(historian.status().tagCount, 2);
  } finally {
    historian.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('v8 SQLite historian fails explicitly rather than silently degrading when node:sqlite is unavailable', { skip: v8.sqliteAvailable() }, () => {
  const directory = tempDir('modbus-v8-no-sqlite-');
  try {
    assert.throws(
      () => new v8.SqliteHistorian({ filePath: path.join(directory, 'history.sqlite') }),
      (error) => error.code === 'SQLITE_UNAVAILABLE',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
