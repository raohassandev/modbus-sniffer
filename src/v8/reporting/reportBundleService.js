'use strict';

const crypto = require('node:crypto');
const archiver = require('archiver');

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

function json(value) {
  return `${JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current, 2)}\n`;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function objectRows(input, keyName) {
  return Object.entries(input || {}).map(([key, value]) => ({ [keyName]: key, ...(value && typeof value === 'object' ? value : { value }) }));
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
    let historianTags = [];
    try { master = this.masterWorkspace?.snapshot(projectId) || null; } catch { master = null; }
    try { writeAudit = this.masterWorkspace?.audit({ limit: 10000 }) || []; } catch { writeAudit = []; }
    try { historianTags = this.history?.historianTags(projectId) || []; } catch { historianTags = []; }
    const traffic = active && this.timeline ? this.timeline.query({ limit: 5000 }) : [];
    return { generatedAt: new Date().toISOString(), schemaVersion: this.store.exportAll().schemaVersion, project, active, master, writeAudit, historianTags, traffic };
  }

  buildFiles(projectId) {
    const model = this.collect(projectId);
    const files = new Map();
    const devices = objectRows(model.project.devices, 'deviceKey');
    const registers = objectRows(model.project.registers, 'registerKey');
    files.set('project/project.json', Buffer.from(json(model.project)));
    files.set('reports/master-summary.json', Buffer.from(json(model.master || { available: false })));
    files.set('reports/write-audit.json', Buffer.from(json(model.writeAudit)));
    files.set('reports/traffic.json', Buffer.from(json(model.traffic)));
    files.set('reports/devices.csv', Buffer.from(csv(devices, ['deviceKey','deviceKey','channelId','unitId','slaveId','name','manufacturer','model','revision'])));
    files.set('reports/registers.csv', Buffer.from(csv(registers, ['registerKey','channelId','deviceKey','unitId','slaveId','functionCode','address','name','type','dataType','byteOrder','scale','offset','unit'])));
    files.set('reports/simulator-model.json', Buffer.from(json({ servers: model.project.slaveServers || [], devices: model.project.virtualDevices || [] })));
    files.set('reports/recipes.json', Buffer.from(json(model.project.testRecipes || [])));
    files.set('reports/historian.json', Buffer.from(json({ tags: model.historianTags, loggerProfiles: model.project.loggerProfiles || [], charts: model.project.charts || [] })));
    files.set('reports/hmi-pages.json', Buffer.from(json(model.project.hmiScreens || [])));
    files.set('reports/digital-twins.json', Buffer.from(json(model.project.digitalTwins || [])));
    const manifest = {
      format: 'modbus-workbench-v8-handover', formatVersion: 1,
      product: 'Modbus Engineering Workbench', productVersion: '8.0.0-rc',
      schemaVersion: model.schemaVersion, generatedAt: model.generatedAt,
      projectId: model.project.id, projectName: model.project.name,
      activeProjectAtExport: model.active, formulaInjectionProtection: true, filenameSanitization: true,
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

module.exports = { ReportBundleError, ReportBundleService, safeName, spreadsheetSafeText, csv, sha256 };