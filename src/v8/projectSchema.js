'use strict';

const crypto = require('node:crypto');
const { normalizeFeatureFlags } = require('./featureFlags');
const { assertUniqueConnectionProfiles } = require('./connectionProfiles');

const V8_WORKSPACE_FORMAT = 'modbus-engineering-workbench';
const V8_PROJECT_FORMAT = 'modbus-engineering-project';
const V8_SCHEMA_VERSION = 1;
const V8_PRODUCT_MAJOR = 8;

class ProjectSchemaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectSchemaError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ProjectSchemaError);
  }
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function iso(value = null) {
  if (value == null) return new Date().toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ProjectSchemaError('INVALID_TIMESTAMP', `Invalid timestamp: ${value}`, { value });
  return date.toISOString();
}

function string(value, field, max, { allowEmpty = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (!allowEmpty && !normalized) throw new ProjectSchemaError('INVALID_PROJECT', `${field} is required`, { field });
  if (normalized.length > max) throw new ProjectSchemaError('INVALID_PROJECT', `${field} exceeds ${max} characters`, { field, max });
  return normalized;
}

function object(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ProjectSchemaError('INVALID_PROJECT', `${field} must be an object`, { field });
  return cloneJson(value);
}

function array(value, field, max = 100000) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ProjectSchemaError('INVALID_PROJECT', `${field} must be an array`, { field });
  if (value.length > max) throw new ProjectSchemaError('PROJECT_LIMIT_EXCEEDED', `${field} exceeds ${max} entries`, { field, max, count: value.length });
  return cloneJson(value);
}

function safeRuntimeState() {
  return Object.freeze({
    writeArmed: false,
    faultInjectionArmed: false,
    activeConnectionId: null,
    activeOwnerMode: null,
  });
}

function defaultPreferences(input = {}) {
  const theme = ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system';
  const density = ['comfortable', 'compact', 'dense'].includes(input.density) ? input.density : 'comfortable';
  const addressBase = input.addressBase === 1 ? 1 : 0;
  return Object.freeze({ theme, density, addressBase });
}

function createV8Project(input = {}) {
  const stamp = iso(input.createdAt ?? null);
  const updatedAt = iso(input.updatedAt ?? stamp);
  const projectId = string(input.projectId ?? input.id ?? id('project'), 'projectId', 180);
  const connectionProfiles = assertUniqueConnectionProfiles(input.connectionProfiles ?? input.connections?.profiles ?? []);

  return Object.freeze({
    format: V8_PROJECT_FORMAT,
    schemaVersion: V8_SCHEMA_VERSION,
    productMajor: V8_PRODUCT_MAJOR,
    projectId,
    name: string(input.name ?? 'Untitled Project', 'name', 120),
    site: string(input.site ?? '', 'site', 200, { allowEmpty: true }),
    bus: string(input.bus ?? '', 'bus', 120, { allowEmpty: true }),
    description: string(input.description ?? '', 'description', 2000, { allowEmpty: true }),
    createdAt: stamp,
    updatedAt,
    preferences: defaultPreferences(input.preferences),
    featureFlags: normalizeFeatureFlags(input.featureFlags ?? {}),
    runtime: safeRuntimeState(),
    connections: Object.freeze({ profiles: connectionProfiles }),
    topology: Object.freeze({
      channels: Object.freeze(object(input.topology?.channels ?? input.channels, 'topology.channels')),
      devices: Object.freeze(object(input.topology?.devices ?? input.devices, 'topology.devices')),
    }),
    registerMappings: Object.freeze(object(input.registerMappings ?? input.registers, 'registerMappings')),
    engineeringProfiles: Object.freeze(array(input.engineeringProfiles ?? input.profiles, 'engineeringProfiles', 10000)),
    evidence: Object.freeze({
      discoveryRuns: Object.freeze(array(input.evidence?.discoveryRuns ?? input.discoveryRuns, 'evidence.discoveryRuns', 1000)),
      captures: Object.freeze(array(input.evidence?.captures, 'evidence.captures', 10000)),
    }),
    workspaces: Object.freeze({
      master: Object.freeze({
        documents: Object.freeze(array(input.workspaces?.master?.documents, 'workspaces.master.documents', 10000)),
        pollJobs: Object.freeze(array(input.workspaces?.master?.pollJobs, 'workspaces.master.pollJobs', 100000)),
      }),
      simulator: Object.freeze({
        servers: Object.freeze(array(input.workspaces?.simulator?.servers, 'workspaces.simulator.servers', 10000)),
      }),
      testCenter: Object.freeze({ recipes: Object.freeze(array(input.workspaces?.testCenter?.recipes, 'workspaces.testCenter.recipes', 10000)) }),
      charts: Object.freeze(array(input.workspaces?.charts, 'workspaces.charts', 10000)),
      logger: Object.freeze(array(input.workspaces?.logger, 'workspaces.logger', 10000)),
    }),
    migration: Object.freeze(object(input.migration, 'migration')),
    legacy: Object.freeze(object(input.legacy, 'legacy')),
  });
}

