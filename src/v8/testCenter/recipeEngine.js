'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const { createWorkbenchEvent } = require('../events');

const RECIPE_SCHEMA_VERSION = 1;
const STEP_TYPES = new Set(['connect', 'disconnect', 'armWrites', 'lockWrites', 'armLab', 'disarmLab', 'read', 'write', 'raw', 'delay', 'set', 'assert', 'repeat']);

class RecipeEngineError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RecipeEngineError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, RecipeEngineError);
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getPath(source, path) {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cursor = source;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object' || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setPath(target, path, value) {
  if (typeof path !== 'string' || !path.trim()) throw new RecipeEngineError('INVALID_VARIABLE', 'Variable path is required');
  const parts = path.split('.').filter(Boolean);
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new RecipeEngineError('INVALID_RECIPE', 'Recipe must be an object');
  if (recipe.schemaVersion !== RECIPE_SCHEMA_VERSION) {
    throw new RecipeEngineError('UNSUPPORTED_RECIPE_VERSION', `Recipe schemaVersion must be ${RECIPE_SCHEMA_VERSION}`, { schemaVersion: recipe.schemaVersion });
  }
  if (!Array.isArray(recipe.steps) || !recipe.steps.length) throw new RecipeEngineError('INVALID_RECIPE', 'Recipe steps must be a non-empty array');
  const ids = new Set();
  const validateSteps = (steps, path = 'steps') => {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new RecipeEngineError('INVALID_STEP', `${path}[${index}] must be an object`);
      if (!STEP_TYPES.has(step.type)) throw new RecipeEngineError('INVALID_STEP_TYPE', `Unsupported recipe step type: ${step.type}`, { path: `${path}[${index}]` });
      const id = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `${path}.${index + 1}`;
      if (ids.has(id)) throw new RecipeEngineError('DUPLICATE_STEP_ID', `Duplicate recipe step id ${id}`);
      ids.add(id);
      if (step.type === 'repeat') {
        if (!Number.isInteger(step.count) || step.count < 1 || step.count > 1000) throw new RecipeEngineError('INVALID_REPEAT', 'repeat.count must be 1..1000', { id });
        if (!Array.isArray(step.steps) || !step.steps.length) throw new RecipeEngineError('INVALID_REPEAT', 'repeat.steps must be non-empty', { id });
        validateSteps(step.steps, `${path}[${index}].steps`);
      }
    }
  };
  validateSteps(recipe.steps);
  return true;
}

function encodeWriteStep(step) {
  const fc = Number(step.functionCode);
  if (fc === protocol.FC.WRITE_SINGLE_COIL) return protocol.encodeWriteSingleCoilRequest({ address: step.address, value: step.value });
  if (fc === protocol.FC.WRITE_SINGLE_REGISTER) return protocol.encodeWriteSingleRegisterRequest({ address: step.address, value: step.value });
  if (fc === protocol.FC.WRITE_MULTIPLE_COILS) return protocol.encodeWriteMultipleCoilsRequest({ address: step.address, values: step.values });
  if (fc === protocol.FC.WRITE_MULTIPLE_REGISTERS) return protocol.encodeWriteMultipleRegistersRequest({ address: step.address, values: step.values });
  if (fc === protocol.FC.WRITE_FILE_RECORD) return protocol.encodeWriteFileRecordRequest({ records: step.records });
  if (fc === protocol.FC.MASK_WRITE_REGISTER) return protocol.encodeMaskWriteRegisterRequest({ address: step.address, andMask: step.andMask, orMask: step.orMask });
  if (fc === protocol.FC.READ_WRITE_MULTIPLE_REGISTERS) {
    return protocol.encodeReadWriteMultipleRegistersRequest({ readAddress: step.readAddress, readQuantity: step.readQuantity, writeAddress: step.writeAddress, values: step.values });
  }
  throw new RecipeEngineError('UNSUPPORTED_WRITE_FC', `Recipe write step does not support FC${fc}`, { functionCode: fc });
}

