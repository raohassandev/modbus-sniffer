'use strict';

const { parseDeviceKey } = require('../../transportIdentity');

const V8_PROJECT_SCHEMA_VERSION = 3;
const SAFE_OWNER_MODE = 'none';
const SAFE_WRITE_STATE = 'LOCKED';

const COLLECTION_LIMITS = Object.freeze({
  projects: 5000,
  profiles: 10000,
  connections: 2000,
  masterJobs: 20000,
  slaveServers: 2000,
  virtualDevices: 100000,
  testRecipes: 10000,
  charts: 10000,
  loggerProfiles: 10000,
  digitalTwins: 1000,
  automation: 10000,
  hmiScreens: 10000,
  discoveryRuns: 100,
});

const V8_ARRAY_FIELDS = Object.freeze([
  'connections',
  'masterJobs',
  'slaveServers',
  'virtualDevices',
  'testRecipes',
  'charts',
  'loggerProfiles',
  'digitalTwins',
  'automation',
  'hmiScreens',
]);

class V8ProjectSchemaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'V8ProjectSchemaError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, V8ProjectSchemaError);
  }
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function isoNow() {
  return new Date().toISOString();
}

function objectOr(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : clone(fallback);
}

function arrayOr(value) {
  return Array.isArray(value) ? clone(value) : [];
}

function safeText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function sanitizeConnectionProfile(input = {}, { index = 0 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new V8ProjectSchemaError('INVALID_CONNECTION_PROFILE', 'Connection profile must be an object', { index });
  }
  const sourceChannelId = input.sourceChannelId == null ? null : String(input.sourceChannelId);
  const connectionId = String(input.connectionId || input.id || (sourceChannelId ? `channel:${sourceChannelId}` : `connection-${index + 1}`));
  if (!connectionId.trim()) {
    throw new V8ProjectSchemaError('INVALID_CONNECTION_ID', 'Connection profile ID is required', { index });
  }

  const transport = String(input.transport || input.transportKind || '').toUpperCase();
  const serial = input.serial && typeof input.serial === 'object' && !Array.isArray(input.serial) ? clone(input.serial) : null;
  const tcp = input.tcp && typeof input.tcp === 'object' && !Array.isArray(input.tcp) ? clone(input.tcp) : null;
  const metadata = objectOr(input.metadata, {});

  // Persist configuration, never live capability/ownership/armed state.
  return {
    connectionId: connectionId.trim(),
    sourceChannelId,
    name: safeText(input.name, connectionId).slice(0, 200),
    transport,
    transportKind: safeText(input.transportKind, transport ? transport.toLowerCase() : '').slice(0, 80),
    endpoint: input.endpoint == null ? null : safeText(input.endpoint).slice(0, 500),
    serial,
    tcp,
    activation: 'manual',
    ownerMode: SAFE_OWNER_MODE,
    transmitCapability: 'none',
    writeLock: SAFE_WRITE_STATE,
    writesEnabled: false,
    faultInjectionEnabled: false,
    enabled: false,
    metadata,
  };
}

function normalizeUiState(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const theme = ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system';
  const density = ['comfortable', 'compact', 'dense'].includes(source.density) ? source.density : 'comfortable';
  return {
    theme,
    density,
    layout: objectOr(source.layout, {}),
  };
}

