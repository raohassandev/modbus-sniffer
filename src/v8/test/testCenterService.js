'use strict';

const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');
const { MasterEngine, WRITE_FUNCTIONS } = require('../master/masterEngine');

class TestCenterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TestCenterError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TestCenterError);
  }
}

const sleep = (ms, signal = null) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new TestCenterError('ABORTED', 'Operation was cancelled'));
  const timer = setTimeout(resolve, ms);
  const abort = () => { clearTimeout(timer); reject(new TestCenterError('ABORTED', 'Operation was cancelled')); };
  signal?.addEventListener?.('abort', abort, { once: true });
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current));
}

function parseHex(value, { field = 'hex', allowEmpty = false } = {}) {
  const text = String(value ?? '').replace(/[^0-9a-f]/gi, '');
  if (!text && allowEmpty) return Buffer.alloc(0);
  if (!text || text.length % 2) throw new TestCenterError('INVALID_HEX', `${field} must contain complete hexadecimal bytes`, { field });
  return Buffer.from(text, 'hex');
}

function framingFromProfile(profile) {
  const kind = String(profile?.transportKind || '').toLowerCase();
  if (kind === 'tcp-client') return 'tcp';
  if (kind === 'serial-ascii') return 'ascii';
  if (kind === 'serial-rtu' || kind === 'virtual') return 'rtu';
  throw new TestCenterError('UNSUPPORTED_TEST_TRANSPORT', `Test Center requires tcp-client, serial-rtu, serial-ascii or virtual connection`, { transportKind: kind });
}

function compareMasked(actual, expected, mask = null) {
  if (actual.length !== expected.length) return false;
  if (mask && mask.length !== expected.length) throw new TestCenterError('INVALID_EXPECTATION', 'Expected-response mask must have the same length as expected bytes');
  for (let index = 0; index < expected.length; index += 1) {
    const bitMask = mask ? mask[index] : 0xFF;
    if ((actual[index] & bitMask) !== (expected[index] & bitMask)) return false;
  }
  return true;
}

function normalizeRecipe(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TestCenterError('INVALID_RECIPE', 'Recipe must be an object');
  const version = Number(input.version ?? 1);
  if (version !== 1) throw new TestCenterError('UNSUPPORTED_RECIPE_VERSION', `Unsupported recipe version ${version}`);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!steps.length) throw new TestCenterError('INVALID_RECIPE', 'Recipe must contain at least one step');
  if (steps.length > 1000) throw new TestCenterError('RECIPE_LIMIT', 'Recipe cannot contain more than 1000 top-level steps');
  return Object.freeze({
    recipeId: String(input.recipeId || randomUUID()),
    version: 1,
    name: String(input.name || 'Untitled Recipe').slice(0, 200),
    description: String(input.description || '').slice(0, 2000),
    variables: input.variables && typeof input.variables === 'object' && !Array.isArray(input.variables) ? clone(input.variables) : {},
    setup: Array.isArray(input.setup) ? clone(input.setup) : [],
    steps: clone(steps),
    teardown: Array.isArray(input.teardown) ? clone(input.teardown) : [],
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : {},
  });
}

function resolveValue(value, variables) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_match, key) => {
    const parts = key.split('.');
    let current = variables;
    for (const part of parts) current = current?.[part];
    return current == null ? '' : String(current);
  });
}

class TestCenterService extends EventEmitter {
  constructor({ store, broker, connectionCenter, maxEvidence = 20000, maxRecipeSteps = 10000 } = {}) {
    super();
    if (!store || !broker || !connectionCenter) throw new TypeError('store, broker and connectionCenter are required');
    this.store = store;
    this.broker = broker;
    this.connectionCenter = connectionCenter;
    this.maxEvidence = maxEvidence;
    this.maxRecipeSteps = maxRecipeSteps;
    this.sessions = new Map();
    this.runs = new Map();
    this.evidence = [];
    this.evidenceSequence = 0;
  }

