'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReportBundleService, redactSensitive } = require('../src/v8/reporting/reportBundleService');

test('v8 handover redaction removes credential fields without damaging engineering identity keys', () => {
  const input = {
    deviceKey: 'grid-meter:1',
    registerKey: 'grid-meter:1:40001',
    tls: { keyPath: '/secure/client.key', certPath: '/secure/client.crt', passphrase: 'secret-pass' },
    auth: { token: 'abc123', api_key: 'xyz789' },
  };
  const safe = redactSensitive(input);
  assert.equal(safe.deviceKey, input.deviceKey);
  assert.equal(safe.registerKey, input.registerKey);
  assert.equal(safe.tls.keyPath, '[REDACTED]');
  assert.equal(safe.tls.certPath, '/secure/client.crt');
  assert.equal(safe.tls.passphrase, '[REDACTED]');
  assert.equal(safe.auth.token, '[REDACTED]');
  assert.equal(safe.auth.api_key, '[REDACTED]');
});

test('v8 handover project and runtime report files are emitted from redacted copies', () => {
  const project = {
    id: 'p1',
    name: 'Plant',
    devices: { meter: { deviceKey: 'meter', token: 'do-not-export' } },
    registers: {},
    loggerProfiles: [],
    connectionProfiles: [{ connectionId: 'tls-1', metadata: { transportOptions: { tls: { keyPath: '/secret/key.pem' } } } }],
  };
  const store = {
    getProject: (id) => id === 'p1' ? project : null,
    getActiveProject: () => project,
    exportAll: () => ({ schemaVersion: 3 }),
  };
  const reports = new ReportBundleService({
    store,
    masterWorkspace: {
      snapshot: () => ({ session: { password: 'runtime-secret', deviceKey: 'master-device' } }),
      audit: () => [{ auditId: 'a1', details: { clientSecret: 'audit-secret' } }],
    },
    timeline: { query: () => [{ eventId: 'e1', details: { accessToken: 'traffic-secret' } }] },
  });
  const built = reports.buildFiles('p1');
  const projectJson = JSON.parse(built.files.get('project/project.json').toString('utf8'));
  const masterJson = JSON.parse(built.files.get('reports/master-summary.json').toString('utf8'));
  const auditJson = JSON.parse(built.files.get('reports/write-audit.json').toString('utf8'));
  const trafficJson = JSON.parse(built.files.get('reports/traffic.json').toString('utf8'));

  assert.equal(projectJson.connectionProfiles[0].metadata.transportOptions.tls.keyPath, '[REDACTED]');
  assert.equal(projectJson.devices.meter.token, '[REDACTED]');
  assert.equal(projectJson.devices.meter.deviceKey, 'meter');
  assert.equal(masterJson.session.password, '[REDACTED]');
  assert.equal(masterJson.session.deviceKey, 'master-device');
  assert.equal(auditJson[0].details.clientSecret, '[REDACTED]');
  assert.equal(trafficJson[0].details.accessToken, '[REDACTED]');
  assert.equal(built.manifest.secretRedaction, true);
});