function normalizeV8Project(project = {}, { index = 0 } = {}) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new V8ProjectSchemaError('INVALID_PROJECT', 'Project must be an object', { index });
  }
  const projectId = String(project.id || project.projectId || `project-${index + 1}`).trim();
  if (!projectId) throw new V8ProjectSchemaError('INVALID_PROJECT_ID', 'Project ID is required', { index });
  const stamp = isoNow();

  const normalized = {
    ...clone(project),
    id: projectId,
    projectId,
    name: safeText(project.name, 'Untitled Project').slice(0, 200),
    site: safeText(project.site, '').slice(0, 300),
    bus: safeText(project.bus, '').slice(0, 200),
    description: safeText(project.description, '').slice(0, 4000),
    createdAt: project.createdAt || stamp,
    updatedAt: project.updatedAt || stamp,
    channels: objectOr(project.channels, {}),
    devices: objectOr(project.devices, {}),
    registers: objectOr(project.registers, {}),
    discoveryRuns: arrayOr(project.discoveryRuns).slice(-COLLECTION_LIMITS.discoveryRuns),
    legacyUnassigned: objectOr(project.legacyUnassigned, { devices: {}, registers: {} }),
    adoptions: arrayOr(project.adoptions),
    captures: arrayOr(project.captures),
    history: project.history == null ? null : clone(project.history),
    ui: normalizeUiState(project.ui),
  };

  for (const field of V8_ARRAY_FIELDS) normalized[field] = arrayOr(project[field]);
  normalized.connections = normalized.connections.map((connection, connectionIndex) => sanitizeConnectionProfile(connection, { index: connectionIndex }));

  // Old or imported runtime state must never become an armed persisted state.
  delete normalized.writeLock;
  delete normalized.writesEnabled;
  delete normalized.writeEnabled;
  delete normalized.faultInjectionEnabled;
  delete normalized.ownerMode;
  delete normalized.transmitCapability;
  delete normalized.runtimeState;
  delete normalized.activeOwner;
  return normalized;
}

function createEmptyV8Database({ name = 'Default Project' } = {}) {
  const stamp = isoNow();
  const projectId = 'project-default';
  const project = normalizeV8Project({
    id: projectId,
    name,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return {
    schemaVersion: V8_PROJECT_SCHEMA_VERSION,
    activeProjectId: projectId,
    projects: [project],
    profiles: [],
    metadata: {
      createdAt: stamp,
      updatedAt: stamp,
      migration: null,
    },
  };
}

function normalizeV8Database(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new V8ProjectSchemaError('INVALID_DATABASE', 'v8 project database must be an object');
  }
  const version = Number(input.schemaVersion);
  if (version !== V8_PROJECT_SCHEMA_VERSION) {
    throw new V8ProjectSchemaError('UNSUPPORTED_SCHEMA_VERSION', `Expected v8 schema ${V8_PROJECT_SCHEMA_VERSION}, received ${input.schemaVersion}`, {
      expected: V8_PROJECT_SCHEMA_VERSION,
      actual: input.schemaVersion,
    });
  }
  const projects = arrayOr(input.projects).map((project, index) => normalizeV8Project(project, { index }));
  const profiles = arrayOr(input.profiles);
  const activeProjectId = input.activeProjectId == null ? (projects[0]?.id || null) : String(input.activeProjectId);
  const stamp = isoNow();
  return {
    schemaVersion: V8_PROJECT_SCHEMA_VERSION,
    activeProjectId,
    projects,
    profiles,
    metadata: {
      ...objectOr(input.metadata, {}),
      createdAt: input.metadata?.createdAt || stamp,
      updatedAt: input.metadata?.updatedAt || stamp,
      migration: input.metadata?.migration == null ? null : clone(input.metadata.migration),
    },
  };
}

function validateArrayLimit(project, field) {
  const value = project[field];
  if (!Array.isArray(value)) {
    throw new V8ProjectSchemaError('INVALID_COLLECTION', `Project ${project.id} field ${field} must be an array`, { projectId: project.id, field });
  }
  const max = COLLECTION_LIMITS[field];
  if (max && value.length > max) {
    throw new V8ProjectSchemaError('COLLECTION_LIMIT', `Project ${project.id} field ${field} exceeds ${max} items`, {
      projectId: project.id,
      field,
      count: value.length,
      max,
    });
  }
}

function validateConnectionProfile(connection, project, seen) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw new V8ProjectSchemaError('INVALID_CONNECTION_PROFILE', `Project ${project.id} contains an invalid connection profile`);
  }
  if (!connection.connectionId || seen.has(connection.connectionId)) {
    throw new V8ProjectSchemaError('DUPLICATE_CONNECTION_ID', `Project ${project.id} contains a duplicate/invalid connection ID`, {
      projectId: project.id,
      connectionId: connection.connectionId || null,
    });
  }
  seen.add(connection.connectionId);
  if (connection.sourceChannelId != null && !project.channels[connection.sourceChannelId]) {
    throw new V8ProjectSchemaError('UNKNOWN_SOURCE_CHANNEL', `Connection ${connection.connectionId} references an unknown source channel`, {
      projectId: project.id,
      sourceChannelId: connection.sourceChannelId,
    });
  }
  if (connection.ownerMode !== SAFE_OWNER_MODE || connection.transmitCapability !== 'none' || connection.writeLock !== SAFE_WRITE_STATE || connection.writesEnabled !== false || connection.faultInjectionEnabled !== false || connection.enabled !== false || connection.activation !== 'manual') {
    throw new V8ProjectSchemaError('UNSAFE_PERSISTED_CONNECTION_STATE', `Connection ${connection.connectionId} contains live/armed state`, {
      projectId: project.id,
      connectionId: connection.connectionId,
    });
  }
}