function assertionPasses(operator, actual, expected) {
  switch (operator) {
    case 'exists': return actual !== undefined && actual !== null;
    case 'equals': return JSON.stringify(actual) === JSON.stringify(expected);
    case 'notEquals': return JSON.stringify(actual) !== JSON.stringify(expected);
    case 'greaterThan': return Number(actual) > Number(expected);
    case 'greaterThanOrEqual': return Number(actual) >= Number(expected);
    case 'lessThan': return Number(actual) < Number(expected);
    case 'lessThanOrEqual': return Number(actual) <= Number(expected);
    case 'between': return Array.isArray(expected) && expected.length === 2 && Number(actual) >= Number(expected[0]) && Number(actual) <= Number(expected[1]);
    case 'includes': return Array.isArray(actual) ? actual.some((item) => JSON.stringify(item) === JSON.stringify(expected)) : String(actual).includes(String(expected));
    default: throw new RecipeEngineError('INVALID_ASSERTION', `Unsupported assertion operator ${operator}`);
  }
}

function delay(ms, signal = null) {
  if (!Number.isFinite(ms) || ms < 0) throw new RecipeEngineError('INVALID_DELAY', 'delay ms must be >= 0');
  if (signal?.aborted) return Promise.reject(new RecipeEngineError('ABORTED', 'Recipe was aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      reject(new RecipeEngineError('ABORTED', 'Recipe was aborted'));
    }
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

class RecipeEngine extends EventEmitter {
  constructor({ resolveContext, maxEvidenceEntries = 20000 } = {}) {
    super();
    if (typeof resolveContext !== 'function') throw new TypeError('resolveContext(connectionId) is required');
    if (!Number.isInteger(maxEvidenceEntries) || maxEvidenceEntries < 1) throw new TypeError('maxEvidenceEntries must be positive');
    this.resolveContext = resolveContext;
    this.maxEvidenceEntries = maxEvidenceEntries;
    this.running = false;
    this.paused = false;
    this.controller = null;
    this.resumeWaiters = [];
    this.sequence = 0;
  }

  pause() {
    if (this.running) {
      this.paused = true;
      this._emit('recipe.paused', {});
    }
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    const waiters = this.resumeWaiters.splice(0);
    for (const resolve of waiters) resolve();
    this._emit('recipe.resumed', {});
  }

  stop() {
    if (this.controller && !this.controller.signal.aborted) this.controller.abort();
    this.resume();
  }

  status() {
    return Object.freeze({ running: this.running, paused: this.paused });
  }

  async run(recipe, { variables = {}, signal = null, defaultConnectionId = null } = {}) {
    validateRecipe(recipe);
    if (this.running) throw new RecipeEngineError('RECIPE_BUSY', 'A recipe is already running');
    this.running = true;
    this.paused = false;
    this.controller = new AbortController();
    const onExternalAbort = () => this.controller.abort();
    signal?.addEventListener?.('abort', onExternalAbort, { once: true });

    const state = {
      runId: `recipe-run-${Date.now()}-${++this.sequence}`,
      recipeId: recipe.id || null,
      recipeName: recipe.name || null,
      startedAt: Date.now(),
      completedAt: null,
      variables: cloneJson(variables) || {},
      evidence: [],
      passed: false,
      failure: null,
      defaultConnectionId,
    };
    this._emit('recipe.started', { runId: state.runId, recipeId: state.recipeId, recipeName: state.recipeName });

    try {
      await this._runSteps(recipe.steps, state, this.controller.signal, 'steps');
      state.passed = true;
      state.completedAt = Date.now();
      this._emit('recipe.passed', { runId: state.runId, elapsedMs: state.completedAt - state.startedAt });
      return this._snapshot(state);
    } catch (error) {
      state.completedAt = Date.now();
      state.failure = { code: error?.code || null, message: String(error?.message || error), details: cloneJson(error?.details || {}) };
      this._emit(error?.code === 'ABORTED' ? 'recipe.cancelled' : 'recipe.failed', { runId: state.runId, elapsedMs: state.completedAt - state.startedAt, errorCode: state.failure.code, error: state.failure.message });
      error.recipeResult = this._snapshot(state);
      throw error;
    } finally {
      signal?.removeEventListener?.('abort', onExternalAbort);
      this.running = false;
      this.paused = false;
      this.controller = null;
      this.resumeWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  async _runSteps(steps, state, signal, path) {
    for (let index = 0; index < steps.length; index += 1) {
      await this._waitWhilePaused(signal);
      if (signal.aborted) throw new RecipeEngineError('ABORTED', 'Recipe was aborted');
      const step = steps[index];
      const stepId = typeof step.id === 'string' && step.id.trim() ? step.id.trim() : `${path}.${index + 1}`;
      if (step.type === 'repeat') {
        for (let iteration = 0; iteration < step.count; iteration += 1) {
          setPath(state.variables, `${stepId}.iteration`, iteration + 1);
          await this._runSteps(step.steps, state, signal, `${stepId}.${iteration + 1}`);
        }
        continue;
      }
      await this._runStep(step, stepId, state, signal);
    }
  }

  async _runStep(step, stepId, state, signal) {
    const startedAt = Date.now();
    const evidence = {
      stepId,
      type: step.type,
      startedAt,
      completedAt: null,
      result: 'running',
      connectionId: step.connectionId || state.defaultConnectionId || null,
      requestRawHex: null,
      responseRawHex: null,
      value: null,
      error: null,
    };
    this._pushEvidence(state, evidence);
    this._emit('recipe.step-started', { runId: state.runId, stepId, type: step.type });

    const timeoutMs = step.timeoutMs == null ? 0 : Number(step.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RecipeEngineError('INVALID_TIMEOUT', 'step.timeoutMs must be >= 0', { stepId });
    const child = new AbortController();
    const abortChild = () => child.abort();
    signal.addEventListener('abort', abortChild, { once: true });
    let timer = null;
    if (timeoutMs > 0) timer = setTimeout(() => child.abort(), timeoutMs);

    try {
      const value = await this._executeStep(step, state, child.signal);
      evidence.value = cloneJson(value);
      evidence.completedAt = Date.now();
      evidence.result = 'passed';
      this._emit('recipe.step-passed', { runId: state.runId, stepId, type: step.type, elapsedMs: evidence.completedAt - startedAt });
      return value;
    } catch (error) {
      evidence.completedAt = Date.now();
      evidence.result = 'failed';
      evidence.error = { code: error?.code || (child.signal.aborted && !signal.aborted ? 'STEP_TIMEOUT' : null), message: String(error?.message || error) };
      if (child.signal.aborted && !signal.aborted && error?.code === 'ABORTED') throw new RecipeEngineError('STEP_TIMEOUT', `Recipe step ${stepId} exceeded ${timeoutMs} ms`, { stepId, timeoutMs });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', abortChild);
    }
  }

  async _executeStep(step, state, signal) {
    const connectionId = step.connectionId || state.defaultConnectionId || null;
    const context = connectionId ? this.resolveContext(connectionId) : null;
    if (connectionId && (!context || !context.master)) throw new RecipeEngineError('CONTEXT_NOT_FOUND', `No recipe context for connection ${connectionId}`, { connectionId });

    switch (step.type) {
      case 'connect': return context.master.open();
      case 'disconnect': return context.master.close({ release: step.release !== false });
      case 'armWrites': {
        if (!context.writeSafety) throw new RecipeEngineError('WRITE_SAFETY_REQUIRED', 'armWrites requires a WriteSafetyController context');
        return context.writeSafety.unlock({ durationMs: Number(step.durationMs ?? 0), confirmation: { confirmed: step.confirmation?.confirmed === true } });
      }
      case 'lockWrites': {
        if (!context.writeSafety) throw new RecipeEngineError('WRITE_SAFETY_REQUIRED', 'lockWrites requires a WriteSafetyController context');
        return context.writeSafety.lock({ reason: step.reason || 'recipe' });
      }
      case 'armLab': {
        if (!context.rawFrameStudio) throw new RecipeEngineError('RAW_STUDIO_REQUIRED', 'armLab requires a RawFrameStudio context');
        return context.rawFrameStudio.armLab({ durationMs: Number(step.durationMs ?? 0), confirmation: { confirmed: step.confirmation?.confirmed === true, raw: step.confirmation?.raw === true } });
      }
      case 'disarmLab': {
        if (!context.rawFrameStudio) throw new RecipeEngineError('RAW_STUDIO_REQUIRED', 'disarmLab requires a RawFrameStudio context');
        return context.rawFrameStudio.disarmLab(step.reason || 'recipe');
      }
      case 'delay':
        await delay(Number(step.ms ?? 0), signal);
        return { delayedMs: Number(step.ms ?? 0) };
      case 'set':
        setPath(state.variables, step.variable, cloneJson(step.value));
        return { variable: step.variable, value: cloneJson(step.value) };
      case 'read': {
        const pdu = protocol.encodeReadRequest({ functionCode: Number(step.functionCode), address: Number(step.address), quantity: Number(step.quantity) });
        const result = await context.master.request({ unitId: Number(step.unitId), pdu, timeoutMs: step.requestTimeoutMs, signal });
        const value = result.decoded?.values ?? result.decoded ?? null;
        if (step.saveAs) setPath(state.variables, step.saveAs, cloneJson(value));
        this._attachRawEvidence(state, result);
        return value;
      }
      case 'write': {
        if (!context.writeSafety || typeof context.writeSafety.execute !== 'function') throw new RecipeEngineError('WRITE_SAFETY_REQUIRED', 'Recipe writes require a WriteSafetyController context');
        const pdu = encodeWriteStep(step);
        const result = await context.writeSafety.execute({
          unitId: Number(step.unitId),
          pdu,
          confirmation: { confirmed: step.confirmation?.confirmed === true, bulk: step.confirmation?.bulk === true, broadcast: step.confirmation?.broadcast === true },
          captureOldValue: step.captureOldValue !== false,
          readBack: step.readBack === true,
          context: { recipeStepId: step.id || null },
        });
        this._attachRawEvidence(state, result);
        if (step.saveAs) setPath(state.variables, step.saveAs, cloneJson(result.decoded ?? null));
        return result.decoded ?? { ok: true };
      }
      case 'raw': {
        if (!context.rawFrameStudio || typeof context.rawFrameStudio.send !== 'function') throw new RecipeEngineError('RAW_STUDIO_REQUIRED', 'Raw recipe steps require a RawFrameStudio context');
        const result = await context.rawFrameStudio.send({
          hex: step.hex,
          ascii: step.ascii,
          autoChecksum: step.autoChecksum === true,
          expectResponse: step.expectResponse !== false,
          timeoutMs: step.requestTimeoutMs ?? 1000,
          confirmation: step.confirmation || null,
          expectedHex: step.expectedHex ?? null,
          expectedMaskHex: step.expectedMaskHex ?? null,
          signal,
        });
        this._attachRawEvidence(state, result);
        if (step.saveAs) setPath(state.variables, step.saveAs, result.responseRaw?.toString('hex').toUpperCase() || null);
        return { intent: result.intent, responseHex: result.responseRaw?.toString('hex').toUpperCase() || null };
      }
      case 'assert': {
        const actual = getPath(state.variables, step.variable);
        const operator = step.operator || 'equals';
        if (!assertionPasses(operator, actual, step.expected)) {
          throw new RecipeEngineError('ASSERTION_FAILED', step.message || `Assertion failed for ${step.variable}`, { variable: step.variable, operator, expected: cloneJson(step.expected), actual: cloneJson(actual) });
        }
        return { passed: true, variable: step.variable, operator, actual: cloneJson(actual), expected: cloneJson(step.expected) };
      }
      default: throw new RecipeEngineError('INVALID_STEP_TYPE', `Unsupported executable step type ${step.type}`);
    }
  }

  _attachRawEvidence(state, result) {
    const row = state.evidence[state.evidence.length - 1];
    if (!row) return;
    row.requestRawHex = result?.requestRaw?.toString?.('hex')?.toUpperCase?.() || null;
    row.responseRawHex = result?.responseRaw?.toString?.('hex')?.toUpperCase?.() || null;
  }

  async _waitWhilePaused(signal) {
    while (this.paused) {
      if (signal.aborted) throw new RecipeEngineError('ABORTED', 'Recipe was aborted');
      await new Promise((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  _pushEvidence(state, evidence) {
    state.evidence.push(evidence);
    if (state.evidence.length > this.maxEvidenceEntries) state.evidence.splice(0, state.evidence.length - this.maxEvidenceEntries);
  }

  _snapshot(state) {
    return Object.freeze({
      runId: state.runId,
      recipeId: state.recipeId,
      recipeName: state.recipeName,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      elapsedMs: state.completedAt == null ? null : state.completedAt - state.startedAt,
      passed: state.passed,
      failure: state.failure ? Object.freeze(cloneJson(state.failure)) : null,
      variables: Object.freeze(cloneJson(state.variables)),
      evidence: Object.freeze(state.evidence.map((row) => Object.freeze(cloneJson(row)))),
    });
  }

  _emit(type, details) {
    this.emit('event', createWorkbenchEvent({ type, source: 'recipe-engine', ownerMode: 'test', details }));
  }
}

module.exports = {
  RECIPE_SCHEMA_VERSION,
  STEP_TYPES,
  RecipeEngine,
  RecipeEngineError,
  validateRecipe,
  encodeWriteStep,
  assertionPasses,
  getPath,
  setPath,
};
