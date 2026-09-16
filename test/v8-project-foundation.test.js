'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const v8 = require('../src/v8');

test('v8 feature flags default incomplete product surfaces off', () => {
  const flags = v8.normalizeFeatureFlags();
  assert.equal(flags.projectModel, true);
  assert.equal(flags.connectionCenter, false);
  assert.equal(flags.masterWorkspace, false);
  assert.equal(flags.simulatorWorkspace, false);
  assert.equal(flags.testCenter, false);
  assert.equal(Object.isFrozen(flags), true);
  assert.throws(
    () => v8.normalizeFeatureFlags({ doesNotExist: true }),
    (error) => error.code === 'UNKNOWN_FEATURE_FLAG',
  );
});

test('v8 connection profiles never persist live ownership or armed state', () => {
  const profile = v8.sanitizePersistentProfile({
    profileId: 'site-meter',
    name: 'Site Meter',
    transportKind: 'serial-rtu',
    settings: { path: 'COM9', baudRate: 19200, parity: 'even' },
    ownerId: 'runtime-owner',
    ownerMode: 'master',
    state: 'open',
    writeLock: 'ENABLED',
    faultInjectionEnabled: true,
  });
  assert.equal(profile.profileId, 'site-meter');
  assert.equal(profile.settings.path, 'COM9');
  assert.equal(profile.settings.baudRate, 19200);
  assert.equal(profile.settings.parity, 'even');
  assert.equal('ownerId' in profile, false);
  assert.equal('writeLock' in profile, false);
  assert.equal('faultInjectionEnabled' in profile, false);
});

test('v8 project load always resets transient write/fault capability', () => {
  const created = v8.createV8Project({
    projectId: 'p1',
    name: 'Plant 1',
    connectionProfiles: [{ profileId: 'tcp1', name: 'TCP meter', transportKind: 'tcp-client', settings: { host: '127.0.0.1', port: 502 } }],
  });
  const serialized = JSON.parse(JSON.stringify(created));
  serialized.runtime = { writeArmed: true, faultInjectionArmed: true, activeConnectionId: 'tcp1', activeOwnerMode: 'master' };
  const loaded = v8.loadV8Project(serialized);
  assert.deepEqual(loaded.runtime, {
    writeArmed: false,
    faultInjectionArmed: false,
    activeConnectionId: null,
    activeOwnerMode: null,
  });
  assert.equal(loaded.connections.profiles.length, 1);
});

test('v8 migrates every v7 workspace project without guessing live capability state', () => {
  const v7Workspace = {
    version: 2,
    activeProjectId: 'project-b',
    customWorkspaceField: { keep: 'me' },
    profiles: [{ id: 'eng-profile-1', name: 'Meter profile', registers: [] }],
    projects: [
      {
        id: 'project-a',
        name: 'Project A',
        site: 'A',
        bus: 'Bus A',
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        channels: { ch1: { id: 'ch1', transport: 'RTU' } },
        devices: { d1: { deviceKey: 'legacy-device-key' } },
        registers: { r1: { address: 0, functionCode: 3 } },
        discoveryRuns: [{ id: 'disc1', transport: 'RTU', results: [] }],
        legacyUnassigned: { devices: { old: {} }, registers: {} },
        customProjectField: { preserved: true },
      },
      {
        id: 'project-b',
        name: 'Project B',
        site: 'B',
        bus: 'Bus B',
        channels: {},
        devices: {},
        registers: {},
        discoveryRuns: [],
        legacyUnassigned: {},
      },
    ],
  };

  const migrated = v8.migrateV7Workspace(v7Workspace);
  assert.equal(migrated.workspace.projects.length, 2);
  assert.equal(migrated.workspace.activeProjectId, 'project-b');
  assert.equal(migrated.report.safetyReset, true);
  assert.equal(migrated.report.noSilentLossPolicy, true);

  const a = migrated.workspace.projects.find((project) => project.projectId === 'project-a');
  assert.equal(a.name, 'Project A');
  assert.equal(a.engineeringProfiles.length, 1);
  assert.deepEqual(a.legacy.unmappedProjectFields.customProjectField, { preserved: true });
  assert.deepEqual(migrated.workspace.migration.unmappedWorkspaceFields.customWorkspaceField, { keep: 'me' });
  assert.equal(a.runtime.writeArmed, false);
  assert.equal(a.runtime.faultInjectionArmed, false);
});

test('v8 rejects unsupported workspace/project schema versions explicitly', () => {
  const project = JSON.parse(JSON.stringify(v8.createV8Project({ projectId: 'p1', name: 'P1' })));
  project.schemaVersion = 99;
  assert.throws(() => v8.loadV8Project(project), (error) => error.code === 'UNSUPPORTED_PROJECT_SCHEMA');

  const workspace = JSON.parse(JSON.stringify(v8.createV8Workspace({ projects: [{ projectId: 'p1', name: 'P1' }] })));
  workspace.schemaVersion = 99;
  assert.throws(() => v8.loadV8Workspace(workspace), (error) => error.code === 'UNSUPPORTED_WORKSPACE_SCHEMA');
});

test('v8 workspace round-trip preserves canonical project identity and stays safely disarmed', () => {
  const original = v8.createV8Workspace({
    workspaceId: 'ws1',
    projects: [{
      projectId: 'p1',
      name: 'Main',
      preferences: { theme: 'dark', density: 'dense', addressBase: 1 },
      connectionProfiles: [{ profileId: 'v1', name: 'Virtual', transportKind: 'virtual-rtu', settings: { name: 'Loopback' } }],
    }],
    activeProjectId: 'p1',
  });
  const loaded = v8.loadV8Workspace(JSON.parse(JSON.stringify(original)));
  assert.equal(loaded.workspaceId, 'ws1');
  assert.equal(loaded.activeProjectId, 'p1');
  assert.equal(loaded.projects[0].preferences.addressBase, 1);
  assert.equal(loaded.projects[0].runtime.writeArmed, false);
  assert.equal(loaded.projects[0].connections.profiles[0].transportKind, 'virtual-rtu');
});
