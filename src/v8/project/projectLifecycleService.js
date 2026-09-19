'use strict';

const crypto = require('node:crypto');
const { clone, normalizeV8Project } = require('./schema');
const { V8ProjectStoreError } = require('./projectStore');

const PROJECT_TEMPLATE_KIND = 'project-template';
const TEMPLATE_LIMIT = 1000;

class ProjectLifecycleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProjectLifecycleError';
    this.code = code;
    this.details = { ...details };
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function safeText(value, fallback = '', max = 300) {
  return String(value ?? fallback).trim().slice(0, max);
}

function configurationSnapshot(project) {
  const normalized = normalizeV8Project(project);
  return Object.freeze({
    site: normalized.site,
    bus: normalized.bus,
    description: normalized.description,
    channels: clone(normalized.channels),
    devices: clone(normalized.devices),
    registers: clone(normalized.registers),
    connections: clone(normalized.connections),
    masterJobs: clone(normalized.masterJobs),
    slaveServers: clone(normalized.slaveServers),
    virtualDevices: clone(normalized.virtualDevices),
    testRecipes: clone(normalized.testRecipes),
    charts: clone(normalized.charts),
    loggerProfiles: clone(normalized.loggerProfiles),
    digitalTwins: clone(normalized.digitalTwins),
    automation: clone(normalized.automation),
    hmiScreens: clone(normalized.hmiScreens),
    hmiTemplates: clone(normalized.hmiTemplates),
    ui: clone(normalized.ui),
  });
}

class ProjectLifecycleService {
  constructor({ store } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
  }

  cloneProject(projectId, { name = null, site = null, bus = null, activate = false } = {}) {
    const source = this.store.getProject(projectId);
    if (!source) throw new ProjectLifecycleError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const snapshot = configurationSnapshot(source);
    const created = this.store.createProject({
      ...snapshot,
      name: safeText(name, `${source.name} Copy`, 200) || `${source.name} Copy`,
      site: site == null ? snapshot.site : safeText(site, '', 300),
      bus: bus == null ? snapshot.bus : safeText(bus, '', 200),
    });
    if (activate) this.store.setActiveProject(created.id);
    return Object.freeze({ project: this.store.getProject(created.id), sourceProjectId: projectId, active: Boolean(activate) });
  }

  listTemplates() {
    const db = this.store.exportAll();
    return Object.freeze((db.profiles || [])
      .filter((entry) => entry?.kind === PROJECT_TEMPLATE_KIND)
      .map((entry) => Object.freeze(clone(entry))));
  }

  getTemplate(templateId) {
    const template = this.listTemplates().find((entry) => entry.templateId === templateId);
    if (!template) throw new ProjectLifecycleError('TEMPLATE_NOT_FOUND', `Project template ${templateId} was not found`, { templateId });
    return template;
  }

  saveTemplate({ templateId = null, projectId = null, name = null, description = '' } = {}) {
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    if (!project) throw new ProjectLifecycleError('PROJECT_NOT_FOUND', `Project ${projectId || '(active)'} was not found`, { projectId });
    const db = this.store.exportAll();
    const id = safeText(templateId, uid('project-template'), 160) || uid('project-template');
    const existingIndex = (db.profiles || []).findIndex((entry) => entry?.kind === PROJECT_TEMPLATE_KIND && entry.templateId === id);
    const existing = existingIndex >= 0 ? db.profiles[existingIndex] : null;
    const now = new Date().toISOString();
    const record = Object.freeze({
      kind: PROJECT_TEMPLATE_KIND,
      templateId: id,
      name: safeText(name, existing?.name || `${project.name} Template`, 200) || `${project.name} Template`,
      description: safeText(description, existing?.description || '', 1000),
      sourceProjectId: project.id,
      schemaVersion: db.schemaVersion,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      configuration: configurationSnapshot(project),
    });
    if (existingIndex >= 0) db.profiles[existingIndex] = record;
    else db.profiles.push(record);
    if (db.profiles.filter((entry) => entry?.kind === PROJECT_TEMPLATE_KIND).length > TEMPLATE_LIMIT) {
      throw new ProjectLifecycleError('TEMPLATE_LIMIT', `Project template count exceeds ${TEMPLATE_LIMIT}`);
    }
    this.store.importAll(db, { allowV7Migration: false });
    return this.getTemplate(id);
  }

  removeTemplate(templateId) {
    const db = this.store.exportAll();
    const before = db.profiles.length;
    db.profiles = db.profiles.filter((entry) => !(entry?.kind === PROJECT_TEMPLATE_KIND && entry.templateId === templateId));
    if (db.profiles.length === before) return false;
    this.store.importAll(db, { allowV7Migration: false });
    return true;
  }

  previewTemplate(templateId, { name = null, site = null, bus = null } = {}) {
    const template = this.getTemplate(templateId);
    const configuration = clone(template.configuration || {});
    const project = normalizeV8Project({
      ...configuration,
      id: 'preview-project',
      name: safeText(name, template.name, 200) || template.name,
      site: site == null ? configuration.site : safeText(site, '', 300),
      bus: bus == null ? configuration.bus : safeText(bus, '', 200),
    });
    return Object.freeze({
      templateId,
      templateName: template.name,
      project: Object.freeze({ ...project, id: null, projectId: null, createdAt: null, updatedAt: null }),
      counts: Object.freeze({
        connections: project.connections.length,
        masterJobs: project.masterJobs.length,
        slaveServers: project.slaveServers.length,
        virtualDevices: project.virtualDevices.length,
        testRecipes: project.testRecipes.length,
        charts: project.charts.length,
        loggerProfiles: project.loggerProfiles.length,
        hmiScreens: project.hmiScreens.length,
        hmiTemplates: project.hmiTemplates.length,
      }),
    });
  }

  applyTemplate(templateId, options = {}) {
    const preview = this.previewTemplate(templateId, options);
    const template = this.getTemplate(templateId);
    const configuration = clone(template.configuration || {});
    const created = this.store.createProject({
      ...configuration,
      name: safeText(options.name, template.name, 200) || template.name,
      site: options.site == null ? configuration.site : safeText(options.site, '', 300),
      bus: options.bus == null ? configuration.bus : safeText(options.bus, '', 200),
    });
    if (options.activate) this.store.setActiveProject(created.id);
    return Object.freeze({
      project: this.store.getProject(created.id),
      templateId,
      preview: preview.counts,
      active: Boolean(options.activate),
    });
  }
}

function lifecycleHttpStatus(error) {
  if (error instanceof V8ProjectStoreError && error.code === 'PROJECT_NOT_FOUND') return 404;
  if (['PROJECT_NOT_FOUND', 'TEMPLATE_NOT_FOUND'].includes(error?.code)) return 404;
  if (['TEMPLATE_LIMIT'].includes(error?.code)) return 409;
  return 400;
}

module.exports = {
  PROJECT_TEMPLATE_KIND,
  ProjectLifecycleError,
  ProjectLifecycleService,
  configurationSnapshot,
  lifecycleHttpStatus,
};