  activeProject() { return this.store.getActiveProject(); }

  async open(connectionId) {
    if (this.sessions.has(connectionId)) return this.session(connectionId);
    const item = this.connectionCenter.get(connectionId);
    const framing = framingFromProfile(item.profile);
    const ownerId = `v8-test:${connectionId}`;
    const engine = new MasterEngine({ broker: this.broker, connectionId, ownerId, ownerMode: 'test', framing, timeoutMs: 1000 });
    const relay = (event) => this.emit('event', event);
    engine.on('event', relay);
    try { await engine.open(); } catch (error) { engine.off('event', relay); throw error; }
    this.sessions.set(connectionId, { connectionId, framing, ownerId, engine, relay, openedAt: Date.now() });
    this._emit('test.connection-opened', connectionId, { framing });
    return this.session(connectionId);
  }

  async close(connectionId) {
    const session = this.sessions.get(connectionId);
    if (!session) return false;
    session.engine.setWriteEnabled(false);
    await session.engine.close();
    session.engine.off('event', session.relay);
    this.sessions.delete(connectionId);
    this._emit('test.connection-closed', connectionId, {});
    return true;
  }

  session(connectionId) {
    const session = this.sessions.get(connectionId);
    if (!session) return null;
    return Object.freeze({ connectionId, framing: session.framing, openedAt: session.openedAt, runtime: session.engine.status(), connection: this.broker.getConnection(connectionId) });
  }

  listSessions() { return Object.freeze([...this.sessions.keys()].map((id) => this.session(id))); }

  setWriteEnabled(connectionId, enabled, { confirmed = false } = {}) {
    if (enabled && !confirmed) throw new TestCenterError('WRITE_CONFIRMATION_REQUIRED', 'Explicit confirmation is required before enabling Test Center writes');
    const session = this._session(connectionId);
    const result = session.engine.setWriteEnabled(Boolean(enabled));
    this._emit(enabled ? 'test.write-unlocked' : 'test.write-locked', connectionId, {});
    return result;
  }

  previewRaw(input = {}) {
    const framing = String(input.framing || 'rtu').toLowerCase();
    if (!['rtu', 'ascii', 'tcp'].includes(framing)) throw new TestCenterError('INVALID_FRAMING', 'framing must be rtu, ascii or tcp');
    let raw;
    let pdu = null;
    let unitId = input.unitId == null ? null : Number(input.unitId);
    let transactionId = input.transactionId == null ? 1 : Number(input.transactionId);
    const manual = input.manualRaw === true || input.rawHex != null;
    if (manual) {
      raw = input.asciiText != null ? Buffer.from(String(input.asciiText), 'ascii') : parseHex(input.rawHex, { field: 'rawHex' });
    } else {
      pdu = parseHex(input.pduHex, { field: 'pduHex' });
      protocol.validatePdu(pdu);
      protocol.validateUnitId(unitId);
      if (framing !== 'tcp' && unitId > 247) throw new TestCenterError('INVALID_SERIAL_UNIT_ID', 'Serial Unit ID must be 0..247');
      if (framing === 'rtu') raw = protocol.encodeRtuAdu(unitId, pdu);
      else if (framing === 'ascii') raw = protocol.encodeAsciiAdu(unitId, pdu);
      else raw = protocol.encodeTcpAdu({ transactionId, unitId, pdu });
    }
    let decoded = null;
    try {
      decoded = framing === 'rtu' ? protocol.decodeRtuAdu(raw) : framing === 'ascii' ? protocol.decodeAsciiAdu(raw) : protocol.decodeTcpAdu(raw);
    } catch (error) {
      decoded = { valid: false, errorCode: error.code || null, error: error.message };
    }
    return Object.freeze({ framing, manual, rawHex: raw.toString('hex').toUpperCase(), byteLength: raw.length, decoded: clone(decoded) });
  }

