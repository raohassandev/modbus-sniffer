'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { MasterEngine } = require('./masterEngine');
const { PollScheduler } = require('./pollScheduler');
const { WriteAuditTrail, WriteSafetyController } = require('./writeSafety');

const READ_FUNCTIONS = new Set([
  protocol.FC.READ_COILS,
  protocol.FC.READ_DISCRETE_INPUTS,
  protocol.FC.READ_HOLDING_REGISTERS,
  protocol.FC.READ_INPUT_REGISTERS,
]);

const WRITE_FUNCTIONS = new Set([
  protocol.FC.WRITE_SINGLE_COIL,
  protocol.FC.WRITE_SINGLE_REGISTER,
  protocol.FC.WRITE_MULTIPLE_COILS,
  protocol.FC.WRITE_MULTIPLE_REGISTERS,
]);

class MasterWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MasterWorkspaceError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, MasterWorkspaceError);
  }
}

function positiveInteger(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new MasterWorkspaceError('INVALID_MASTER_JOB', `${field} must be an integer in ${min}..${max}`, { field, value });
  }
  return number;
}

function optionalNonNegativeInteger(value, fallback, field, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    throw new MasterWorkspaceError('INVALID_MASTER_JOB', `${field} must be an integer in 0..${max}`, { field, value });
  }
  return number;
}

function normalizeReadSpec(input = {}) {
  const functionCode = positiveInteger(input.functionCode ?? protocol.FC.READ_HOLDING_REGISTERS, 'functionCode', { min: 1, max: 255 });
  if (!READ_FUNCTIONS.has(functionCode)) {
    throw new MasterWorkspaceError('UNSUPPORTED_POLL_FUNCTION', 'Master polling supports FC01, FC02, FC03 and FC04', { functionCode });
  }
  const address = optionalNonNegativeInteger(input.address, 0, 'address', 0xFFFF);
  const quantityMax = functionCode === protocol.FC.READ_COILS || functionCode === protocol.FC.READ_DISCRETE_INPUTS ? 2000 : 125;
  const quantity = positiveInteger(input.quantity ?? 1, 'quantity', { min: 1, max: quantityMax });
  if (address + quantity - 1 > 0xFFFF) {
    throw new MasterWorkspaceError('ADDRESS_RANGE_OVERFLOW', 'Read range exceeds Modbus address 65535', { address, quantity });
  }
  return { functionCode, address, quantity };
}

function normalizeUnitId(value, framing) {
  const unitId = optionalNonNegativeInteger(value, 1, 'unitId', framing === 'tcp' ? 255 : 247);
  if (framing !== 'tcp' && unitId === 0) {
    throw new MasterWorkspaceError('INVALID_SERIAL_UNIT_ID', 'Cyclic/one-shot serial reads require Unit ID 1..247', { unitId });
  }
  return unitId;
}

