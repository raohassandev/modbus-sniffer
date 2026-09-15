'use strict';

const {
  V8_PROJECT_SCHEMA_VERSION,
  clone,
  normalizeV8Database,
  normalizeV8Project,
  sanitizeConnectionProfile,
  validateV8Database,
  V8ProjectSchemaError,
} = require('./schema');

function now() {
  return new Date().toISOString();
}

function channelToConnectionProfile(channelId, channel, index) {
  const source = channel && typeof channel === 'object' && !Array.isArray(channel) ? channel : {};
  const transport = String(source.transport || '').toUpperCase();
  const transportKind = transport === 'RTU'
    ? 'serial-rtu'
    : transport === 'TCP'
      ? (String(source.mode || '').toLowerCase() === 'proxy' ? 'tcp-proxy' : 'tcp-client')
      : String(source.mode || 'unknown');

  return sanitizeConnectionProfile({
    connectionId: `migrated:${channelId}`,
    sourceChannelId: channelId,
    name: source.name || channelId,
    transport,
    transportKind,
    endpoint: source.endpoint ?? null,
    serial: source.serial ?? null,
    tcp: source.tcp ?? null,
    metadata: {
      migratedFromV7: true,
      legacyMode: source.mode ?? null,
      legacyActive: source.active === true,
      migrationPolicy: 'configuration-only; manual activation required',
    },
  }, { index });
}

function migrateProject(project, index) {
  const source = clone(project || {});
  const channels = source.channels && typeof source.channels === 'object' && !Array.isArray(source.channels)
    ? clone(source.channels)
    : {};
  const connections = Object.entries(channels).map(([channelId, channel], connectionIndex) => channelToConnectionProfile(channelId, channel, connectionIndex));

  const migrated = normalizeV8Project({
    ...source,
    id: source.id || `project-${index + 1}`,
    channels,
    devices: source.devices || {},
    registers: source.registers || {},
    discoveryRuns: source.discoveryRuns || [],
    legacyUnassigned: source.legacyUnassigned || { devices: {}, registers: {} },
    adoptions: source.adoptions || [],
    captures: source.captures || [],
    history: source.history ?? null,
    connections,
    masterJobs: [],
    slaveServers: [],
    virtualDevices: [],
    testRecipes: [],
    charts: [],
    loggerProfiles: [],
    automation: [],
    hmiScreens: [],
    ui: source.ui || {},
  }, { index });

  return migrated;
}

function migrationCounts(db) {
  const totals = {
    projects: db.projects.length,
    profiles: db.profiles.length,
    channels: 0,
    devices: 0,
    registers: 0,
    discoveryRuns: 0,
    legacyDevices: 0,
    legacyRegisters: 0,
    connectionProfiles: 0,
  };
  for (const project of db.projects) {
    totals.channels += Object.keys(project.channels || {}).length;
    totals.devices += Object.keys(project.devices || {}).length;
    totals.registers += Object.keys(project.registers || {}).length;
    totals.discoveryRuns += (project.discoveryRuns || []).length;
    totals.legacyDevices += Object.keys(project.legacyUnassigned?.devices || {}).length;
    totals.legacyRegisters += Object.keys(project.legacyUnassigned?.registers || {}).length;
    totals.connectionProfiles += (project.connections || []).length;
  }
  return totals;
}

function migrateV7Workspace(input, { source = 'v7-workspace-v2' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new V8ProjectSchemaError('INVALID_MIGRATION_SOURCE', 'Migration source must be an object');
  }

  if (Number(input.schemaVersion) === V8_PROJECT_SCHEMA_VERSION) {
    const db = validateV8Database(input);
    return {
      db,
      report: Object.freeze({
        migrated: false,
        fromVersion: V8_PROJECT_SCHEMA_VERSION,
        toVersion: V8_PROJECT_SCHEMA_VERSION,
        migratedAt: null,
        source,
        counts: Object.freeze(migrationCounts(db)),
        warnings: Object.freeze([]),
        policy: 'Already v8 schema; normalized without duplicating migrated collections.',
      }),
    };
  }

  if (Number(input.version) !== 2) {
    throw new V8ProjectSchemaError('UNSUPPORTED_MIGRATION_SOURCE', 'Only v7 workspace schema version 2 can migrate directly to v8 schema 3', {
      sourceVersion: input.version ?? input.schemaVersion ?? null,
    });
  }
  if (!Array.isArray(input.projects) || !Array.isArray(input.profiles)) {
    throw new V8ProjectSchemaError('INVALID_MIGRATION_SOURCE', 'v7 workspace must contain projects[] and profiles[]');
  }

  const stamp = now();
  const db = {
    schemaVersion: V8_PROJECT_SCHEMA_VERSION,
    activeProjectId: input.activeProjectId == null ? (input.projects[0]?.id || null) : String(input.activeProjectId),
    projects: input.projects.map(migrateProject),
    profiles: clone(input.profiles),
    metadata: {
      createdAt: stamp,
      updatedAt: stamp,
      migration: {
        fromVersion: 2,
        toVersion: V8_PROJECT_SCHEMA_VERSION,
        migratedAt: stamp,
        source,
        policy: 'Preserve v7 engineering evidence; create configuration-only connection profiles; never migrate live ownership/write/fault state.',
      },
    },
  };

  const normalized = validateV8Database(normalizeV8Database(db));
  const warnings = [];
  for (const project of normalized.projects) {
    if (Object.keys(project.legacyUnassigned?.devices || {}).length || Object.keys(project.legacyUnassigned?.registers || {}).length) {
      warnings.push(`Project ${project.id} retains Legacy / Unassigned data; no live channel assignment was guessed.`);
    }
  }

  return {
    db: normalized,
    report: Object.freeze({
      migrated: true,
      fromVersion: 2,
      toVersion: V8_PROJECT_SCHEMA_VERSION,
      migratedAt: stamp,
      source,
      counts: Object.freeze(migrationCounts(normalized)),
      warnings: Object.freeze(warnings),
      policy: normalized.metadata.migration.policy,
    }),
  };
}

module.exports = {
  channelToConnectionProfile,
  migrateProject,
  migrateV7Workspace,
  migrationCounts,
};