  async sendRaw(input = {}) {
    const connectionId = String(input.connectionId || '').trim();
    const session = this._session(connectionId);
    if (!input.confirmation?.lab || !input.confirmation?.raw) throw new TestCenterError('RAW_CONFIRMATION_REQUIRED', 'Raw frame send requires LAB and raw-byte confirmation');
    const preview = this.previewRaw({ ...input, framing: input.framing || session.framing });
    const raw = Buffer.from(preview.rawHex, 'hex');
    const timeoutMs = Math.max(1, Math.min(60000, Number(input.timeoutMs) || 1000));
    const expectResponse = input.expectResponse !== false;
    const started = process.hrtime.bigint();
    await this.broker.transmit(connectionId, { ownerId: session.ownerId, bytes: raw, intent: 'raw' });
    const txEvent = this._emitTraffic('traffic.tx', session, raw, preview.decoded, { rawStudio: true, manual: preview.manual });
    let response = null;
    let rxEvent = null;
    if (expectResponse) {
      response = await this.broker.receive(connectionId, { ownerId: session.ownerId, timeoutMs, signal: input.signal || null });
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      let decodedResponse = null;
      try { decodedResponse = session.framing === 'rtu' ? protocol.decodeRtuAdu(response) : session.framing === 'ascii' ? protocol.decodeAsciiAdu(response) : protocol.decodeTcpAdu(response); } catch (error) { decodedResponse = { valid: false, errorCode: error.code || null, error: error.message }; }
      rxEvent = this._emitTraffic('traffic.rx', session, response, decodedResponse, { rawStudio: true, rttMs: elapsed });
      if (input.expectedHex != null) {
        const expected = parseHex(input.expectedHex, { field: 'expectedHex' });
        const mask = input.maskHex == null || input.maskHex === '' ? null : parseHex(input.maskHex, { field: 'maskHex' });
        if (!compareMasked(response, expected, mask)) throw new TestCenterError('EXPECTED_RESPONSE_MISMATCH', 'Raw response did not match expected bytes/mask', { actualHex: response.toString('hex').toUpperCase(), expectedHex: expected.toString('hex').toUpperCase() });
      }
      if (Number.isFinite(Number(input.maxRttMs)) && elapsed > Number(input.maxRttMs)) throw new TestCenterError('TIMING_ASSERTION_FAILED', `Response RTT ${elapsed.toFixed(3)} ms exceeds ${input.maxRttMs} ms`, { rttMs: elapsed });
    }
    const evidence = this._recordEvidence({ type: 'raw-send', connectionId, requestEventId: txEvent.eventId, responseEventId: rxEvent?.eventId || null, requestHex: raw.toString('hex').toUpperCase(), responseHex: response?.toString('hex').toUpperCase() || null, ok: true });
    return Object.freeze({ ok: true, preview, responseHex: response?.toString('hex').toUpperCase() || null, evidence });
  }

  async repeatRaw(input = {}) {
    const count = Math.max(1, Math.min(1000, Number(input.count) || 1));
    const intervalMs = Math.max(10, Math.min(60000, Number(input.intervalMs) || 1000));
    const controller = new AbortController();
    const runId = `raw-${randomUUID()}`;
    this.runs.set(runId, { runId, type: 'raw-repeat', controller, state: 'running', startedAt: Date.now(), results: [] });
    try {
      for (let index = 0; index < count; index += 1) {
        if (controller.signal.aborted) throw new TestCenterError('ABORTED', 'Raw repeat was cancelled');
        const result = await this.sendRaw({ ...input, signal: controller.signal });
        this.runs.get(runId).results.push(result);
        this._emit('test.raw-repeat-progress', input.connectionId, { runId, completed: index + 1, count });
        if (index + 1 < count) await sleep(intervalMs, controller.signal);
      }
      this.runs.get(runId).state = 'passed';
      return this.run(runId);
    } catch (error) {
      const run = this.runs.get(runId); if (run) { run.state = error.code === 'ABORTED' ? 'cancelled' : 'failed'; run.error = { code: error.code || null, message: error.message }; }
      throw error;
    }
  }

