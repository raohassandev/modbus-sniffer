'use strict';

const { EventEmitter } = require('node:events');
const {
  RecipeEngine,
  RecipeEngineError,
  validateRecipe: validateHardenedRecipe,
} = require('../v8/testCenter/recipeEngineHardened');

const ALLOWED_STEP_TYPES = Object.freeze(new Set([
  'read',
  'write',
  'delay',
  'set',
  'assert',
  'repeat',
]));

const MAX_HISTORY = 100;
const DEFAULT_MAX_EXPANDED_STEPS = 2000;
const DEFAULT_MAX_REPEAT_DEPTH = 6;

class TestSequenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TestSequenceError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, TestSequenceError);
  }
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function walkSteps(steps, visit, path = 'steps') {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepPath = `${path}[${index}]`;
    visit(step, stepPath);
    if (step.type === 'repeat') walkSteps(step.steps, visit, `${stepPath}.steps`);
  }
}

function validateStableSequence(recipe, {
  maxExpandedSteps = DEFAULT_MAX_EXPANDED_STEPS,
  maxRepeatDepth = DEFAULT_MAX_REPEAT_DEPTH,
} = {}) {
  if (recipe && typeof recipe === 'object' && Array.isArray(recipe.steps)) {
    const rejectForbidden = (steps, path = 'steps') => {
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const stepPath = `${path}[${index}]`;
        if (step && typeof step === 'object' && !Array.isArray(step) && typeof step.type === 'string' && !ALLOWED_STEP_TYPES.has(step.type)) {
          throw new TestSequenceError(
            'STEP_NOT_ALLOWED',
            `Step type ${step.type} is not allowed in stable Test Sequences`,
            { path: stepPath, type: step.type, allowed: [...ALLOWED_STEP_TYPES] }
          );
        }
        if (step?.type === 'repeat' && Array.isArray(step.steps)) rejectForbidden(step.steps, `${stepPath}.steps`);
      }
    };
    rejectForbidden(recipe.steps);
  }

  const budget = validateHardenedRecipe(recipe, { maxExpandedSteps, maxRepeatDepth });
  let writes = 0;
  let reads = 0;
  let assertions = 0;

  walkSteps(recipe.steps, (step, path) => {
    if (!ALLOWED_STEP_TYPES.has(step.type)) {
      throw new TestSequenceError(
        'STEP_NOT_ALLOWED',
        `Step type ${step.type} is not allowed in stable Test Sequences`,
        { path, type: step.type, allowed: [...ALLOWED_STEP_TYPES] }
      );
    }
    if (step.connectionId != null && String(step.connectionId) !== 'stable-master') {
      throw new TestSequenceError(
        'CONNECTION_NOT_ALLOWED',
        'Stable Test Sequences can target only the currently connected stable Master',
        { path, connectionId: step.connectionId }
      );
    }
    if (step.type === 'read') {
      reads += 1;
      const fc = Number(step.functionCode);
      if (![1, 2, 3, 4].includes(fc)) {
        throw new TestSequenceError('READ_FUNCTION_NOT_ALLOWED', 'Sequence read steps support FC01..FC04 only', { path, functionCode: fc });
      }
    }
    if (step.type === 'write') writes += 1;
    if (step.type === 'assert') assertions += 1;
    if (step.type === 'delay') {
      const ms = Number(step.ms ?? 0);
      if (!Number.isFinite(ms) || ms < 0 || ms > 10 * 60 * 1000) {
        throw new TestSequenceError('DELAY_OUT_OF_RANGE', 'Sequence delay must be 0..600000 ms', { path, ms });
      }
    }
  });

  return Object.freeze({
    valid: true,
    expandedSteps: budget.expandedSteps,
    maxExpandedSteps: budget.maxExpandedSteps,
    maxRepeatDepth: budget.maxRepeatDepth,
    reads,
    writes,
    assertions,
  });
}

function normalizeStableSequence(recipe) {
  const out = cloneJson(recipe);
  walkSteps(out.steps, (step) => {
    delete step.connectionId;
    if (step.type === 'write' && step.readBack == null) step.readBack = true;
  });
  return out;
}

function defaultTemplates() {
  return Object.freeze([
    Object.freeze({
      id: 'read-and-assert',
      name: 'Read & Assert Holding Register',
      description: 'Read FC03 values and assert the expected register is present.',
      recipe: Object.freeze({
        schemaVersion: 1,
        id: 'read-and-assert',
        name: 'Read & Assert Holding Register',
        steps: Object.freeze([
          Object.freeze({ type: 'read', id: 'read', unitId: 1, functionCode: 3, address: 0, quantity: 2, saveAs: 'holding' }),
          Object.freeze({ type: 'assert', id: 'assert', variable: 'holding', operator: 'includes', expected: 123 }),
        ]),
      }),
    }),
    Object.freeze({
      id: 'poll-repeat',
      name: 'Repeat Read Test',
      description: 'Repeat a read with a controlled delay and preserve last values.',
      recipe: Object.freeze({
        schemaVersion: 1,
        id: 'poll-repeat',
        name: 'Repeat Read Test',
        steps: Object.freeze([
          Object.freeze({
            type: 'repeat',
            id: 'cycle',
            count: 5,
            steps: Object.freeze([
              Object.freeze({ type: 'read', id: 'sample', unitId: 1, functionCode: 3, address: 0, quantity: 4, saveAs: 'sample' }),
              Object.freeze({ type: 'delay', id: 'wait', ms: 250 }),
            ]),
          }),
        ]),
      }),
    }),
    Object.freeze({
      id: 'guarded-write-readback',
      name: 'Guarded Write + Verify',
      description: 'Write FC06 with explicit confirmation, automatic re-lock and read-back verification.',
      recipe: Object.freeze({
        schemaVersion: 1,
        id: 'guarded-write-readback',
        name: 'Guarded Write + Verify',
        steps: Object.freeze([
          Object.freeze({
            type: 'write',
            id: 'write',
            unitId: 1,
            functionCode: 6,
            address: 0,
            value: 321,
            confirmation: Object.freeze({ confirmed: true }),
            readBack: true,
          }),
          Object.freeze({ type: 'read', id: 'verify-read', unitId: 1, functionCode: 3, address: 0, quantity: 1, saveAs: 'after' }),
          Object.freeze({ type: 'assert', id: 'verify-assert', variable: 'after', operator: 'includes', expected: 321 }),
        ]),
      }),
    }),
  ]);
}