function normalizePersistentJob(input, { framing, existing = null } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MasterWorkspaceError('INVALID_MASTER_JOB', 'Master job must be an object');
  const connectionId = String(input.connectionId ?? existing?.connectionId ?? '').trim();
  if (!connectionId) throw new MasterWorkspaceError('INVALID_MASTER_JOB', 'connectionId is required');
  const jobId = String(input.jobId ?? existing?.jobId ?? '').trim();
  if (!jobId) throw new MasterWorkspaceError('INVALID_MASTER_JOB', 'jobId is required');
  const spec = normalizeReadSpec({
    functionCode: input.functionCode ?? existing?.functionCode,
    address: input.address ?? existing?.address,
    quantity: input.quantity ?? existing?.quantity,
  });
  const unitId = normalizeUnitId(input.unitId ?? existing?.unitId, framing);
  const intervalMs = positiveInteger(input.intervalMs ?? existing?.intervalMs ?? 1000, 'intervalMs', { min: 10, max: 24 * 60 * 60 * 1000 });
  const timeoutMs = positiveInteger(input.timeoutMs ?? existing?.timeoutMs ?? 1000, 'timeoutMs', { min: 1, max: 60000 });
  const retries = optionalNonNegativeInteger(input.retries ?? existing?.retries, 0, 'retries', 20);
  const retryDelayMs = optionalNonNegativeInteger(input.retryDelayMs ?? existing?.retryDelayMs, Math.min(250, intervalMs), 'retryDelayMs', 60000);
  const pdu = protocol.encodeReadRequest(spec);
  return Object.freeze({
    jobId,
    documentId: String(input.documentId ?? existing?.documentId ?? 'default').trim() || 'default',
    connectionId,
    label: String(input.label ?? existing?.label ?? jobId).trim().slice(0, 200) || jobId,
    unitId,
    functionCode: spec.functionCode,
    address: spec.address,
    quantity: spec.quantity,
    pduHex: pdu.toString('hex').toUpperCase(),
    intervalMs,
    timeoutMs,
    retries,
    retryDelayMs,
    enabled: input.enabled ?? existing?.enabled ?? true,
    disableOnError: Boolean(input.disableOnError ?? existing?.disableOnError ?? false),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : existing?.metadata && typeof existing.metadata === 'object'
        ? { ...existing.metadata }
        : {},
  });
}

function resultView(result) {
  if (!result) return null;
  return Object.freeze({
    ok: Boolean(result.ok),
    broadcast: Boolean(result.broadcast),
    unitId: result.unitId,
    functionCode: result.functionCode,
    transactionId: result.transactionId ?? null,
    rttMs: result.rttMs ?? null,
    requestRawHex: result.requestRaw ? Buffer.from(result.requestRaw).toString('hex').toUpperCase() : null,
    responseRawHex: result.responseRaw ? Buffer.from(result.responseRaw).toString('hex').toUpperCase() : null,
    responsePduHex: result.responsePdu ? Buffer.from(result.responsePdu).toString('hex').toUpperCase() : null,
    decoded: result.decoded ?? null,
  });
}