  saveRecipe(input) {
    const project = this._project();
    const recipe = normalizeRecipe(input);
    const recipes = Array.isArray(project.recipes) ? [...project.recipes] : [];
    const index = recipes.findIndex((entry) => entry.recipeId === recipe.recipeId);
    if (index >= 0) recipes[index] = recipe; else recipes.push(recipe);
    this.store.updateProject(project.id, { recipes });
    return recipe;
  }

  listRecipes() { return Object.freeze((this._project().recipes || []).map((entry) => Object.freeze(clone(entry)))); }
  getRecipe(recipeId) { const recipe = (this._project().recipes || []).find((entry) => entry.recipeId === recipeId); if (!recipe) throw new TestCenterError('RECIPE_NOT_FOUND', `Recipe ${recipeId} was not found`); return Object.freeze(clone(recipe)); }
  removeRecipe(recipeId) { const project = this._project(); const next = (project.recipes || []).filter((entry) => entry.recipeId !== recipeId); const removed = next.length !== (project.recipes || []).length; if (removed) this.store.updateProject(project.id, { recipes: next }); return removed; }

  validateRecipe(input) {
    const recipe = normalizeRecipe(input);
    let count = 0;
    const visit = (steps) => { for (const step of steps || []) { count += 1; if (count > this.maxRecipeSteps) throw new TestCenterError('RECIPE_LIMIT', 'Expanded recipe exceeds step safety limit'); if (step?.steps) visit(step.steps); if (step?.then) visit(step.then); if (step?.else) visit(step.else); } };
    visit(recipe.setup); visit(recipe.steps); visit(recipe.teardown);
    return Object.freeze({ ok: true, recipe, stepCount: count });
  }

  async runRecipe(recipeOrId, options = {}) {
    const recipe = typeof recipeOrId === 'string' ? this.getRecipe(recipeOrId) : normalizeRecipe(recipeOrId);
    this.validateRecipe(recipe);
    const runId = `recipe-${randomUUID()}`;
    const controller = new AbortController();
    const run = { runId, type: 'recipe', recipeId: recipe.recipeId, name: recipe.name, state: 'running', startedAt: Date.now(), completedAt: null, variables: clone(recipe.variables), steps: [], evidence: [], error: null, controller, paused: false };
    this.runs.set(runId, run);
    this._emit('recipe.started', null, { runId, recipeId: recipe.recipeId });
    let failure = null;
    try {
      await this._executeSteps(recipe.setup, run, options, 'setup');
      await this._executeSteps(recipe.steps, run, options, 'main');
      run.state = 'passed';
    } catch (error) {
      failure = error;
      run.state = error.code === 'ABORTED' ? 'cancelled' : 'failed';
      run.error = { code: error.code || null, message: error.message };
    } finally {
      try { await this._executeSteps(recipe.teardown, run, { ...options, ignoreCancelled: true }, 'teardown'); } catch (error) { if (!failure) { run.state = 'failed'; run.error = { code: error.code || null, message: error.message }; failure = error; } }
      for (const connectionId of [...this.sessions.keys()]) { try { this.setWriteEnabled(connectionId, false); } catch {} }
      run.completedAt = Date.now();
      run.controller = null;
      this._emit('recipe.completed', null, { runId, state: run.state });
    }
    if (failure && options.throwOnFailure) throw failure;
    return this.run(runId);
  }