function validateV8Project(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectSchemaError('INVALID_PROJECT', 'Project must be an object');
  if (input.format !== V8_PROJECT_FORMAT) throw new ProjectSchemaError('UNSUPPORTED_PROJECT_FORMAT', `Expected ${V8_PROJECT_FORMAT}`, { format: input.format });
  if (Number(input.schemaVersion) !== V8_SCHEMA_VERSION) throw new ProjectSchemaError('UNSUPPORTED_PROJECT_SCHEMA', `Unsupported project schema version ${input.schemaVersion}`, { schemaVersion: input.schemaVersion });
  if (Number(input.productMajor) !== V8_PRODUCT_MAJOR) throw new ProjectSchemaError('UNSUPPORTED_PRODUCT_MAJOR', `Unsupported product major ${input.productMajor}`, { productMajor: input.productMajor });
  createV8Project(input);
  return true;
}

function loadV8Project(input) {
  validateV8Project(input);
  // Re-normalization deliberately discards persisted live capability state.
  return createV8Project({ ...cloneJson(input), runtime: safeRuntimeState() });
}

function createV8Workspace(input = {}) {
  const projects = array(input.projects, 'projects', 5000).map((project) => {
    if (project?.format === V8_PROJECT_FORMAT) return loadV8Project(project);
    return createV8Project(project);
  });
  const seen = new Set();
  for (const project of projects) {
    if (seen.has(project.projectId)) throw new ProjectSchemaError('DUPLICATE_PROJECT_ID', `Duplicate projectId ${project.projectId}`, { projectId: project.projectId });
    seen.add(project.projectId);
  }
  const activeProjectId = input.activeProjectId == null ? (projects[0]?.projectId ?? null) : String(input.activeProjectId);
  if (activeProjectId != null && !seen.has(activeProjectId)) throw new ProjectSchemaError('ACTIVE_PROJECT_NOT_FOUND', `Active project ${activeProjectId} is not present`, { activeProjectId });
  return Object.freeze({
    format: V8_WORKSPACE_FORMAT,
    schemaVersion: V8_SCHEMA_VERSION,
    productMajor: V8_PRODUCT_MAJOR,
    workspaceId: string(input.workspaceId ?? id('workspace'), 'workspaceId', 180),
    createdAt: iso(input.createdAt ?? null),
    updatedAt: iso(input.updatedAt ?? input.createdAt ?? null),
    activeProjectId,
    featureFlags: normalizeFeatureFlags(input.featureFlags ?? {}),
    projects: Object.freeze(projects),
    migration: Object.freeze(object(input.migration, 'migration')),
  });
}

function validateV8Workspace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectSchemaError('INVALID_WORKSPACE', 'Workspace must be an object');
  if (input.format !== V8_WORKSPACE_FORMAT) throw new ProjectSchemaError('UNSUPPORTED_WORKSPACE_FORMAT', `Expected ${V8_WORKSPACE_FORMAT}`, { format: input.format });
  if (Number(input.schemaVersion) !== V8_SCHEMA_VERSION) throw new ProjectSchemaError('UNSUPPORTED_WORKSPACE_SCHEMA', `Unsupported workspace schema version ${input.schemaVersion}`, { schemaVersion: input.schemaVersion });
  if (Number(input.productMajor) !== V8_PRODUCT_MAJOR) throw new ProjectSchemaError('UNSUPPORTED_PRODUCT_MAJOR', `Unsupported product major ${input.productMajor}`, { productMajor: input.productMajor });
  createV8Workspace(input);
  return true;
}

