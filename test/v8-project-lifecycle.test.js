'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { V8ProjectStore, ProjectLifecycleService, assertProjectSwitchSafe } = require('../src/v8/project');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-project-lifecycle-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  return { store, service: new ProjectLifecycleService({ store }) };
}

test('v8 project clone keeps engineering configuration but drops runtime/evidence collections', (t) => {
  const { store, service } = setup(t);
  const source = store.getActiveProject();
  store.updateProject(source.id, {
    site: 'Plant A',
    channels: { ch1: { channelId: 'ch1', transport: 'RTU' } },
    connections: [{ connectionId: 'meter', sourceChannelId: 'ch1', transport: 'RTU', enabled: true, writesEnabled: true, ownerMode: 'master' }],
    masterJobs: [{ jobId: 'poll-1', connectionId: 'meter', unitId: 1, functionCode: 3, address: 0, quantity: 10 }],
    captures: [{ captureId: 'runtime-capture' }],
    discoveryRuns: [{ runId: 'runtime-discovery' }],
    history: { samples: [1, 2, 3] },
  });

  const result = service.cloneProject(source.id, { name: 'Plant A Copy' });
  assert.equal(result.project.name, 'Plant A Copy');
  assert.equal(result.project.site, 'Plant A');
  assert.equal(result.project.masterJobs.length, 1);
  assert.equal(result.project.connections[0].enabled, false);
  assert.equal(result.project.connections[0].writesEnabled, false);
  assert.equal(result.project.connections[0].ownerMode, 'none');
  assert.deepEqual(result.project.captures, []);
  assert.deepEqual(result.project.discoveryRuns, []);
  assert.equal(result.project.history, null);
});

test('v8 project templates support preview, safe apply, persistence and removal', (t) => {
  const { store, service } = setup(t);
  const source = store.getActiveProject();
  store.updateProject(source.id, {
    name: 'Boiler Room',
    charts: [{ documentId: 'load', title: 'Load', series: [] }],
    hmiScreens: [{ screenId: 'main', name: 'Main', widgets: [] }],
  });

  const template = service.saveTemplate({ projectId: source.id, templateId: 'boiler-template', name: 'Boiler Template' });
  assert.equal(template.templateId, 'boiler-template');
  assert.equal(service.listTemplates().length, 1);

  const preview = service.previewTemplate('boiler-template', { name: 'Boiler B' });
  assert.equal(preview.project.name, 'Boiler B');
  assert.equal(preview.counts.charts, 1);
  assert.equal(preview.counts.hmiScreens, 1);
  assert.equal(preview.project.id, null);

  const applied = service.applyTemplate('boiler-template', { name: 'Boiler B', activate: true });
  assert.equal(applied.project.name, 'Boiler B');
  assert.equal(store.getActiveProject().id, applied.project.id);
  assert.equal(applied.project.charts.length, 1);
  assert.equal(applied.project.hmiScreens.length, 1);

  const reloaded = new V8ProjectStore({ dataDir: store.dataDir, autoMigrate: false });
  assert.equal(new ProjectLifecycleService({ store: reloaded }).listTemplates().length, 1);
  assert.equal(service.removeTemplate('boiler-template'), true);
  assert.equal(service.removeTemplate('boiler-template'), false);
});

test('project activation safety refuses switching while any runtime connection is owned or open', () => {
  assert.throws(
    () => assertProjectSwitchSafe({ listConnections: () => [{ connectionId: 'grid', owner: 'master', state: 'open' }] }),
    (error) => error.code === 'CONNECTION_ACTIVE' && error.details.connectionId === 'grid',
  );
  assert.doesNotThrow(() => assertProjectSwitchSafe({ listConnections: () => [{ connectionId: 'grid', owner: null, state: 'closed' }] }));
});
