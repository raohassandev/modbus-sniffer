'use strict';

const crypto = require('node:crypto');
const archiver = require('archiver');
const { PRODUCT_NAME, PRODUCT_VERSION } = require('../version');

class ReportBundleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReportBundleError';
    this.code = code;
    this.details = { ...details };
  }
}

function safeName(value, fallback = 'project') {
  let text = String(value || fallback).normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
  if (!text) text = fallback;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(text)) text = `_${text}`;
  return text.slice(0, 120);
}

function spreadsheetSafeText(value) {
  const text = value == null ? '' : String(value);
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const plain = value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : value);
  const text = spreadsheetSafeText(plain);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows, keys) {
  const header = keys.map(csvCell).join(',');
  const body = rows.map((row) => keys.map((key) => csvCell(row?.[key])).join(',')).join('\r\n');
  return `${header}\r\n${body}${body ? '\r\n' : ''}`;
}

function autoCsv(rows, preferred = []) {
  const keys = [...preferred];
  const seen = new Set(keys);
  for (const row of rows || []) {
    for (const key of Object.keys(row || {})) if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  return csv(rows || [], keys);
}

function json(value) {
  return `${JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current, 2)}\n`;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function objectRows(input, keyName) {
  return Object.entries(input || {}).map(([key, value]) => ({ [keyName]: key, ...(value && typeof value === 'object' ? value : { value }) }));
}

const SENSITIVE_FIELD_NAMES = new Set([
  'password', 'passphrase', 'secret', 'clientsecret', 'apikey', 'token', 'accesstoken', 'refreshtoken',
  'privatekey', 'privatekeypem', 'keypem', 'keypath',
]);

function redactSensitive(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, current] of Object.entries(value)) {
    if (SENSITIVE_FIELD_NAMES.has(String(key).replace(/[^A-Za-z0-9]/g, '').toLowerCase())) {
      output[key] = current == null || current === '' ? current : '[REDACTED]';
    } else {
      output[key] = redactSensitive(current);
    }
  }
  return output;
}

function configuredHistorianTags(project) {
  return (project.loggerProfiles || [])
    .filter((profile) => profile?.historian !== false)
    .map((profile) => ({
      tagId: String(profile.streamId || ''),
      name: String(profile.label || profile.streamId || ''),
      unit: profile.unit == null ? null : String(profile.unit),
      source: { sourceKey: String(profile.sourceKey || '') },
      configured: true,
    }))
    .filter((tag) => tag.tagId);
}

class ReportBundleService {
  constructor({ store, masterWorkspace = null, timeline = null, history = null } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.masterWorkspace = masterWorkspace;
    this.timeline = timeline;
    this.history = history;
  }

  collect(projectId = this.store.getActiveProject()?.id) {
    const project = this.store.getProject(projectId);
    if (!project) throw new ReportBundleError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const active = this.store.getActiveProject()?.id === projectId;
    let master = null;
    let writeAudit = [];
    let historianTags = configuredHistorianTags(project);

    if (active) {
      try { master = this.masterWorkspace?.snapshot(projectId) || null; } catch { master = null; }
      try { writeAudit = this.masterWorkspace?.audit({ limit: 10000 }) || []; } catch { writeAudit = []; }
      try { historianTags = this.history?.historianTags(projectId) || historianTags; } catch { /* keep configured tags */ }
    }
    const traffic = active && this.timeline ? this.timeline.query({ limit: 5000 }) : [];
    return { generatedAt: new Date().toISOString(), schemaVersion: this.store.exportAll().schemaVersion, project, active, master, writeAudit, historianTags, traffic };
  }

  buildFiles(projectId) {
    const model = this.collect(projectId);
    const files = new Map();
    const safeProject = redactSensitive(model.project);
    const safeMaster = redactSensitive(model.master || { available: false, reason: model.active ? 'runtime unavailable' : 'project is not active' });
    const safeWriteAudit = redactSensitive(model.writeAudit);
    const safeTraffic = redactSensitive(model.traffic);
    const safeHistorianTags = redactSensitive(model.historianTags);
    const devices = objectRows(safeProject.devices, 'deviceKey');
    const registers = objectRows(safeProject.registers, 'registerKey');
    files.set('project/project.json', Buffer.from(json(safeProject)));
    files.set('reports/master-summary.json', Buffer.from(json(safeMaster)));
    files.set('reports/write-audit.json', Buffer.from(json(safeWriteAudit)));
    files.set('reports/write-audit.csv', Buffer.from(autoCsv(safeWriteAudit, ['timestamp','auditId','connectionId','unitId','functionCode','address','quantity','result','requestRawHex','responseRawHex'])));
    files.set('reports/traffic.json', Buffer.from(json(safeTraffic)));
    files.set('reports/traffic.csv', Buffer.from(autoCsv(safeTraffic, ['sequence','timestamp','eventId','type','source','connectionId','channelId','ownerMode','direction','unitId','functionCode','error','rawHex'])));
    files.set('reports/devices.csv', Buffer.from(csv(devices, ['deviceKey','channelId','unitId','slaveId','name','manufacturer','model','revision'])));
    files.set('reports/registers.csv', Buffer.from(csv(registers, ['registerKey','channelId','deviceKey','unitId','slaveId','functionCode','address','name','type','dataType','byteOrder','scale','offset','unit'])));
    files.set('reports/simulator-model.json', Buffer.from(json({ servers: safeProject.slaveServers || [], devices: safeProject.virtualDevices || [] })));
    files.set('reports/recipes.json', Buffer.from(json(safeProject.testRecipes || [])));
    files.set('reports/historian.json', Buffer.from(json({ tags: safeHistorianTags, loggerProfiles: safeProject.loggerProfiles || [], charts: safeProject.charts || [] })));
    files.set('reports/hmi-pages.json', Buffer.from(json({ screens: safeProject.hmiScreens || [], templates: safeProject.hmiTemplates || [] })));
    files.set('reports/digital-twins.json', Buffer.from(json(safeProject.digitalTwins || [])));
    files.set('reports/automation.json', Buffer.from(json(safeProject.automation || [])));
    const manifest = {
      format: 'modbus-workbench-v8-handover', formatVersion: 1,
      product: PRODUCT_NAME, productVersion: PRODUCT_VERSION,
      schemaVersion: model.schemaVersion, generatedAt: model.generatedAt,
      projectId: model.project.id, projectName: model.project.name,
      activeProjectAtExport: model.active, formulaInjectionProtection: true, filenameSanitization: true, secretRedaction: true,
      boundedRuntimeEvidence: { trafficRows: model.traffic.length, writeAuditRows: model.writeAudit.length },
      files: [...files].map(([name, content]) => ({ name, bytes: content.length, sha256: sha256(content) })),
    };
    files.set('manifest.json', Buffer.from(json(manifest)));
    return { model, files, manifest };
  }

  streamBundle(res, projectId) {
    const built = this.buildFiles(projectId);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(built.model.project.name)}-v8-handover.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => res.destroy(error));
    archive.pipe(res);
    for (const [name, content] of built.files) archive.append(content, { name });
    archive.finalize();
    return built.manifest;
  }
}

module.exports = { ReportBundleError, ReportBundleService, safeName, spreadsheetSafeText, csv, autoCsv, sha256, redactSensitive, configuredHistorianTags };
