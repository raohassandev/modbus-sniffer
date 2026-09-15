'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const v8 = require('../src/v8');
const { makeDeviceKey } = require('../src/transportIdentity');

function makeV7Workspace() {
  const rtuA = 'rtu:sn-a';
  const rtuB = 'rtu:sn-b';
  const tcp = 'tcp:proxy:site';
  const deviceA = makeDeviceKey(rtuA, 1);
  const deviceB = makeDeviceKey(rtuB, 1);
  const deviceTcp = makeDeviceKey(tcp, 255);
  return {
    version: 2,
    activeProjectId: 'project-1',
    projects: [{
      id: 'project-1',
      name: 'Existing v7 Site',
      site: 'Factory A',
      bus: 'MDB',
      description: 'Preserve this engineering project',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      channels: {
        [rtuA]: {
          channelId: rtuA,
          transport: 'RTU',
          mode: 'passive',
          name: 'RS485 A',
          endpoint: 'COM7',
          serial: { port: 'COM7', baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1 },
          active: true,
        },
        [rtuB]: {
          channelId: rtuB,
          transport: 'RTU',
          mode: 'passive',
          name: 'RS485 B',
          endpoint: 'COM8',
          serial: { port: 'COM8', baudRate: 19200, parity: 'even', dataBits: 8, stopBits: 1 },
          active: true,
        },
        [tcp]: {
          channelId: tcp,
          transport: 'TCP',
          mode: 'proxy',
          name: 'TCP proxy',
          endpoint: '10.0.0.8:502',
          tcp: { host: '10.0.0.8', port: 502 },
          active: true,
        },
      },
      devices: {
        [deviceA]: { deviceKey: deviceA, channelId: rtuA, unitId: 1, name: 'Meter A' },
        [deviceB]: { deviceKey: deviceB, channelId: rtuB, unitId: 1, name: 'Meter B' },
        [deviceTcp]: { deviceKey: deviceTcp, channelId: tcp, unitId: 255, name: 'Gateway Unit' },
      },
      registers: {
        [`${deviceA}:3:10`]: { deviceKey: deviceA, channelId: rtuA, unitId: 1, functionCode: 3, address: 10, type: 'uint16', name: 'Voltage' },
        [`${deviceB}:3:10`]: { deviceKey: deviceB, channelId: rtuB, unitId: 1, functionCode: 3, address: 10, type: 'uint16', name: 'Current' },
      },
      discoveryRuns: [{ id: 'discovery-1', transport: 'RTU', results: [{ unitId: 1, responded: true }] }],
      legacyUnassigned: {
        devices: { '1': { name: 'Old Meter' } },
        registers: { '1:3:1': { address: 1, functionCode: 3 } },
      },
      adoptions: [{ id: 'adopt-1', deviceKey: deviceA }],
      captures: [{ id: 'capture-1', name: 'baseline.mbcap' }],
      history: { retained: true, path: 'history/project-1' },
      writeLock: 'ENABLED',
      writesEnabled: true,
      faultInjectionEnabled: true,
      ownerMode: 'master',
      runtimeState: { state: 'open' },
    }],
    profiles: [{ id: 'profile-1', name: 'Energy Meter', version: 3, registers: [] }],
  };
}

test('v8 migration preserves v7 evidence while creating only safe/manual connection profiles', () => {
  const source = makeV7Workspace();
  const before = JSON.stringify(source);
  const { db, report } = v8.migrateV7Workspace(source, { source: 'fixture' });

  assert.equal(JSON.stringify(source), before, 'migration must not mutate v7 input');
  assert.equal(db.schemaVersion, 3);
  assert.equal(report.migrated, true);
  assert.equal(report.fromVersion, 2);
  assert.equal(report.toVersion, 3);
  assert.equal(report.counts.projects, 1);
  assert.equal(report.counts.channels, 3);
  assert.equal(report.counts.devices, 3);
  assert.equal(report.counts.registers, 2);
  assert.equal(report.counts.connectionProfiles, 3);

  const project = db.projects[0];
  assert.deepEqual(project.channels, source.projects[0].channels);
  assert.deepEqual(project.devices, source.projects[0].devices);
  assert.deepEqual(project.registers, source.projects[0].registers);
  assert.deepEqual(project.discoveryRuns, source.projects[0].discoveryRuns);
  assert.deepEqual(project.legacyUnassigned, source.projects[0].legacyUnassigned);
  assert.deepEqual(project.adoptions, source.projects[0].adoptions);
  assert.deepEqual(project.captures, source.projects[0].captures);
  assert.deepEqual(project.history, source.projects[0].history);
  assert.deepEqual(db.profiles, source.profiles);

  for (const connection of project.connections) {
    assert.equal(connection.activation, 'manual');
    assert.equal(connection.ownerMode, 'none');
    assert.equal(connection.transmitCapability, 'none');
    assert.equal(connection.writeLock, 'LOCKED');
    assert.equal(connection.writesEnabled, false);
    assert.equal(connection.faultInjectionEnabled, false);
    assert.equal(connection.enabled, false);
  }
  assert.equal(Object.hasOwn(project, 'runtimeState'), false);
  assert.equal(Object.hasOwn(project, 'writeLock'), false);
  assert.equal(Object.hasOwn(project, 'writesEnabled'), false);
  assert.equal(Object.hasOwn(project, 'faultInjectionEnabled'), false);
});