  pauseRun(runId) { const run = this._run(runId); if (run.state !== 'running') return this.run(runId); run.paused = true; run.state = 'paused'; this._emit('recipe.paused', null, { runId }); return this.run(runId); }
  resumeRun(runId) { const run = this._run(runId); if (run.state !== 'paused') return this.run(runId); run.paused = false; run.state = 'running'; this._emit('recipe.resumed', null, { runId }); return this.run(runId); }
  stopRun(runId) { const run = this._run(runId); run.controller?.abort(); this._emit('recipe.stop-requested', null, { runId }); return this.run(runId); }
  run(runId) { const run = this._run(runId); return Object.freeze(clone({ ...run, controller: undefined })); }
  listRuns() { return Object.freeze([...this.runs.keys()].map((id) => this.run(id))); }
  listEvidence({ limit = 1000 } = {}) { return Object.freeze(this.evidence.slice(-Math.max(1, Math.min(this.maxEvidence, Number(limit) || 1000))).map((entry) => entry)); }

  async shutdown() { for (const run of this.runs.values()) run.controller?.abort(); for (const id of [...this.sessions.keys()]) { try { await this.close(id); } catch {} } }

  async _executeSteps(steps, run, options, phase) {
    for (let index = 0; index < (steps || []).length; index += 1) {
      await this._waitIfPaused(run);
      if (run.controller?.signal.aborted && !options.ignoreCancelled) throw new TestCenterError('ABORTED', 'Recipe was cancelled');
      const raw = steps[index];
      const step = raw && typeof raw === 'object' ? clone(raw) : {};
      const stepResult = { index: run.steps.length, phase, type: String(step.type || ''), name: String(step.name || `${phase} ${index + 1}`), state: 'running', startedAt: Date.now(), completedAt: null, result: null, error: null };
      run.steps.push(stepResult);
      this._emit('recipe.step-started', step.connectionId || null, { runId: run.runId, stepIndex: stepResult.index, type: stepResult.type });
      try {
        stepResult.result = clone(await this._executeStep(step, run, options));
        stepResult.state = 'passed';
      } catch (error) {
        stepResult.state = 'failed'; stepResult.error = { code: error.code || null, message: error.message }; throw error;
      } finally {
        stepResult.completedAt = Date.now();
        this._emit('recipe.step-completed', step.connectionId || null, { runId: run.runId, stepIndex: stepResult.index, state: stepResult.state });
      }
    }
  }

  async _executeStep(step, run, options) {
    const type = String(step.type || '').toLowerCase();
    const connectionId = String(resolveValue(step.connectionId || '', run.variables));
    if (type === 'connect') return this.open(connectionId);
    if (type === 'disconnect') return { closed: await this.close(connectionId) };
    if (type === 'delay') { await sleep(Math.max(0, Math.min(600000, Number(resolveValue(step.ms, run.variables)) || 0)), run.controller?.signal); return { delayed: true }; }
    if (type === 'set') { const key = String(step.variable || ''); if (!key) throw new TestCenterError('INVALID_RECIPE_STEP', 'set step requires variable'); run.variables[key] = resolveValue(step.value, run.variables); return { variable: key, value: run.variables[key] }; }
    if (type === 'read' || type === 'write') return this._recipeModbus(step, run, options, type);
    if (type === 'raw') return this.sendRaw({ ...step, connectionId, confirmation: { lab: options.labConfirmed === true, raw: options.rawConfirmed === true }, signal: run.controller?.signal });
    if (type === 'assert') return this._assertStep(step, run);
    if (type === 'loop') { const count = Math.max(0, Math.min(1000, Number(resolveValue(step.count, run.variables)) || 0)); for (let index = 0; index < count; index += 1) { run.variables.loopIndex = index; await this._executeSteps(step.steps || [], run, options, 'loop'); } return { count }; }
    if (type === 'if') { const pass = this._condition(step.condition || step, run.variables); await this._executeSteps(pass ? step.then : step.else, run, options, pass ? 'then' : 'else'); return { branch: pass ? 'then' : 'else' }; }
    if (type === 'wait-until') { const timeoutMs = Math.max(1, Math.min(600000, Number(step.timeoutMs) || 10000)); const intervalMs = Math.max(10, Math.min(5000, Number(step.intervalMs) || 100)); const started = Date.now(); while (!this._condition(step.condition || step, run.variables)) { if (Date.now() - started >= timeoutMs) throw new TestCenterError('WAIT_TIMEOUT', 'wait-until condition timed out'); await sleep(intervalMs, run.controller?.signal); } return { elapsedMs: Date.now() - started }; }
    throw new TestCenterError('INVALID_RECIPE_STEP', `Unsupported recipe step type ${type || '(empty)'}`, { type });
  }