function loadV8Workspace(input) {
  validateV8Workspace(input);
  return createV8Workspace(cloneJson(input));
}

function pickUnknown(source, knownKeys) {
  const unknown = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!knownKeys.has(key)) unknown[key] = cloneJson(value);
  }
  return unknown;
}

function migrateV7Workspace(v7Workspace, { featureFlags = {} } = {}) {
  if (!v7Workspace || typeof v7Workspace !== 'object' || Array.isArray(v7Workspace)) {
    throw new ProjectSchemaError('INVALID_V7_WORKSPACE', 'v7 workspace must be an object');
  }
  if (Number(v7Workspace.version) !== 2) {
    throw new ProjectSchemaError('UNSUPPORTED_V7_WORKSPACE_VERSION', `Only v7 workspace schema version 2 can migrate directly, received ${v7Workspace.version}`, { version: v7Workspace.version });
  }
  if (!Array.isArray(v7Workspace.projects) || !Array.isArray(v7Workspace.profiles)) {
    throw new ProjectSchemaError('INVALID_V7_WORKSPACE', 'v7 workspace must contain projects and profiles arrays');
  }

  const projectKnown = new Set(['id', 'name', 'site', 'bus', 'description', 'createdAt', 'updatedAt', 'channels', 'devices', 'registers', 'discoveryRuns', 'legacyUnassigned']);
  const workspaceKnown = new Set(['version', 'activeProjectId', 'projects', 'profiles']);
  const migratedAt = new Date().toISOString();
  const projects = v7Workspace.projects.map((source) => createV8Project({
    projectId: source.id,
    name: source.name,
    site: source.site,
    bus: source.bus,
    description: source.description,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    featureFlags,
    channels: source.channels,
    devices: source.devices,
    registers: source.registers,
    engineeringProfiles: v7Workspace.profiles,
    discoveryRuns: source.discoveryRuns,
    migration: {
      source: 'v7-workspace-store',
      sourceSchemaVersion: 2,
      migratedAt,
      policy: 'Identity-bearing v7 data is preserved verbatim; live write/fault state is never migrated.',
    },
    legacy: {
      unassigned: cloneJson(source.legacyUnassigned ?? {}),
      unmappedProjectFields: pickUnknown(source, projectKnown),
    },
  }));

  const oldActive = v7Workspace.activeProjectId == null ? null : String(v7Workspace.activeProjectId);
  const activeProjectId = projects.some((project) => project.projectId === oldActive) ? oldActive : (projects[0]?.projectId ?? null);
  const workspace = createV8Workspace({
    workspaceId: id('workspace'),
    activeProjectId,
    featureFlags,
    projects,
    migration: {
      source: 'v7-workspace-store',
      sourceSchemaVersion: 2,
      migratedAt,
      projectCount: projects.length,
      engineeringProfileCount: v7Workspace.profiles.length,
      unmappedWorkspaceFields: pickUnknown(v7Workspace, workspaceKnown),
    },
  });

  return Object.freeze({
    workspace,
    report: Object.freeze({
      from: 'v7-workspace-store-v2',
      to: `${V8_WORKSPACE_FORMAT}-v${V8_SCHEMA_VERSION}`,
      migratedAt,
      projectCount: projects.length,
      activeProjectId,
      safetyReset: true,
      noSilentLossPolicy: true,
    }),
  });
}

module.exports = {
  V8_WORKSPACE_FORMAT,
  V8_PROJECT_FORMAT,
  V8_SCHEMA_VERSION,
  V8_PRODUCT_MAJOR,
  ProjectSchemaError,
  safeRuntimeState,
  defaultPreferences,
  createV8Project,
  validateV8Project,
  loadV8Project,
  createV8Workspace,
  validateV8Workspace,
  loadV8Workspace,
  migrateV7Workspace,
};