class MasterWorkspaceService extends EventEmitter {
  constructor({ store, broker, connectionCenter, minimumInterRequestDelayMs = 0 } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!broker) throw new TypeError('broker is required');
    if (!connectionCenter) throw new TypeError('connectionCenter is required');
    this.store = store;
    this.broker = broker;
    this.connectionCenter = connectionCenter;
    this.minimumInterRequestDelayMs = Number(minimumInterRequestDelayMs) || 0;
    this.sessions = new Map();
  }

  listJobs(projectId = this.connectionCenter.activeProjectId()) {
    const project = this.store.getProject(projectId);
    if (!project) throw new MasterWorkspaceError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    return Object.freeze((project.masterJobs || []).map((job) => Object.freeze({ ...job, metadata: Object.freeze({ ...(job.metadata || {}) }) })));
  }

  getJob(jobId, projectId = this.connectionCenter.activeProjectId()) {
    const job = this.listJobs(projectId).find((entry) => entry.jobId === jobId);
    if (!job) throw new MasterWorkspaceError('MASTER_JOB_NOT_FOUND', `Master job ${jobId} was not found`, { jobId, projectId });
    return job;
  }

  saveJob(input, projectId = this.connectionCenter.activeProjectId()) {
    const project = this.store.getProject(projectId);
    if (!project) throw new MasterWorkspaceError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const connectionId = String(input?.connectionId || '').trim();
    const profile = this._profile(connectionId, projectId);
    const framing = this._framing(profile);
    const existing = (project.masterJobs || []).find((entry) => entry.jobId === String(input?.jobId || '').trim()) || null;
    if (existing && existing.connectionId !== connectionId) {
      throw new MasterWorkspaceError('MASTER_JOB_CONNECTION_IMMUTABLE', 'Move a job by deleting and recreating it on the target connection', { jobId: existing.jobId });
    }
    const job = normalizePersistentJob(input, { framing, existing });
    const jobs = (project.masterJobs || []).filter((entry) => entry.jobId !== job.jobId);
    jobs.push(job);
    this.store.updateProject(projectId, { masterJobs: jobs });
    const session = this.sessions.get(connectionId);
    if (session) {
      if (session.loadedJobs.has(job.jobId)) {
        session.scheduler.updateJob(job.jobId, this._schedulerJob(job));
      } else {
        session.scheduler.addJob(this._schedulerJob(job));
        session.loadedJobs.add(job.jobId);
      }
    }
    this._emit('master.job-saved', { projectId, connectionId, jobId: job.jobId });
    return job;
  }

  removeJob(jobId, projectId = this.connectionCenter.activeProjectId()) {
    const project = this.store.getProject(projectId);
    if (!project) throw new MasterWorkspaceError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const existing = (project.masterJobs || []).find((entry) => entry.jobId === jobId);
    if (!existing) throw new MasterWorkspaceError('MASTER_JOB_NOT_FOUND', `Master job ${jobId} was not found`, { jobId, projectId });
    const session = this.sessions.get(existing.connectionId);
    if (session?.loadedJobs.has(jobId)) {
      session.scheduler.removeJob(jobId);
      session.loadedJobs.delete(jobId);
    }
    this.store.updateProject(projectId, { masterJobs: (project.masterJobs || []).filter((entry) => entry.jobId !== jobId) });
    this._emit('master.job-removed', { projectId, connectionId: existing.connectionId, jobId });
    return existing;
  }

  async readOnce({ connectionId, unitId = 1, functionCode = 3, address = 0, quantity = 1, timeoutMs = null } = {}) {
    const session = await this._ensureSession(connectionId);
    const spec = normalizeReadSpec({ functionCode, address, quantity });
    const normalizedUnitId = normalizeUnitId(unitId, session.framing);
    const result = await session.master.request({
      unitId: normalizedUnitId,
      pdu: protocol.encodeReadRequest(spec),
      ...(timeoutMs == null ? {} : { timeoutMs: positiveInteger(timeoutMs, 'timeoutMs', { min: 1, max: 60000 }) }),
    });
    const view = resultView(result);
    session.lastResult = view;
    this._emit('master.read-once', { connectionId, unitId: normalizedUnitId, functionCode: spec.functionCode, address: spec.address, quantity: spec.quantity, rttMs: view.rttMs });
    return view;
  }

  async writeOnce({ connectionId, unitId = 1, functionCode, address = 0, value = null, values = null, confirmation = null, readBack = true, autoLockMs = 10000 } = {}) {
    const session = await this._ensureSession(connectionId);
    const fc = positiveInteger(functionCode, 'functionCode', { min: 1, max: 255 });
    if (!WRITE_FUNCTIONS.has(fc)) throw new MasterWorkspaceError('UNSUPPORTED_WRITE_FUNCTION', 'Manual write supports FC05, FC06, FC15 and FC16', { functionCode: fc });
    const normalizedUnitId = normalizeUnitId(unitId, session.framing);
    const normalizedAddress = optionalNonNegativeInteger(address, 0, 'address', 0xFFFF);
    let pdu;
    if (fc === protocol.FC.WRITE_SINGLE_COIL || fc === protocol.FC.WRITE_SINGLE_REGISTER) {
      if (value == null) throw new MasterWorkspaceError('WRITE_VALUE_REQUIRED', 'value is required for FC05/FC06');
      pdu = fc === protocol.FC.WRITE_SINGLE_COIL
        ? protocol.encodeWriteSingleCoilRequest({ address: normalizedAddress, value: Boolean(value) })
        : protocol.encodeWriteSingleRegisterRequest({ address: normalizedAddress, value: positiveInteger(value, 'value', { min: 0, max: 0xFFFF }) });
    } else {
      if (!Array.isArray(values) || !values.length) throw new MasterWorkspaceError('WRITE_VALUES_REQUIRED', 'values is required for FC15/FC16');
      pdu = fc === protocol.FC.WRITE_MULTIPLE_COILS
        ? protocol.encodeWriteMultipleCoilsRequest({ address: normalizedAddress, values: values.map(Boolean) })
        : protocol.encodeWriteMultipleRegistersRequest({ address: normalizedAddress, values: values.map((entry, index) => positiveInteger(entry, `values[${index}]`, { min: 0, max: 0xFFFF })) });
    }

    const resolvedConfirmation = confirmation && typeof confirmation === 'object' ? { ...confirmation } : {};
    if (!resolvedConfirmation.confirmed) throw new MasterWorkspaceError('CONFIRMATION_REQUIRED', 'Explicit write confirmation is required');
    session.safety.unlock({ durationMs: positiveInteger(autoLockMs, 'autoLockMs', { min: 1, max: 60000 }), confirmation: { confirmed: true } });
    try {
      const result = await session.safety.execute({
        unitId: normalizedUnitId,
        pdu,
        confirmation: resolvedConfirmation,
        readBack: Boolean(readBack),
        context: { source: 'v8-master-workspace' },
      });
      const view = resultView(result);
      session.lastResult = view;
      return view;
    } finally {
      try { session.safety.lock({ reason: 'operation-complete' }); } catch { /* connection loss already relocks */ }
    }
  }

  async readJobNow(jobId, projectId = this.connectionCenter.activeProjectId()) {
    const job = this.getJob(jobId, projectId);
    const session = await this._ensureSession(job.connectionId, projectId);
    this._loadJobs(session, projectId);
    const result = await session.scheduler.readNow(jobId);
    const view = resultView(result);
    session.lastResult = view;
    return view;
  }

  async start(connectionId, projectId = this.connectionCenter.activeProjectId()) {
    const session = await this._ensureSession(connectionId, projectId);
    this._loadJobs(session, projectId);
    return session.scheduler.start();
  }

  pause(connectionId) {
    return this._session(connectionId).scheduler.pause();
  }

  resume(connectionId) {
    return this._session(connectionId).scheduler.resume();
  }

  stop(connectionId) {
    return this._session(connectionId).scheduler.stop();
  }

  snapshot(projectId = this.connectionCenter.activeProjectId()) {
    const jobs = this.listJobs(projectId);
    const connections = this.connectionCenter.inventory(projectId).map((item) => ({
      connectionId: item.profile.connectionId,
      name: item.profile.name,
      transportKind: item.profile.transportKind,
      endpoint: item.profile.endpoint,
      runtime: item.runtime,
      masterEligible: this._isMasterEligible(item.profile),
      scheduler: this.sessions.get(item.profile.connectionId)?.scheduler.snapshot() || null,
      lastResult: this.sessions.get(item.profile.connectionId)?.lastResult || null,
    }));
    return Object.freeze({ projectId, jobs, connections });
  }

  audit({ limit = 200 } = {}) {
    return this.auditTrail ? this.auditTrail.list({ limit }) : Object.freeze([]);
  }

  async disconnect(connectionId, { release = true } = {}) {
    const session = this.sessions.get(connectionId);
    if (session) {
      session.scheduler.stop();
      try { session.safety.lock({ reason: 'disconnect' }); } catch { /* already locked */ }
      this.sessions.delete(connectionId);
    }
    const runtime = this.broker.getConnection(connectionId);
    if (runtime.owner?.ownerMode === 'master') {
      await this.connectionCenter.deactivate(connectionId);
    } else if (runtime.owner && release) {
      throw new MasterWorkspaceError('OWNER_MISMATCH', 'Connection is owned by another workspace', { connectionId, owner: runtime.owner });
    }
    return this.connectionCenter.get(connectionId);
  }

  async shutdown() {
    for (const connectionId of [...this.sessions.keys()]) {
      try { await this.disconnect(connectionId); } catch { /* best effort shutdown */ }
    }
  }

  async _ensureSession(connectionId, projectId = this.connectionCenter.activeProjectId()) {
    connectionId = String(connectionId || '').trim();
    if (!connectionId) throw new MasterWorkspaceError('CONNECTION_REQUIRED', 'connectionId is required');
    const existing = this.sessions.get(connectionId);
    if (existing) return existing;
    const profile = this._profile(connectionId, projectId);
    if (!this._isMasterEligible(profile)) throw new MasterWorkspaceError('MASTER_TRANSPORT_UNSUPPORTED', 'Master Workstation requires serial RTU/ASCII, TCP client or virtual transport', { connectionId, transportKind: profile.transportKind });
    const framing = this._framing(profile);
    const ownerId = `v8-ui:master:${connectionId}`;
    await this.connectionCenter.activate(connectionId, { ownerMode: 'master', ownerId }, projectId);
    const master = new MasterEngine({ broker: this.broker, connectionId, ownerId, framing });
    await master.open();
    const scheduler = new PollScheduler({ master, minimumInterRequestDelayMs: this.minimumInterRequestDelayMs });
    const auditTrail = new WriteAuditTrail();
    const safety = new WriteSafetyController({ master, auditTrail, userId: 'v8-local-user', sessionId: `master:${connectionId}` });
    const session = { connectionId, projectId, profile, framing, master, scheduler, safety, auditTrail, loadedJobs: new Set(), lastResult: null };
    scheduler.on('event', (event) => this.emit('event', event));
    master.on('event', (event) => this.emit('event', event));
    safety.on('event', (event) => this.emit('event', event));
    this.sessions.set(connectionId, session);
    this._loadJobs(session, projectId);
    this._emit('master.session-opened', { projectId, connectionId, framing });
    return session;
  }

  _loadJobs(session, projectId) {
    for (const job of this.listJobs(projectId).filter((entry) => entry.connectionId === session.connectionId)) {
      if (session.loadedJobs.has(job.jobId)) continue;
      session.scheduler.addJob(this._schedulerJob(job));
      session.loadedJobs.add(job.jobId);
    }
  }

  _schedulerJob(job) {
    return {
      jobId: job.jobId,
      label: job.label,
      unitId: job.unitId,
      pdu: Buffer.from(job.pduHex, 'hex'),
      intervalMs: job.intervalMs,
      timeoutMs: job.timeoutMs,
      retries: job.retries,
      retryDelayMs: job.retryDelayMs,
      enabled: job.enabled,
      disableOnError: job.disableOnError,
      metadata: { ...(job.metadata || {}), documentId: job.documentId, functionCode: job.functionCode, address: job.address, quantity: job.quantity },
    };
  }

  _profile(connectionId, projectId) {
    const profile = this.connectionCenter.listProfiles(projectId).find((entry) => entry.connectionId === connectionId);
    if (!profile) throw new MasterWorkspaceError('PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { connectionId, projectId });
    return profile;
  }

  _isMasterEligible(profile) {
    return ['serial-rtu', 'serial-ascii', 'tcp-client', 'virtual'].includes(String(profile?.transportKind || '').toLowerCase());
  }

  _framing(profile) {
    const kind = String(profile?.transportKind || '').toLowerCase();
    if (kind === 'serial-ascii') return 'ascii';
    if (kind === 'tcp-client') return 'tcp';
    return 'rtu';
  }

  _session(connectionId) {
    const session = this.sessions.get(connectionId);
    if (!session) throw new MasterWorkspaceError('MASTER_SESSION_NOT_OPEN', `Master session ${connectionId} is not open`, { connectionId });
    return session;
  }

  _emit(type, details) {
    this.emit('event', Object.freeze({ type, source: 'master-workspace', at: Date.now(), details: Object.freeze({ ...details }) }));
  }
}

module.exports = {
  READ_FUNCTIONS,
  WRITE_FUNCTIONS,
  MasterWorkspaceError,
  MasterWorkspaceService,
  normalizePersistentJob,
  normalizeReadSpec,
  resultView,
};