test('v8 migration keeps identical Unit IDs isolated by channel/deviceKey', () => {
  const { db } = v8.migrateV7Workspace(makeV7Workspace());
  const project = db.projects[0];
  const keys = Object.keys(project.devices).filter((key) => key.endsWith('|1'));
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(project.devices[keys[0]].channelId, project.devices[keys[1]].channelId);
  const address10 = Object.values(project.registers).filter((row) => row.address === 10);
  assert.equal(address10.length, 2);
  assert.notEqual(address10[0].deviceKey, address10[1].deviceKey);
});

test('v8 migration is idempotent and does not duplicate connection profiles', () => {
  const first = v8.migrateV7Workspace(makeV7Workspace(), { source: 'first' });
  const second = v8.migrateV7Workspace(first.db, { source: 'second' });
  assert.equal(second.report.migrated, false);
  assert.equal(second.db.schemaVersion, 3);
  assert.equal(second.db.projects[0].connections.length, first.db.projects[0].connections.length);
  assert.deepEqual(second.db.projects[0].connections, first.db.projects[0].connections);
  assert.deepEqual(second.db.projects[0].devices, first.db.projects[0].devices);
  assert.deepEqual(second.db.projects[0].registers, first.db.projects[0].registers);
});

test('v8 schema normalization strips persisted live/armed connection state', () => {
  const db = v8.createEmptyV8Database();
  const project = db.projects[0];
  project.channels['rtu:test'] = { channelId: 'rtu:test', transport: 'RTU', mode: 'passive' };
  project.connections = [{
    connectionId: 'dangerous-import',
    sourceChannelId: 'rtu:test',
    transport: 'RTU',
    transportKind: 'serial-rtu',
    ownerMode: 'master',
    transmitCapability: 'active',
    writeLock: 'ENABLED',
    writesEnabled: true,
    faultInjectionEnabled: true,
    enabled: true,
    activation: 'automatic',
  }];

  const safe = v8.validateV8Database(db);
  const connection = safe.projects[0].connections[0];
  assert.equal(connection.ownerMode, 'none');
  assert.equal(connection.transmitCapability, 'none');
  assert.equal(connection.writeLock, 'LOCKED');
  assert.equal(connection.writesEnabled, false);
  assert.equal(connection.faultInjectionEnabled, false);
  assert.equal(connection.enabled, false);
  assert.equal(connection.activation, 'manual');
});

test('v8 ProjectStore auto-migrates into a separate file, backs up v7 source and leaves source unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-migrate-'));
  const sourceFile = path.join(dir, 'workspaces.json');
  const destinationFile = path.join(dir, 'workbench-v8.json');
  const source = makeV7Workspace();
  const sourceText = JSON.stringify(source, null, 2);
  fs.writeFileSync(sourceFile, sourceText);

  const store = new v8.V8ProjectStore({ dataDir: dir, file: destinationFile, sourceV7File: sourceFile });
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), sourceText);
  assert.equal(fs.existsSync(destinationFile), true);
  assert.equal(store.exportAll().schemaVersion, 3);
  const report = store.getMigrationReport();
  assert.equal(report.migrated, true);
  assert.equal(fs.existsSync(report.sourceBackup), true);
  assert.equal(fs.readFileSync(report.sourceBackup, 'utf8'), sourceText);
  assert.equal(fs.existsSync(report.reportFile), true);
});

test('v8 ProjectStore sanitizes connection profile writes and persists only locked configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-store-'));
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const project = store.getActiveProject();
  store.updateProject(project.id, {
    channels: { 'rtu:lab': { channelId: 'rtu:lab', transport: 'RTU', mode: 'offline', active: false } },
  });
  const saved = store.upsertConnectionProfile(project.id, {
    connectionId: 'lab-port',
    sourceChannelId: 'rtu:lab',
    transport: 'RTU',
    transportKind: 'serial-rtu',
    serial: { port: 'COM12', baudRate: 115200, parity: 'none', dataBits: 8, stopBits: 1 },
    ownerMode: 'test',
    transmitCapability: 'active',
    writeLock: 'ENABLED',
    writesEnabled: true,
    faultInjectionEnabled: true,
    enabled: true,
  });
  assert.equal(saved.ownerMode, 'none');
  assert.equal(saved.writeLock, 'LOCKED');
  assert.equal(saved.writesEnabled, false);
  assert.equal(saved.faultInjectionEnabled, false);
  assert.equal(saved.enabled, false);

  const reopened = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const persisted = reopened.listConnectionProfiles(project.id)[0];
  assert.equal(persisted.writeLock, 'LOCKED');
  assert.equal(persisted.ownerMode, 'none');
});

test('v8 ProjectStore preserves corrupt primary evidence and restores last known-good backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-recover-'));
  const file = path.join(dir, 'workbench-v8.json');
  const store = new v8.V8ProjectStore({ dataDir: dir, file, autoMigrate: false });
  const project = store.getActiveProject();
  store.updateProject(project.id, { name: 'After first save' });
  store.updateProject(project.id, { name: 'After second save' });
  assert.equal(fs.existsSync(`${file}.bak`), true);

  fs.writeFileSync(file, '{not valid json');
  const recovered = new v8.V8ProjectStore({ dataDir: dir, file, autoMigrate: false });
  const recovery = recovered.getRecoveryReport();
  assert.ok(recovery);
  assert.equal(fs.existsSync(recovery.corruptFile), true);
  assert.equal(recovered.exportAll().schemaVersion, 3);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
});

test('v8 schema rejects devices whose channel-scoped identity points to an unknown channel', () => {
  const db = v8.createEmptyV8Database();
  db.projects[0].devices['rtu:missing|1'] = { deviceKey: 'rtu:missing|1', unitId: 1 };
  assert.throws(
    () => v8.validateV8Database(db),
    (error) => error.code === 'INVALID_DEVICE_KEY',
  );
});
