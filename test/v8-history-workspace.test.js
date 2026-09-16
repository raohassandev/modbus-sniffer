'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

class FakeRegisterLab extends EventEmitter {}

function setup(t) {
  const dir = tempDir(t);
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const registerLab = new FakeRegisterLab();
  const history = new v8.HistoryWorkspaceService({ store, registerLab, dataDir: dir });
  t.after(() => history.shutdown());
  return { dir, store, registerLab, history };
}

test('v8 history workspace persists chart and logger definitions while keeping live samples bounded in runtime', (t) => {
  const { store, registerLab, history } = setup(t);
  history.saveChart({ documentId: 'power', title: 'Active Power', maxPoints: 100, series: [{ seriesId: 'kw', sourceKey: 'meter:kw', label: 'kW', unit: 'kW' }] });
  history.saveLogger({ streamId: 'power-log', sourceKey: 'meter:kw', label: 'Active Power', unit: 'kW', mode: 'every', historian: true });

  const persisted = store.getActiveProject();
  assert.equal(persisted.charts[0].documentId, 'power');
  assert.equal(persisted.loggerProfiles[0].streamId, 'power-log');

  registerLab.emit('point', { sourceKey: 'meter:kw', rawValue: 123, quality: 'good', lastSeen: Date.now(), engineering: { available: true, value: 12.3 } });
  registerLab.emit('point', { sourceKey: 'meter:kw', rawValue: 124, quality: 'good', lastSeen: Date.now() + 1, engineering: { available: true, value: 12.4 } });
  const points = history.queryChart('power', 'kw', { maxPoints: 20 });
  assert.deepEqual(points.map((point) => point.value), [12.3, 12.4]);
  assert.equal(history.snapshot().logger.stats.written, 2);

  const files = fs.readdirSync(path.join(store.dataDir, 'v8-logs', 'project-default')).filter((name) => name.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  const lines = fs.readFileSync(path.join(store.dataDir, 'v8-logs', 'project-default', files[0]), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map((row) => row.value), [12.3, 12.4]);
});

test('v8 history workspace uses SQLite historian when supported and degrades cleanly when unavailable', (t) => {
  const { registerLab, history } = setup(t);
  history.saveLogger({ streamId: 'temperature', sourceKey: 'meter:t', label: 'Temperature', unit: 'C', mode: 'every', historian: true });
  const before = history.snapshot();
  registerLab.emit('point', { sourceKey: 'meter:t', rawValue: 250, quality: 'good', lastSeen: Date.now(), engineering: { available: true, value: 25 } });
  if (v8.sqliteAvailable()) {
    const tags = history.historianTags();
    assert.equal(tags[0].tagId, 'temperature');
    const samples = history.queryHistorian('temperature', { limit: 10 });
    assert.equal(samples.at(-1).value, 25);
  } else {
    assert.equal(before.sqliteAvailable, false);
    assert.throws(() => history.queryHistorian('temperature'), (error) => error.code === 'HISTORIAN_UNAVAILABLE');
  }
});

test('v8 chart definitions reject duplicate series and logger definitions reject missing sources', (t) => {
  const { history } = setup(t);
  assert.throws(() => history.saveChart({ documentId: 'dup', series: [{ seriesId: 'x', sourceKey: 'a' }, { seriesId: 'x', sourceKey: 'b' }] }), (error) => error.code === 'DUPLICATE_SERIES');
  assert.throws(() => history.saveLogger({ streamId: 'bad', sourceKey: '' }), (error) => error.code === 'SOURCE_REQUIRED');
});
