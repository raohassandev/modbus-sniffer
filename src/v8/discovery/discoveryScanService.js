'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { DiscoveryRequestEngine } = require('./discoveryRequestEngine');

const READ_SCAN_FUNCTIONS = new Set([
  protocol.FC.READ_COILS,
  protocol.FC.READ_DISCRETE_INPUTS,
  protocol.FC.READ_HOLDING_REGISTERS,
  protocol.FC.READ_INPUT_REGISTERS,
]);

class DiscoveryScanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DiscoveryScanError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, DiscoveryScanError);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function int(value, field, { min, max, fallback = null } = {}) {
  const resolved = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new DiscoveryScanError('INVALID_SCAN_OPTION', `${field} must be an integer in ${min}..${max}`, { field, value });
  }
  return resolved;
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      reject(error);
      return;
    }
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled'));
    };
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function scanId() {
  return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function framingFor(profile) {
  const kind = String(profile?.transportKind || '').toLowerCase();
  if (kind === 'tcp-client') return 'tcp';
  if (kind === 'serial-ascii') return 'ascii';
  if (kind === 'serial-rtu' || kind === 'virtual') return 'rtu';
  throw new DiscoveryScanError('DISCOVERY_TRANSPORT_UNSUPPORTED', 'Discovery scan supports Serial RTU/ASCII, TCP client and virtual profiles', { transportKind: profile?.transportKind || null });
}

function isSerialFraming(framing) {
  return framing === 'rtu' || framing === 'ascii';
}

function publicRun(run) {
  return Object.freeze({
    runId: run.runId,
    type: run.type,
    projectId: run.projectId,
    connectionId: run.connectionId,
    framing: run.framing,
    state: run.state,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    progress: Object.freeze({ ...run.progress }),
    stats: Object.freeze({ ...run.stats }),
    options: Object.freeze(clone(run.options)),
    results: Object.freeze(clone(run.results)),
    error: run.error ? Object.freeze({ ...run.error }) : null,
  });
}

class DiscoveryScanService extends EventEmitter {
  constructor({ store, broker, connectionCenter, masterWorkspace = null } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!broker) throw new TypeError('broker is required');
    if (!connectionCenter) throw new TypeError('connectionCenter is required');
    this.store = store;
    this.broker = broker;
    this.connectionCenter = connectionCenter;
    this.masterWorkspace = masterWorkspace;
    this.activeRuns = new Map();
  }

  listRuns(projectId = this.connectionCenter.activeProjectId()) {
    const project = this.store.getProject(projectId);
    if (!project) throw new DiscoveryScanError('PROJECT_NOT_FOUND', `Project ${projectId} was not found`, { projectId });
    const persisted = (project.discoveryRuns || []).map((run) => clone(run));
    const active = [...this.activeRuns.values()].filter((run) => run.projectId === projectId).map((run) => publicRun(run));
    const activeIds = new Set(active.map((run) => run.runId));
    return Object.freeze([...persisted.filter((run) => !activeIds.has(run.runId)), ...active]);
  }

  getRun(runId, projectId = this.connectionCenter.activeProjectId()) {
    const active = this.activeRuns.get(runId);
    if (active) return publicRun(active);
    const run = this.listRuns(projectId).find((entry) => entry.runId === runId);
    if (!run) throw new DiscoveryScanError('SCAN_NOT_FOUND', `Discovery scan ${runId} was not found`, { runId, projectId });
    return Object.freeze(clone(run));
  }

  startUnitScan(options = {}, projectId = this.connectionCenter.activeProjectId()) {
    const profile = this._profile(options.connectionId, projectId);
    const framing = framingFor(profile);
    this._assertIdle(profile.connectionId);
    this._assertSerialInterlock(framing, options);
    const maxUnit = framing === 'tcp' ? 255 : 247;
    const startUnit = int(options.startUnit, 'startUnit', { min: framing === 'tcp' ? 0 : 1, max: maxUnit, fallback: 1 });
    const endUnit = int(options.endUnit, 'endUnit', { min: startUnit, max: maxUnit, fallback: maxUnit });
    const timeoutMs = int(options.timeoutMs, 'timeoutMs', { min: 10, max: 60000, fallback: 250 });
    const interRequestDelayMs = int(options.interRequestDelayMs, 'interRequestDelayMs', { min: 0, max: 60000, fallback: 20 });
    const fallbackFunctionCode = int(options.fallbackFunctionCode, 'fallbackFunctionCode', { min: 1, max: 4, fallback: 3 });
    const fallbackAddress = int(options.fallbackAddress, 'fallbackAddress', { min: 0, max: 0xFFFF, fallback: 0 });
    const units = endUnit - startUnit + 1;
    const run = this._newRun({
      type: 'unit-scan',
      projectId,
      connectionId: profile.connectionId,
      framing,
      options: { startUnit, endUnit, timeoutMs, interRequestDelayMs, fallbackFunctionCode, fallbackAddress, fc43First: true },
      total: units,
      estimatedMs: units * (timeoutMs * 2 + interRequestDelayMs),
    });
    this._launch(run, () => this._runUnitScan(run));
    return publicRun(run);
  }

  startAddressScan(options = {}, projectId = this.connectionCenter.activeProjectId()) {
    const profile = this._profile(options.connectionId, projectId);
    const framing = framingFor(profile);
    this._assertIdle(profile.connectionId);
    this._assertSerialInterlock(framing, options);
    const unitId = int(options.unitId, 'unitId', { min: framing === 'tcp' ? 0 : 1, max: framing === 'tcp' ? 255 : 247, fallback: 1 });
    const functionCode = int(options.functionCode, 'functionCode', { min: 1, max: 4, fallback: 3 });
    if (!READ_SCAN_FUNCTIONS.has(functionCode)) throw new DiscoveryScanError('INVALID_SCAN_FUNCTION', 'Address scan supports FC01, FC02, FC03 and FC04', { functionCode });
    const startAddress = int(options.startAddress, 'startAddress', { min: 0, max: 0xFFFF, fallback: 0 });
    const endAddress = int(options.endAddress, 'endAddress', { min: startAddress, max: 0xFFFF, fallback: startAddress });
    const timeoutMs = int(options.timeoutMs, 'timeoutMs', { min: 10, max: 60000, fallback: 250 });
    const interRequestDelayMs = int(options.interRequestDelayMs, 'interRequestDelayMs', { min: 0, max: 60000, fallback: 20 });
    const strategy = options.strategy === 'adaptive' ? 'adaptive' : 'one-by-one';
    const protocolMax = functionCode <= 2 ? 2000 : 125;
    const blockSize = int(options.blockSize, 'blockSize', { min: 1, max: protocolMax, fallback: strategy === 'adaptive' ? Math.min(16, protocolMax) : 1 });
    const total = endAddress - startAddress + 1;
    const run = this._newRun({
      type: 'address-scan',
      projectId,
      connectionId: profile.connectionId,
      framing,
      options: { unitId, functionCode, startAddress, endAddress, timeoutMs, interRequestDelayMs, strategy, blockSize },
      total,
      estimatedMs: total * (timeoutMs + interRequestDelayMs),
    });
    this._launch(run, () => this._runAddressScan(run));
    return publicRun(run);
  }

  cancel(runId) {
    const run = this.activeRuns.get(runId);
    if (!run) throw new DiscoveryScanError('SCAN_NOT_ACTIVE', `Discovery scan ${runId} is not active`, { runId });
    if (['completed', 'failed', 'cancelled'].includes(run.state)) return publicRun(run);
    run.controller.abort();
    run.state = 'cancelling';
    this._emit('discovery.scan-cancelling', run);
    return publicRun(run);
  }

  exportRun(runId, projectId = this.connectionCenter.activeProjectId()) {
    const run = this.getRun(runId, projectId);
    return Object.freeze({
      format: 'modbus-workbench-v8-discovery-run',
      version: 1,
      exportedAt: new Date().toISOString(),
      run,
    });
  }

  convertUnitToMasterJob(runId, unitId, job = {}, projectId = this.connectionCenter.activeProjectId()) {
    if (!this.masterWorkspace) throw new DiscoveryScanError('MASTER_WORKSPACE_UNAVAILABLE', 'Master Workstation is not available');
    const run = this.getRun(runId, projectId);
    if (run.type !== 'unit-scan') throw new DiscoveryScanError('INVALID_SCAN_TYPE', 'Only Unit scan results can be converted to a Master job', { runId, type: run.type });
    const result = run.results.find((entry) => entry.unitId === Number(unitId));
    if (!result?.confirmed) throw new DiscoveryScanError('DEVICE_NOT_CONFIRMED', 'Only a confirmed discovery result can become a Master job', { runId, unitId });
    const jobId = String(job.jobId || `scan-${runId}-${unitId}`).slice(0, 120);
    return this.masterWorkspace.saveJob({
      jobId,
      label: job.label || `Unit ${unitId} Holding Registers`,
      connectionId: run.connectionId,
      unitId: Number(unitId),
      functionCode: job.functionCode ?? 3,
      address: job.address ?? 0,
      quantity: job.quantity ?? 1,
      intervalMs: job.intervalMs ?? 1000,
      timeoutMs: job.timeoutMs ?? run.options.timeoutMs ?? 1000,
      retries: job.retries ?? 1,
      retryDelayMs: job.retryDelayMs ?? 100,
      enabled: job.enabled !== false,
      metadata: { source: 'discovery-scan', sourceRunId: runId, ...(job.metadata || {}) },
    }, projectId);
  }

  async shutdown() {
    const waits = [];
    for (const run of this.activeRuns.values()) {
      run.controller.abort();
      if (run.promise) waits.push(run.promise.catch(() => undefined));
    }
    await Promise.all(waits);
  }

  _newRun({ type, projectId, connectionId, framing, options, total, estimatedMs }) {
    const run = {
      runId: scanId(),
      type,
      projectId,
      connectionId,
      framing,
      state: 'queued',
      startedAt: new Date().toISOString(),
      completedAt: null,
      options: clone(options),
      progress: { completed: 0, total, percent: 0, current: null, estimatedMs },
      stats: { requests: 0, confirmed: 0, silent: 0, exceptions: 0, errors: 0 },
      results: [],
      error: null,
      controller: new AbortController(),
      promise: null,
    };
    this.activeRuns.set(run.runId, run);
    return run;
  }

  _launch(run, task) {
    run.promise = Promise.resolve().then(task).then(() => {
      if (run.controller.signal.aborted || run.state === 'cancelling') run.state = 'cancelled';
      else run.state = 'completed';
    }).catch((error) => {
      if (run.controller.signal.aborted || error?.code === 'ABORTED') run.state = 'cancelled';
      else {
        run.state = 'failed';
        run.error = { code: error?.code || null, message: String(error?.message || error) };
      }
    }).finally(async () => {
      run.completedAt = new Date().toISOString();
      run.progress.current = null;
      this._persist(run);
      try { await this.connectionCenter.deactivate(run.connectionId, run.projectId); } catch { /* evidence is still persisted */ }
      this._emit(`discovery.scan-${run.state}`, run);
      this.activeRuns.delete(run.runId);
    });
    this._emit('discovery.scan-started', run);
  }

  async _openEngine(run) {
    const ownerId = `v8-discovery:${run.runId}`;
    await this.connectionCenter.activate(run.connectionId, { ownerMode: 'discovery', ownerId }, run.projectId);
    const engine = new DiscoveryRequestEngine({
      broker: this.broker,
      connectionId: run.connectionId,
      ownerId,
      framing: run.framing,
      timeoutMs: run.options.timeoutMs,
      maxTcpConcurrency: 1,
    });
    engine.on('event', (event) => this.emit('event', event));
    await engine.open();
    return engine;
  }

  async _runUnitScan(run) {
    run.state = 'running';
    const signal = run.controller.signal;
    const engine = await this._openEngine(run);
    for (let unitId = run.options.startUnit; unitId <= run.options.endUnit; unitId += 1) {
      if (signal.aborted) throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      run.progress.current = { unitId };
      const result = await this._probeUnit(engine, unitId, run);
      run.results.push(result);
      if (result.confirmed) run.stats.confirmed += 1;
      if (result.classification === 'silent') run.stats.silent += 1;
      if (result.exceptionCode != null) run.stats.exceptions += 1;
      if (result.classification === 'error') run.stats.errors += 1;
      this._advance(run, 1);
      this._emit('discovery.scan-progress', run, { latest: result });
      if (unitId < run.options.endUnit) await sleep(run.options.interRequestDelayMs, signal);
    }
  }

  async _probeUnit(engine, unitId, run) {
    const signal = run.controller.signal;
    const identityObjects = [];
    let objectId = 0;
    let identityPages = 0;
    try {
      while (identityPages < 16) {
        run.stats.requests += 1;
        const response = await engine.request({
          unitId,
          pdu: protocol.encodeDeviceIdRequest({ readDeviceIdCode: 1, objectId }),
          timeoutMs: run.options.timeoutMs,
          signal,
        });
        identityPages += 1;
        for (const object of response.decoded?.objects || []) identityObjects.push({ id: object.id, text: object.text });
        if (!response.decoded?.moreFollows) {
          return {
            unitId,
            confirmed: true,
            classification: 'confirmed-identity',
            identity: identityObjects,
            conformityLevel: response.decoded?.conformityLevel ?? null,
            rttMs: response.rttMs,
            requestRawHex: response.requestRaw?.toString('hex').toUpperCase() || null,
            responseRawHex: response.responseRaw?.toString('hex').toUpperCase() || null,
          };
        }
        const next = response.decoded?.nextObjectId;
        if (!Number.isInteger(next) || next === objectId) break;
        objectId = next;
      }
      return { unitId, confirmed: true, classification: 'confirmed-identity', identity: identityObjects, conformityLevel: null, rttMs: null };
    } catch (error) {
      if (signal.aborted || error?.code === 'ABORTED') throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      if (error?.code === 'MODBUS_EXCEPTION') {
        return {
          unitId,
          confirmed: true,
          classification: 'confirmed-exception',
          identity: [],
          exceptionCode: error.details?.exceptionCode ?? null,
          requestRawHex: error.details?.requestRaw?.toString?.('hex')?.toUpperCase?.() || null,
          responseRawHex: error.details?.responseRaw?.toString?.('hex')?.toUpperCase?.() || null,
        };
      }
      if (error?.code !== 'TIMEOUT') {
        return { unitId, confirmed: false, classification: 'error', identity: [], error: { code: error?.code || null, message: String(error?.message || error) } };
      }
    }

    try {
      run.stats.requests += 1;
      const response = await engine.request({
        unitId,
        pdu: protocol.encodeReadRequest({ functionCode: run.options.fallbackFunctionCode, address: run.options.fallbackAddress, quantity: 1 }),
        timeoutMs: run.options.timeoutMs,
        signal,
      });
      return {
        unitId,
        confirmed: true,
        classification: 'confirmed-probe',
        identity: [],
        probe: { functionCode: run.options.fallbackFunctionCode, address: run.options.fallbackAddress, decoded: response.decoded },
        rttMs: response.rttMs,
        requestRawHex: response.requestRaw?.toString('hex').toUpperCase() || null,
        responseRawHex: response.responseRaw?.toString('hex').toUpperCase() || null,
      };
    } catch (error) {
      if (signal.aborted || error?.code === 'ABORTED') throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      if (error?.code === 'MODBUS_EXCEPTION') {
        return {
          unitId,
          confirmed: true,
          classification: 'confirmed-probe-exception',
          identity: [],
          exceptionCode: error.details?.exceptionCode ?? null,
          requestRawHex: error.details?.requestRaw?.toString?.('hex')?.toUpperCase?.() || null,
          responseRawHex: error.details?.responseRaw?.toString?.('hex')?.toUpperCase?.() || null,
        };
      }
      if (error?.code === 'TIMEOUT') return { unitId, confirmed: false, classification: 'silent', identity: [] };
      return { unitId, confirmed: false, classification: 'error', identity: [], error: { code: error?.code || null, message: String(error?.message || error) } };
    }
  }

  async _runAddressScan(run) {
    run.state = 'running';
    const signal = run.controller.signal;
    const engine = await this._openEngine(run);
    const { startAddress, endAddress, strategy, blockSize } = run.options;
    if (strategy === 'one-by-one') {
      for (let address = startAddress; address <= endAddress; address += 1) {
        if (signal.aborted) throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
        await this._scanSegment(engine, run, address, 1);
        if (address < endAddress) await sleep(run.options.interRequestDelayMs, signal);
      }
      return;
    }
    for (let address = startAddress; address <= endAddress; address += blockSize) {
      if (signal.aborted) throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      const quantity = Math.min(blockSize, endAddress - address + 1);
      await this._scanSegment(engine, run, address, quantity, true);
      if (address + quantity <= endAddress) await sleep(run.options.interRequestDelayMs, signal);
    }
  }

  async _scanSegment(engine, run, address, quantity, adaptive = false) {
    const signal = run.controller.signal;
    if (signal.aborted) throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
    run.progress.current = { unitId: run.options.unitId, address, quantity };
    run.stats.requests += 1;
    try {
      const response = await engine.request({
        unitId: run.options.unitId,
        pdu: protocol.encodeReadRequest({ functionCode: run.options.functionCode, address, quantity }),
        timeoutMs: run.options.timeoutMs,
        signal,
      });
      const values = response.decoded?.values || [];
      for (let index = 0; index < quantity; index += 1) {
        run.results.push({
          address: address + index,
          confirmed: true,
          classification: 'readable',
          value: values[index] ?? null,
          blockStart: address,
          blockQuantity: quantity,
        });
      }
      run.stats.confirmed += quantity;
      this._advance(run, quantity);
      this._emit('discovery.scan-progress', run, { latest: { address, quantity, classification: 'readable' } });
      return;
    } catch (error) {
      if (signal.aborted || error?.code === 'ABORTED') throw new DiscoveryScanError('ABORTED', 'Discovery scan was cancelled');
      if (adaptive && quantity > 1) {
        const left = Math.floor(quantity / 2);
        const right = quantity - left;
        await this._scanSegment(engine, run, address, left, true);
        if (run.options.interRequestDelayMs) await sleep(run.options.interRequestDelayMs, signal);
        await this._scanSegment(engine, run, address + left, right, true);
        return;
      }
      const classification = error?.code === 'MODBUS_EXCEPTION' ? 'exception' : error?.code === 'TIMEOUT' ? 'silent' : 'error';
      if (classification === 'exception') run.stats.exceptions += quantity;
      if (classification === 'silent') run.stats.silent += quantity;
      if (classification === 'error') run.stats.errors += quantity;
      for (let index = 0; index < quantity; index += 1) {
        run.results.push({
          address: address + index,
          confirmed: false,
          classification,
          exceptionCode: error?.details?.exceptionCode ?? null,
          error: classification === 'error' ? { code: error?.code || null, message: String(error?.message || error) } : null,
        });
      }
      this._advance(run, quantity);
      this._emit('discovery.scan-progress', run, { latest: { address, quantity, classification } });
    }
  }

  _advance(run, count) {
    run.progress.completed = Math.min(run.progress.total, run.progress.completed + count);
    run.progress.percent = run.progress.total ? Math.round((run.progress.completed / run.progress.total) * 1000) / 10 : 100;
  }

  _persist(run) {
    const project = this.store.getProject(run.projectId);
    if (!project) return;
    const record = publicRun(run);
    const runs = (project.discoveryRuns || []).filter((entry) => entry.runId !== run.runId);
    runs.push(clone(record));
    this.store.updateProject(run.projectId, { discoveryRuns: runs.slice(-100) });
  }

  _profile(connectionId, projectId) {
    connectionId = String(connectionId || '').trim();
    if (!connectionId) throw new DiscoveryScanError('CONNECTION_REQUIRED', 'connectionId is required');
    const profile = this.connectionCenter.listProfiles(projectId).find((entry) => entry.connectionId === connectionId);
    if (!profile) throw new DiscoveryScanError('PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { connectionId, projectId });
    return profile;
  }

  _assertIdle(connectionId) {
    for (const run of this.activeRuns.values()) {
      if (run.connectionId === connectionId && !['completed', 'failed', 'cancelled'].includes(run.state)) {
        throw new DiscoveryScanError('SCAN_ALREADY_ACTIVE', `Connection ${connectionId} already has an active scan`, { connectionId, runId: run.runId });
      }
    }
    this.connectionCenter.sync();
    const runtime = this.broker.getConnection(connectionId);
    if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
      throw new DiscoveryScanError('CONNECTION_ACTIVE', 'Discovery requires an inactive connection profile', { connectionId, owner: runtime.owner, state: runtime.state });
    }
  }

  _assertSerialInterlock(framing, options) {
    if (!isSerialFraming(framing)) return;
    if (options.maintenanceConfirmed !== true || options.exclusiveBusConfirmed !== true) {
      throw new DiscoveryScanError('RTU_DISCOVERY_CONFIRMATION_REQUIRED', 'Serial discovery requires maintenance-window and exclusive-bus confirmation');
    }
  }

  _emit(type, run, details = {}) {
    this.emit('event', Object.freeze({
      type,
      source: 'discovery-scan',
      at: Date.now(),
      connectionId: run.connectionId,
      ownerMode: 'discovery',
      details: Object.freeze({ run: publicRun(run), ...clone(details) }),
    }));
  }
}

module.exports = {
  READ_SCAN_FUNCTIONS,
  DiscoveryScanError,
  DiscoveryScanService,
  framingFor,
  publicRun,
};