class TestSequenceService extends EventEmitter {
  constructor({
    masterRuntime,
    maxHistory = MAX_HISTORY,
    maxExpandedSteps = DEFAULT_MAX_EXPANDED_STEPS,
    maxRepeatDepth = DEFAULT_MAX_REPEAT_DEPTH,
  } = {}) {
    super();
    if (!masterRuntime) throw new TypeError('masterRuntime is required');
    if (!Number.isInteger(maxHistory) || maxHistory < 1 || maxHistory > 1000) throw new TypeError('maxHistory must be 1..1000');
    this.masterRuntime = masterRuntime;
    this.maxHistory = maxHistory;
    this.maxExpandedSteps = maxExpandedSteps;
    this.maxRepeatDepth = maxRepeatDepth;
    this.runs = [];
    this.lastRun = null;

    const writeSafetyAdapter = {
      execute: async ({ unitId, pdu, confirmation, captureOldValue, readBack, context }) => {
        return this.masterRuntime.writePdu({
          unitId,
          pdu,
          confirmation,
          captureOldValue,
          readBack,
          autoLockMs: 10000,
          source: 'stable-test-sequence',
          comment: context?.recipeStepId ? `Test Sequence step ${context.recipeStepId}` : 'Test Sequence write',
        });
      },
    };

    this.engine = new RecipeEngine({
      maxExpandedSteps,
      maxRepeatDepth,
      resolveContext: (connectionId) => {
        if (connectionId !== 'stable-master') return null;
        if (!this.masterRuntime.engine) return null;
        return {
          master: this.masterRuntime.engine,
          writeSafety: writeSafetyAdapter,
        };
      },
    });
    this.engine.on('event', (event) => this.emit('event', event));
  }

  templates() {
    return defaultTemplates();
  }

  validate(recipe) {
    return validateStableSequence(recipe, {
      maxExpandedSteps: this.maxExpandedSteps,
      maxRepeatDepth: this.maxRepeatDepth,
    });
  }

  status() {
    const engine = this.engine.status();
    const master = this.masterRuntime.status();
    return Object.freeze({
      running: engine.running,
      paused: engine.paused,
      masterConnected: Boolean(master.connected),
      masterConnection: master.config || null,
      writeState: master.writeState,
      lastRun: this.lastRun,
      historyCount: this.runs.length,
    });
  }

  history({ limit = 20 } = {}) {
    const safeLimit = Math.max(1, Math.min(this.maxHistory, Number(limit) || 20));
    return Object.freeze(this.runs.slice(-safeLimit).map((run) => Object.freeze(cloneJson(run))));
  }

  async run(recipe, { variables = {} } = {}) {
    const master = this.masterRuntime.status();
    if (!master.connected || !this.masterRuntime.engine || !this.masterRuntime.safety) {
      throw new TestSequenceError('MASTER_NOT_CONNECTED', 'Connect the stable Modbus Master before running a Test Sequence');
    }

    const validation = this.validate(recipe);
    const normalized = normalizeStableSequence(recipe);
    let snapshot = null;
    try {
      snapshot = await this.engine.run(normalized, {
        variables: cloneJson(variables) || {},
        defaultConnectionId: 'stable-master',
      });
      this._record(snapshot);
      return Object.freeze({ validation, result: snapshot });
    } catch (error) {
      if (error?.recipeResult) {
        snapshot = error.recipeResult;
        this._record(snapshot);
      }
      throw error;
    } finally {
      if (this.masterRuntime.safety) {
        try { this.masterRuntime.safety.lock({ reason: 'test-sequence-finalize' }); } catch { /* connection may have closed */ }
      }
    }
  }

  pause() {
    this.engine.pause();
    return this.status();
  }

  resume() {
    this.engine.resume();
    return this.status();
  }

  stop() {
    this.engine.stop();
    if (this.masterRuntime.safety) {
      try { this.masterRuntime.safety.lock({ reason: 'test-sequence-stop' }); } catch { /* connection may have closed */ }
    }
    return this.status();
  }

  _record(snapshot) {
    const record = cloneJson(snapshot);
    this.lastRun = Object.freeze(record);
    this.runs.push(record);
    if (this.runs.length > this.maxHistory) this.runs.splice(0, this.runs.length - this.maxHistory);
    this.emit('run', this.lastRun);
  }
}

module.exports = {
  ALLOWED_STEP_TYPES,
  DEFAULT_MAX_EXPANDED_STEPS,
  DEFAULT_MAX_REPEAT_DEPTH,
  TestSequenceError,
  TestSequenceService,
  defaultTemplates,
  normalizeStableSequence,
  validateStableSequence,
  walkSteps,
};