  async _recipeModbus(step, run, options, type) {
    const connectionId = String(resolveValue(step.connectionId || '', run.variables));
    if (!this.sessions.has(connectionId)) await this.open(connectionId);
    const session = this._session(connectionId);
    const unitId = Number(resolveValue(step.unitId, run.variables));
    let pdu;
    if (step.pduHex) pdu = parseHex(resolveValue(step.pduHex, run.variables), { field: 'pduHex' });
    else if (type === 'read') pdu = protocol.encodeReadRequest({ functionCode: Number(step.functionCode || 3), address: Number(resolveValue(step.address, run.variables)), quantity: Number(resolveValue(step.quantity, run.variables) || 1) });
    else {
      if (!options.writeConfirmed) throw new TestCenterError('WRITE_CONFIRMATION_REQUIRED', 'Recipe contains a write but writeConfirmed was not supplied');
      const fc = Number(step.functionCode || 6);
      if (fc === protocol.FC.WRITE_SINGLE_COIL || fc === protocol.FC.WRITE_SINGLE_REGISTER) pdu = protocol.encodeWriteSingleRequest({ functionCode: fc, address: Number(step.address), value: fc === protocol.FC.WRITE_SINGLE_COIL ? Boolean(step.value) : Number(step.value) });
      else if (fc === protocol.FC.WRITE_MULTIPLE_COILS || fc === protocol.FC.WRITE_MULTIPLE_REGISTERS) pdu = protocol.encodeWriteMultipleRequest({ functionCode: fc, address: Number(step.address), values: Array.isArray(step.values) ? step.values : [] });
      else if (fc === protocol.FC.MASK_WRITE_REGISTER) pdu = protocol.encodeMaskWriteRegisterRequest({ address: Number(step.address), andMask: Number(step.andMask), orMask: Number(step.orMask) });
      else throw new TestCenterError('INVALID_RECIPE_STEP', `Unsupported recipe write FC${fc}`);
      if (this.broker.getConnection(connectionId).writeLock !== 'ENABLED') this.setWriteEnabled(connectionId, true, { confirmed: true });
    }
    try {
      const result = await session.engine.request({ unitId, pdu, timeoutMs: Number(step.timeoutMs) || 1000, signal: run.controller?.signal });
      const values = result.decoded?.values || null;
      if (step.saveAs) run.variables[String(step.saveAs)] = values?.length === 1 ? values[0] : values ?? result.decoded;
      if (step.expectedException != null) throw new TestCenterError('EXPECTED_EXCEPTION_NOT_RECEIVED', `Expected Modbus exception ${step.expectedException} but request succeeded`);
      if (Number.isFinite(Number(step.maxRttMs)) && Number(result.rttMs) > Number(step.maxRttMs)) throw new TestCenterError('TIMING_ASSERTION_FAILED', `RTT ${result.rttMs} ms exceeds ${step.maxRttMs} ms`);
      return { ok: true, rttMs: result.rttMs, decoded: clone(result.decoded), requestHex: result.requestRaw?.toString('hex').toUpperCase(), responseHex: result.responseRaw?.toString('hex').toUpperCase() };
    } catch (error) {
      if (step.expectedException != null && error.code === 'MODBUS_EXCEPTION' && Number(error.details?.exceptionCode) === Number(step.expectedException)) return { ok: true, expectedException: Number(step.expectedException) };
      throw error;
    }
  }

