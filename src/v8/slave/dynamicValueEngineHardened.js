'use strict';

const base = require('./dynamicValueEngine');

const DEFAULT_MAX_GENERATORS = 1000;
const DEFAULT_MAX_SCHEDULE_STEPS = 1000;
const DEFAULT_MAX_FORMULA_CHARS = 4096;

function positiveInteger(value, fallback, name) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

class DynamicValueEngine extends base.DynamicValueEngine {
  constructor({
    maxGenerators = DEFAULT_MAX_GENERATORS,
    maxScheduleSteps = DEFAULT_MAX_SCHEDULE_STEPS,
    maxFormulaChars = DEFAULT_MAX_FORMULA_CHARS,
    ...options
  } = {}) {
    super(options);
    this.maxGenerators = positiveInteger(maxGenerators, DEFAULT_MAX_GENERATORS, 'maxGenerators');
    this.maxScheduleSteps = positiveInteger(maxScheduleSteps, DEFAULT_MAX_SCHEDULE_STEPS, 'maxScheduleSteps');
    this.maxFormulaChars = positiveInteger(maxFormulaChars, DEFAULT_MAX_FORMULA_CHARS, 'maxFormulaChars');
  }

  upsert(input) {
    const generatorId = String(input?.generatorId || '').trim();
    const existing = generatorId ? this.configs.get(generatorId) : null;
    if (generatorId && !existing && this.configs.size >= this.maxGenerators) {
      throw new base.DynamicValueError('GENERATOR_LIMIT', `Simulator generator limit ${this.maxGenerators} reached`, {
        maxGenerators: this.maxGenerators,
      });
    }

    const kind = String(input?.kind || existing?.kind || '').trim().toLowerCase();
    const params = input?.params && typeof input.params === 'object' && !Array.isArray(input.params)
      ? input.params
      : existing?.params || {};

    if (kind === 'formula' && String(params.expression || '').length > this.maxFormulaChars) {
      throw new base.DynamicValueError('FORMULA_LENGTH_LIMIT', `Formula exceeds ${this.maxFormulaChars} characters`, {
        maxFormulaChars: this.maxFormulaChars,
      });
    }
    if (kind === 'schedule' && Array.isArray(params.steps) && params.steps.length > this.maxScheduleSteps) {
      throw new base.DynamicValueError('SCHEDULE_STEP_LIMIT', `Schedule exceeds ${this.maxScheduleSteps} steps`, {
        maxScheduleSteps: this.maxScheduleSteps,
      });
    }
    return super.upsert(input);
  }
}

module.exports = {
  ...base,
  DEFAULT_MAX_GENERATORS,
  DEFAULT_MAX_SCHEDULE_STEPS,
  DEFAULT_MAX_FORMULA_CHARS,
  DynamicValueEngine,
};