function validateV8Database(input) {
  const db = normalizeV8Database(input);
  if (db.projects.length > COLLECTION_LIMITS.projects) {
    throw new V8ProjectSchemaError('COLLECTION_LIMIT', `Database exceeds ${COLLECTION_LIMITS.projects} projects`);
  }
  if (db.profiles.length > COLLECTION_LIMITS.profiles) {
    throw new V8ProjectSchemaError('COLLECTION_LIMIT', `Database exceeds ${COLLECTION_LIMITS.profiles} profiles`);
  }

  const projectIds = new Set();
  for (const project of db.projects) {
    if (projectIds.has(project.id)) {
      throw new V8ProjectSchemaError('DUPLICATE_PROJECT_ID', `Duplicate project ID ${project.id}`, { projectId: project.id });
    }
    projectIds.add(project.id);
    for (const field of V8_ARRAY_FIELDS) validateArrayLimit(project, field);
    validateArrayLimit(project, 'discoveryRuns');

    if (!project.channels || typeof project.channels !== 'object' || Array.isArray(project.channels)) {
      throw new V8ProjectSchemaError('INVALID_CHANNELS', `Project ${project.id} channels must be an object`);
    }
    if (!project.devices || typeof project.devices !== 'object' || Array.isArray(project.devices)) {
      throw new V8ProjectSchemaError('INVALID_DEVICES', `Project ${project.id} devices must be an object`);
    }
    if (!project.registers || typeof project.registers !== 'object' || Array.isArray(project.registers)) {
      throw new V8ProjectSchemaError('INVALID_REGISTERS', `Project ${project.id} registers must be an object`);
    }

    for (const [deviceKey, device] of Object.entries(project.devices)) {
      const parsed = parseDeviceKey(deviceKey);
      if (!parsed || !project.channels[parsed.channelId]) {
        throw new V8ProjectSchemaError('INVALID_DEVICE_KEY', `Project ${project.id} device ${deviceKey} does not resolve to a known channel`, {
          projectId: project.id,
          deviceKey,
        });
      }
      if (device?.deviceKey && device.deviceKey !== deviceKey) {
        throw new V8ProjectSchemaError('DEVICE_KEY_MISMATCH', `Project ${project.id} device record key mismatch`, {
          projectId: project.id,
          deviceKey,
          recordDeviceKey: device.deviceKey,
        });
      }
    }

    const connectionIds = new Set();
    for (const connection of project.connections) validateConnectionProfile(connection, project, connectionIds);
  }

  if (db.activeProjectId != null && !projectIds.has(db.activeProjectId)) {
    throw new V8ProjectSchemaError('INVALID_ACTIVE_PROJECT', `Active project ${db.activeProjectId} does not exist`, {
      activeProjectId: db.activeProjectId,
    });
  }
  return db;
}

module.exports = {
  V8_PROJECT_SCHEMA_VERSION,
  SAFE_OWNER_MODE,
  SAFE_WRITE_STATE,
  COLLECTION_LIMITS,
  V8_ARRAY_FIELDS,
  V8ProjectSchemaError,
  clone,
  createEmptyV8Database,
  normalizeV8Database,
  normalizeV8Project,
  sanitizeConnectionProfile,
  validateV8Database,
};