  _assertStep(step, run) {
    const actual = step.actualVariable ? run.variables[String(step.actualVariable)] : resolveValue(step.actual, run.variables);
    const expected = resolveValue(step.expected, run.variables);
    const operator = String(step.operator || 'eq');
    const tolerance = Number(step.tolerance || 0);
    let pass = false;
    if (operator === 'eq') pass = actual == expected; // intentional loose numeric/string recipe equality
    else if (operator === 'strict-eq') pass = actual === expected;
    else if (operator === 'range') pass = Number(actual) >= Number(step.min) && Number(actual) <= Number(step.max);
    else if (operator === 'tolerance') pass = Math.abs(Number(actual) - Number(expected)) <= tolerance;
    else if (operator === 'truthy') pass = Boolean(actual);
    else throw new TestCenterError('INVALID_ASSERTION', `Unsupported assertion operator ${operator}`);
    if (!pass) throw new TestCenterError('ASSERTION_FAILED', step.message || `Assertion ${operator} failed`, { actual, expected, operator });
    return { pass: true, actual, expected, operator };
  }

  _condition(condition, variables) {
    const actual = condition.variable ? variables[String(condition.variable)] : resolveValue(condition.actual, variables);
    const expected = resolveValue(condition.expected, variables);
    const op = String(condition.operator || 'eq');
    if (op === 'eq') return actual == expected;
    if (op === 'neq') return actual != expected;
    if (op === 'gt') return Number(actual) > Number(expected);
    if (op === 'gte') return Number(actual) >= Number(expected);
    if (op === 'lt') return Number(actual) < Number(expected);
    if (op === 'lte') return Number(actual) <= Number(expected);
    if (op === 'truthy') return Boolean(actual);
    return false;
  }

  async _waitIfPaused(run) { while (run.paused) { if (run.controller?.signal.aborted) throw new TestCenterError('ABORTED', 'Recipe was cancelled'); await sleep(50, run.controller?.signal); } }

  _recordEvidence(input) {
    const record = Object.freeze({ evidenceId: `evidence-${++this.evidenceSequence}`, timestamp: Date.now(), ...clone(input) });
    this.evidence.push(record);
    if (this.evidence.length > this.maxEvidence) this.evidence.splice(0, this.evidence.length - this.maxEvidence);
    return record;
  }

  evidenceHash(items = this.evidence) { const hash = createHash('sha256'); for (const item of items) hash.update(JSON.stringify(item)); return hash.digest('hex'); }

  _emitTraffic(type, session, raw, decoded, details = {}) {
    const unitId = decoded?.unitId ?? null;
    const pdu = decoded?.pdu ? Buffer.from(decoded.pdu?.data || decoded.pdu) : null;
    const functionCode = decoded?.pdu?.[0] ?? decoded?.pdu?.data?.[0] ?? null;
    const event = createWorkbenchEvent({ type, source: 'test-center', connectionId: session.connectionId, ownerMode: 'test', direction: type === 'traffic.tx' ? 'tx' : 'rx', unitId, functionCode, raw, details: { framing: session.framing, ...details } });
    this.emit('event', event);
    return event;
  }

  _emit(type, connectionId, details) { const event = createWorkbenchEvent({ type, source: 'test-center', connectionId: connectionId || null, ownerMode: 'test', details }); this.emit('event', event); return event; }
  _session(connectionId) { const session = this.sessions.get(connectionId); if (!session) throw new TestCenterError('TEST_CONNECTION_NOT_OPEN', `Test Center connection ${connectionId} is not open`, { connectionId }); return session; }
  _project() { const project = this.store.getActiveProject(); if (!project) throw new TestCenterError('PROJECT_NOT_FOUND', 'No active v8 project'); return project; }
  _run(runId) { const run = this.runs.get(runId); if (!run) throw new TestCenterError('RUN_NOT_FOUND', `Run ${runId} was not found`); return run; }
}

module.exports = {
  TestCenterError,
  TestCenterService,
  compareMasked,
  normalizeRecipe,
  parseHex,
  resolveRecipeValue: resolveValue,
};
