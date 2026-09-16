'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-history-workspace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json();
  return { response, payload };
}

test('v8 history workspace integrates chart samples, rotating logger and optional SQLite historian', (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const timeline = new v8.TrafficTimelineService({ maxEvents: 100 });
  const history = new v8.HistoryWorkspaceService({ store, timeline });
  t.after(() => history.close());

  history.charts.createDocument({ documentId: 'power', title: 'Power trend', maxPoints: 100 });
  history.charts.addSeries('power', { seriesId: 'kw', label: 'Active Power', unit: 'kW' });
  history.logger.addStream({ streamId: 'kw-log', mode: 'every', intervalMs: 1000, source: { tag: 'kw' } });

  const result = history.ingestSample({
    documentId: 'power',
    seriesId: 'kw',
    streamId: 'kw-log',
    timestamp: 1000,
    value: 123.45,
    quality: 'good',
  });
  assert.equal(result.chart.value, 123.45);
  assert.equal(result.logged, true);
  assert.equal(history.charts.querySeries('power', 'kw').length, 1);
  assert.equal(history.logger.status().stats.written, 1);
  assert.ok(history.logger.status().currentPath);
  assert.equal(fs.existsSync(history.logger.status().currentPath), true);

  if (history.historian) {
    history.historian.upsertTag({ tagId: 'grid-kw', name: 'Grid kW', unit: 'kW' });
    history.ingestSample({ tagId: 'grid-kw', timestamp: 2000, value: 88.5 });
    assert.equal(history.historian.querySamples('grid-kw').at(-1).value, 88.5);
  } else {
    assert.equal(history.snapshot().historian.available, false);
    assert.match(history.snapshot().historian.reason, /sqlite/i);
  }
});

test('v8 product server exposes Charts, Logger and Historian APIs with safe Node-version degradation', async (t) => {
  const store = new v8.V8ProjectStore({ dataDir: tempDir(t), autoMigrate: false });
  const broker = new v8.ConnectionBroker();
  const flags = Object.freeze({ ...v8.DEFAULT_FLAGS, chartsWorkspace: true, historianWorkspace: true });
  const server = await v8.startV8ProductServer({ store, broker, host: '127.0.0.1', port: 0, flags });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const created = await json(`${base}/api/v8/charts`, {
    method: 'POST',
    body: JSON.stringify({ documentId: 'voltage', title: 'Voltage', maxPoints: 100 }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.document.documentId, 'voltage');

  const series = await json(`${base}/api/v8/charts/voltage/series`, {
    method: 'POST',
    body: JSON.stringify({ seriesId: 'va', label: 'Phase A', unit: 'V' }),
  });
  assert.equal(series.response.status, 201);

  const sample = await json(`${base}/api/v8/charts/voltage/series/va/samples`, {
    method: 'POST',
    body: JSON.stringify({ timestamp: 1000, value: 231.2 }),
  });
  assert.equal(sample.response.status, 201);
  assert.equal(sample.payload.result.chart.value, 231.2);

  const points = await json(`${base}/api/v8/charts/voltage/series/va/samples?maxPoints=100`);
  assert.equal(points.response.status, 200);
  assert.equal(points.payload.points.length, 1);

  const stream = await json(`${base}/api/v8/logger/streams`, {
    method: 'POST',
    body: JSON.stringify({ streamId: 'voltage-log', mode: 'change-only', intervalMs: 1000 }),
  });
  assert.equal(stream.response.status, 201);
  const logged = await json(`${base}/api/v8/logger/streams/voltage-log/samples`, {
    method: 'POST',
    body: JSON.stringify({ timestamp: 2000, value: 232.1 }),
  });
  assert.equal(logged.response.status, 201);
  assert.equal(logged.payload.result.logged, true);

  const historian = await json(`${base}/api/v8/historian`);
  assert.equal(historian.response.status, 200);
  if (historian.payload.historian.available) {
    const tag = await json(`${base}/api/v8/historian/tags/grid-voltage`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Grid Voltage', unit: 'V' }),
    });
    assert.equal(tag.response.status, 200);
    await json(`${base}/api/v8/historian/tags/grid-voltage/samples`, {
      method: 'POST',
      body: JSON.stringify({ timestamp: 3000, value: 230.7 }),
    });
    const samples = await json(`${base}/api/v8/historian/tags/grid-voltage/samples`);
    assert.equal(samples.response.status, 200);
    assert.equal(samples.payload.samples.at(-1).value, 230.7);
    const tags = await json(`${base}/api/v8/historian/tags`);
    assert.equal(tags.payload.tags.some((item) => item.tagId === 'grid-voltage'), true);
  } else {
    const tags = await json(`${base}/api/v8/historian/tags`);
    assert.equal(tags.response.status, 503);
    assert.equal(tags.payload.error.code, 'SQLITE_UNAVAILABLE');
  }
});
