'use strict';

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { createWorkbenchEvent } = require('../events');

const AREAS = Object.freeze(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']);
const MAX_TWINS = 1000;
const MAX_SOURCE_POINTS = 100000;

class DigitalTwinError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DigitalTwinError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, DigitalTwinError);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function id(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function text(value, field, { optional = false } = {}) {
  const out = String(value ?? '').trim();
  if (!out && !optional) throw new DigitalTwinError('INVALID_TWIN', `${field} is required`, { field });
  return out;
}

function inferFraming(project, connectionId) {
  const profile = (project.connections || []).find((entry) => entry.connectionId === connectionId);
  const kind = String(profile?.transportKind || profile?.transport || '').toLowerCase();
  if (kind.includes('ascii')) return 'ascii';
  if (kind.includes('rtu') || kind.includes('serial')) return 'rtu';
  return 'tcp';
}

function normalizeWritableAreas(value = {}) {
  if (value == null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new DigitalTwinError('INVALID_TWIN', 'writableAreas must be an object');
  return Object.freeze({
    coils: value.coils === true,
    discreteInputs: false,
    holdingRegisters: value.holdingRegisters === true,
    inputRegisters: false,
  });
}

function pointConfidence(point) {
  const raw = point.definition?.provenance?.confidence;
  const confidence = Number(raw);
  if (Number.isFinite(confidence)) return Math.max(0, Math.min(1, confidence));
  return point.definition ? 0.9 : 0.5;
}

function contiguousSegments(points) {
  const sorted = [...points].sort((a, b) => a.address - b.address);
  const segments = [];
  let current = null;
  for (const point of sorted) {
    const value = point.area === 'coils' || point.area === 'discreteInputs'
      ? Boolean(point.rawValue)
      : Number(point.rawValue);
    if (point.area !== 'coils' && point.area !== 'discreteInputs' && (!Number.isInteger(value) || value < 0 || value > 0xFFFF)) continue;
    if (!current || current.address + current.values.length !== point.address) {
      current = { address: point.address, values: [value] };
      segments.push(current);
    } else {
      current.values.push(value);
    }
  }
  return segments;
}

function buildDevice(unitId, points, { serverId, writableAreas, identity = {} }) {
  const byArea = Object.fromEntries(AREAS.map((area) => [area, points.filter((point) => point.area === area)]));
  const sizes = {};
  const memory = {};
  const pointDefinitions = [];
  let uncertainCount = 0;

  for (const area of AREAS) {
    const rows = byArea[area];
    sizes[area] = rows.length ? Math.min(65536, Math.max(...rows.map((point) => point.address)) + 1) : 0;
    memory[area] = contiguousSegments(rows);
    for (const point of rows) {
      const confidence = pointConfidence(point);
      const inferred = !point.definition || point.definition?.provenance?.inferred === true;
      const uncertain = inferred || confidence < 0.8;
      if (uncertain) uncertainCount += 1;
      pointDefinitions.push({
        area,
        address: point.address,
        sourceKey: point.sourceKey,
        rawValue: point.rawValue,
        definition: clone(point.definition),
        confidence,
        inferred,
        uncertain,
        evidence: {
          sampleCount: point.sampleCount,
          firstSeen: point.firstSeen,
          lastSeen: point.lastSeen,
          requestEventId: point.requestEventId || null,
          responseEventId: point.responseEventId || null,
        },
      });
    }
  }

  return {
    deviceId: `${serverId}:unit:${unitId}`,
    serverId,
    unitId,
    name: `Captured Unit ${unitId}`,
    sizes,
    identity: clone(identity),
    memory,
    generators: [],
    writableAreas: clone(writableAreas),
    metadata: {
      generatedBy: 'capture-to-digital-twin',
      safeDefault: !writableAreas.coils && !writableAreas.holdingRegisters ? 'read-only' : 'explicit-writable-areas',
      pointDefinitions,
      uncertainCount,
    },
  };
}

class DigitalTwinService extends EventEmitter {
  constructor({ store, registerLab, simulator } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!registerLab) throw new TypeError('registerLab is required');
    if (!simulator) throw new TypeError('simulator is required');
    this.store = store;
    this.registerLab = registerLab;
    this.simulator = simulator;
  }

  list() {
    const project = this._project();
    return Object.freeze(clone(Array.isArray(project.digitalTwins) ? project.digitalTwins : []));
  }

  get(twinId) {
    const twin = this._twins().find((entry) => entry.twinId === twinId);
    if (!twin) throw new DigitalTwinError('TWIN_NOT_FOUND', `Digital twin ${twinId} was not found`, { twinId });
    return Object.freeze(clone(twin));
  }

  preview(options = {}) {
    const project = this._project();
    const sourceConnectionId = text(options.sourceConnectionId, 'sourceConnectionId');
    const targetConnectionId = text(options.targetConnectionId, 'targetConnectionId', { optional: true }) || null;
    const requestedUnits = Array.isArray(options.unitIds)
      ? new Set(options.unitIds.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 255))
      : null;
    const writableAreas = normalizeWritableAreas(options.writableAreas);
    const pointLimit = Math.min(MAX_SOURCE_POINTS, Math.max(1, Number(this.registerLab.maxPoints) || MAX_SOURCE_POINTS));
    const points = this.registerLab.list({ connectionId: sourceConnectionId, limit: pointLimit })
      .filter((point) => !requestedUnits || requestedUnits.has(point.unitId));
    if (!points.length) throw new DigitalTwinError('NO_SOURCE_POINTS', `No captured Register Lab points exist for ${sourceConnectionId}`, { sourceConnectionId });

    const serverId = text(options.serverId, 'serverId', { optional: true }) || `twin-server-${Date.now().toString(36)}`;
    const framing = ['rtu', 'ascii', 'tcp'].includes(String(options.framing || '').toLowerCase())
      ? String(options.framing).toLowerCase()
      : inferFraming(project, sourceConnectionId);
    const identityByUnit = options.identityByUnit && typeof options.identityByUnit === 'object' && !Array.isArray(options.identityByUnit)
      ? options.identityByUnit
      : {};
    const grouped = new Map();
    for (const point of points) {
      if (!grouped.has(point.unitId)) grouped.set(point.unitId, []);
      grouped.get(point.unitId).push(point);
    }
    const devices = [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([unitId, unitPoints]) => buildDevice(unitId, unitPoints, {
        serverId,
        writableAreas,
        identity: identityByUnit[String(unitId)] || {},
      }));
    const uncertainPoints = devices.reduce((sum, device) => sum + device.metadata.uncertainCount, 0);

    return Object.freeze({
      twinId: options.twinId || null,
      name: String(options.name || `Digital Twin of ${sourceConnectionId}`).slice(0, 200),
      status: 'draft',
      createdAt: options.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: {
        projectId: project.id,
        connectionId: sourceConnectionId,
        capturedPointCount: points.length,
        unitIds: [...grouped.keys()].sort((a, b) => a - b),
        provenance: 'register-lab-live-evidence',
      },
      target: {
        connectionId: targetConnectionId,
        serverId,
        framing,
        receivePollMs: Number.isInteger(Number(options.receivePollMs)) ? Math.max(1, Math.min(60000, Number(options.receivePollMs))) : 25,
      },
      safety: {
        writableAreas: clone(writableAreas),
        requiresReviewBeforeRun: true,
        approved: false,
      },
      devices,
      quality: {
        totalPoints: points.length,
        uncertainPoints,
        confirmedOrHighConfidencePoints: points.length - uncertainPoints,
      },
    });
  }

  saveDraft(options = {}) {
    const project = this._project();
    const existingId = String(options.twinId || '').trim();
    const existing = existingId ? this._twins().find((entry) => entry.twinId === existingId) || null : null;
    const preview = this.preview({ ...options, twinId: existing?.twinId || existingId || id('twin'), createdAt: existing?.createdAt });
    const record = { ...clone(preview), twinId: preview.twinId || existingId || id('twin') };
    const twins = this._twins();
    const index = twins.findIndex((entry) => entry.twinId === record.twinId);
    if (index >= 0) twins[index] = record;
    else twins.push(record);
    if (twins.length > MAX_TWINS) throw new DigitalTwinError('TWIN_LIMIT', `Digital twin limit ${MAX_TWINS} exceeded`);
    this.store.updateProject(project.id, { digitalTwins: twins });
    this._emit('digital-twin.draft-saved', record, { status: record.status });
    return this.get(record.twinId);
  }

  retarget(twinId, patch = {}) {
    const project = this._project();
    const twin = clone(this.get(twinId));
    if (!['draft', 'applied-review-required'].includes(twin.status)) {
      throw new DigitalTwinError('TWIN_ALREADY_APPROVED', 'Approved digital twins cannot be retargeted; create a new draft instead', { twinId, status: twin.status });
    }
    const target = { ...twin.target };
    if (Object.prototype.hasOwnProperty.call(patch, 'targetConnectionId')) target.connectionId = text(patch.targetConnectionId, 'targetConnectionId', { optional: true }) || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'serverId')) target.serverId = text(patch.serverId, 'serverId');
    if (Object.prototype.hasOwnProperty.call(patch, 'framing')) {
      const framing = String(patch.framing || '').toLowerCase();
      if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new DigitalTwinError('INVALID_TWIN', 'framing must be rtu, ascii or tcp', { framing });
      target.framing = framing;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'receivePollMs')) {
      const value = Number(patch.receivePollMs);
      if (!Number.isFinite(value) || value < 1 || value > 60000) throw new DigitalTwinError('INVALID_TWIN', 'receivePollMs must be 1..60000', { value: patch.receivePollMs });
      target.receivePollMs = Math.round(value);
    }
    const writableAreas = Object.prototype.hasOwnProperty.call(patch, 'writableAreas')
      ? normalizeWritableAreas(patch.writableAreas)
      : normalizeWritableAreas(twin.safety?.writableAreas || {});
    twin.target = target;
    twin.name = Object.prototype.hasOwnProperty.call(patch, 'name') ? String(patch.name || twin.name).slice(0, 200) : twin.name;
    twin.safety = { ...twin.safety, writableAreas: clone(writableAreas), approved: false };
    twin.status = 'draft';
    twin.updatedAt = new Date().toISOString();
    delete twin.appliedAt;
    delete twin.approvedAt;
    for (const device of twin.devices || []) {
      device.serverId = target.serverId;
      device.deviceId = `${target.serverId}:unit:${device.unitId}`;
      device.writableAreas = clone(writableAreas);
      device.metadata = {
        ...(device.metadata || {}),
        safeDefault: !writableAreas.coils && !writableAreas.holdingRegisters ? 'read-only' : 'explicit-writable-areas',
      };
    }
    this._replace(project, twin);
    this._emit('digital-twin.retargeted', twin, { serverId: target.serverId, connectionId: target.connectionId });
    return this.get(twinId);
  }

  apply(twinId) {
    const project = this._project();
    const twin = clone(this.get(twinId));
    if (!twin.target.connectionId) throw new DigitalTwinError('TARGET_CONNECTION_REQUIRED', 'A target Simulator connection is required before applying a digital twin', { twinId });

    this.simulator.saveServer({
      serverId: twin.target.serverId,
      name: twin.name,
      connectionId: twin.target.connectionId,
      framing: twin.target.framing,
      receivePollMs: twin.target.receivePollMs,
      metadata: {
        digitalTwin: {
          twinId,
          sourceConnectionId: twin.source.connectionId,
          requiresApproval: true,
          approved: false,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    for (const device of twin.devices) {
      this.simulator.saveDevice({
        ...device,
        metadata: {
          ...device.metadata,
          digitalTwin: { twinId, sourceConnectionId: twin.source.connectionId },
        },
        writableAreas: twin.safety.writableAreas,
      });
    }

    twin.status = 'applied-review-required';
    twin.safety.approved = false;
    twin.appliedAt = new Date().toISOString();
    twin.updatedAt = twin.appliedAt;
    this._replace(project, twin);
    this._emit('digital-twin.applied', twin, { serverId: twin.target.serverId, reviewRequired: true });
    return this.get(twinId);
  }

  approve(twinId, { confirmed = false } = {}) {
    if (confirmed !== true) throw new DigitalTwinError('CONFIRMATION_REQUIRED', 'Explicit confirmation is required before a generated simulator can run', { twinId });
    const project = this._project();
    const twin = clone(this.get(twinId));
    if (!twin.status.startsWith('applied') && twin.status !== 'approved') throw new DigitalTwinError('TWIN_NOT_APPLIED', 'Apply the digital twin to Simulator before approving it', { twinId, status: twin.status });
    const server = this.simulator.getServer(twin.target.serverId);
    const approvedAt = new Date().toISOString();
    this.simulator.saveServer({
      ...server,
      metadata: {
        ...(server.metadata || {}),
        digitalTwin: {
          ...(server.metadata?.digitalTwin || {}),
          twinId,
          requiresApproval: true,
          approved: true,
          approvedAt,
        },
      },
    });
    twin.status = 'approved';
    twin.safety.approved = true;
    twin.approvedAt = approvedAt;
    twin.updatedAt = approvedAt;
    this._replace(project, twin);
    this._emit('digital-twin.approved', twin, { serverId: twin.target.serverId });
    return this.get(twinId);
  }

  remove(twinId, { removeSimulator = false } = {}) {
    const project = this._project();
    const twin = clone(this.get(twinId));
    if (removeSimulator && twin.target?.serverId) {
      try { this.simulator.removeServer(twin.target.serverId); } catch (error) {
        if (error?.code !== 'SERVER_NOT_FOUND') throw error;
      }
    }
    const twins = this._twins().filter((entry) => entry.twinId !== twinId);
    this.store.updateProject(project.id, { digitalTwins: twins });
    this._emit('digital-twin.removed', twin, { removeSimulator: Boolean(removeSimulator) });
    return true;
  }

  _replace(project, twin) {
    const twins = this._twins();
    const index = twins.findIndex((entry) => entry.twinId === twin.twinId);
    if (index < 0) throw new DigitalTwinError('TWIN_NOT_FOUND', `Digital twin ${twin.twinId} was not found`, { twinId: twin.twinId });
    twins[index] = twin;
    this.store.updateProject(project.id, { digitalTwins: twins });
  }

  _twins() {
    const project = this._project();
    return clone(Array.isArray(project.digitalTwins) ? project.digitalTwins : []);
  }

  _project() {
    const project = this.store.getActiveProject();
    if (!project) throw new DigitalTwinError('PROJECT_NOT_FOUND', 'No active v8 project');
    return project;
  }

  _emit(type, twin, details = {}) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'digital-twin',
      connectionId: twin?.source?.connectionId || null,
      ownerMode: 'analyzer',
      details: { twinId: twin?.twinId || null, ...details },
    }));
  }
}

module.exports = {
  AREAS,
  MAX_TWINS,
  MAX_SOURCE_POINTS,
  DigitalTwinError,
  DigitalTwinService,
  buildDevice,
  contiguousSegments,
  inferFraming,
  normalizeWritableAreas,
};
