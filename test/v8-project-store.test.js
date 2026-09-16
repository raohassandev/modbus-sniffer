'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-project-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('v8 project store migrates v7 workspace with backup and report', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'workspace.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 2,
    activeProjectId: 'p1',
    profiles: [{ id: 'profile-1', name: 'Legacy profile', registers: [] }],
    projects: [{
      id: 'p1',
      name: 'Legacy project',
      site: 'Site',
      bus: 'Bus',
      channels: {},
      devices: {},
      registers: {},
      discoveryRuns: [],
      legacyUnassigned: {},
    }],
  }, null, 2));

  const store = new v8.V8ProjectStore({ file });
  const workspace = store.snapshot();
  assert.equal(workspace.format, v8.V8_WORKSPACE_FORMAT);
  assert.equal(workspace.schemaVersion, v8.V8_SCHEMA_VERSION);
  assert.equal(workspace.activeProjectId, 'p1');
  assert.equal(workspace.projects[0].engineeringProfiles.length, 1);
  assert.equal(workspace.projects[0].runtime.writeArmed, false);
  assert.ok(store.lastMigrationReport?.backupFile);
  assert.ok(store.lastMigrationReport?.reportFile);
  assert.equal(fs.existsSync(store.lastMigrationReport.backupFile), true);
  assert.equal(fs.existsSync(store.lastMigrationReport.reportFile), true);

  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(disk.format, v8.V8_WORKSPACE_FORMAT);
});

test('v8 project store refuses to persist armed write or fault state', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'workspace.json');
  const initial = v8.createV8Workspace({
    workspaceId: 'ws',
    activeProjectId: 'p1',
    projects: [{ projectId: 'p1', name: 'Plant' }],
  });
  fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  const store = new v8.V8ProjectStore({ file });
  const edited = store.snapshot();
  edited.projects[0].runtime = {
    writeArmed: true,
    faultInjectionArmed: true,
    activeConnectionId: 'danger',
    activeOwnerMode: 'master',
  };
  store.save(edited);

  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(disk.projects[0].runtime, {
    writeArmed: false,
    faultInjectionArmed: false,
    activeConnectionId: null,
    activeOwnerMode: null,
  });
});

test('v8 project store preserves corrupt input before refusing to load it', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'workspace.json');
  fs.writeFileSync(file, '{broken json');
  assert.throws(
    () => new v8.V8ProjectStore({ file }),
    (error) => error.code === 'PROJECT_JSON_CORRUPT' && Boolean(error.details.preserved),
  );
  const preserved = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'));
  assert.equal(preserved.length, 1);
});

test('v8 project store creates backups on subsequent saves', (t) => {
  const dir = tempDir(t);
  const file = path.join(dir, 'workspace.json');
  const store = new v8.V8ProjectStore({ file });
  const first = v8.createV8Workspace({ workspaceId: 'ws', projects: [{ projectId: 'p1', name: 'One' }], activeProjectId: 'p1' });
  store.save(first);
  const edited = store.snapshot();
  edited.projects[0].name = 'Two';
  store.save(edited);
  assert.equal(fs.existsSync(`${file}.bak`), true);
  const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
  assert.equal(backup.projects[0].name, 'One');
});
