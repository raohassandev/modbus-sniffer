'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { V8ProjectStore } = require('../src/v8/project');
const { ReportBundleService, safeName, spreadsheetSafeText, sha256 } = require('../src/v8/reporting/reportBundleService');

test('v8 report bundle produces hashed bounded handover files with spreadsheet safety', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-report-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  const project = store.getActiveProject();
  store.updateProject(project.id, { name: 'Plant / North', testRecipes: [{ recipeId: 'r1', name: 'Acceptance' }] });

  const masterWorkspace = {
    snapshot() { return { connections: [], jobs: [] }; },
    audit() { return [{ timestamp: 1, auditId: '=AUDIT()', connectionId: 'grid', unitId: 1, functionCode: 6, address: 10, result: 'ok' }]; },
  };
  const timeline = {
    query() { return [{ sequence: 1, timestamp: 2, eventId: '+EVENT', type: 'tx', connectionId: 'grid', channelId: 'ch1', unitId: 1, functionCode: 3, rawHex: '010300000001' }]; },
  };
  const history = { historianTags() { return [{ tagId: 'kw', name: 'Power', unit: 'kW' }]; } };
  const reports = new ReportBundleService({ store, masterWorkspace, timeline, history });
  const built = reports.buildFiles(project.id);

  assert.equal(built.manifest.format, 'modbus-workbench-v8-handover');
  assert.equal(built.manifest.schemaVersion, 3);
  assert.equal(built.manifest.formulaInjectionProtection, true);
  assert.equal(built.manifest.boundedRuntimeEvidence.trafficRows, 1);
  assert.equal(built.manifest.boundedRuntimeEvidence.writeAuditRows, 1);
  assert.ok(built.files.has('reports/write-audit.csv'));
  assert.ok(built.files.has('reports/traffic.csv'));
  assert.ok(built.files.has('reports/simulator-model.json'));
  assert.ok(built.files.has('manifest.json'));

  const auditCsv = built.files.get('reports/write-audit.csv').toString('utf8');
  const trafficCsv = built.files.get('reports/traffic.csv').toString('utf8');
  const deviceHeader = built.files.get('reports/devices.csv').toString('utf8').split(/\r?\n/, 1)[0].split(',');
  assert.match(auditCsv, /'=AUDIT\(\)/);
  assert.match(trafficCsv, /'\+EVENT/);
  assert.equal(deviceHeader.filter((column) => column === 'deviceKey').length, 1);

  for (const entry of built.manifest.files) {
    const content = built.files.get(entry.name);
    assert.equal(entry.sha256, sha256(content));
    assert.equal(entry.bytes, content.length);
  }
});

test('inactive project handover never inherits active project Master/audit/Traffic runtime evidence', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-report-isolation-'));
  const store = new V8ProjectStore({ dataDir: dir, autoMigrate: false });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  const active = store.getActiveProject();
  const inactive = store.createProject({ name: 'Inactive Site' });
  let snapshots = 0;
  let audits = 0;
  let trafficQueries = 0;
  const reports = new ReportBundleService({
    store,
    masterWorkspace: {
      snapshot() { snapshots += 1; return { projectId: active.id }; },
      audit() { audits += 1; return [{ auditId: 'active-only' }]; },
    },
    timeline: { query() { trafficQueries += 1; return [{ eventId: 'active-only' }]; } },
    history: { historianTags(projectId) { return [{ tagId: `${projectId}:tag` }]; } },
  });

  const model = reports.collect(inactive.id);
  assert.equal(model.active, false);
  assert.equal(model.master, null);
  assert.deepEqual(model.writeAudit, []);
  assert.deepEqual(model.traffic, []);
  assert.equal(snapshots, 0);
  assert.equal(audits, 0);
  assert.equal(trafficQueries, 0);
  assert.equal(model.historianTags[0].tagId, `${inactive.id}:tag`);
});

test('v8 export helpers sanitize filenames and formula-leading text', () => {
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('site/a:*?'), 'site-a---');
  assert.equal(spreadsheetSafeText('=1+1'), "'=1+1");
  assert.equal(spreadsheetSafeText(' normal'), ' normal');
});
