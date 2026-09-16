'use strict';

const base = require('./recipeEngine');

const DEFAULT_MAX_EXPANDED_STEPS = 10000;
const DEFAULT_MAX_REPEAT_DEPTH = 8;

function positiveInteger(value, fallback, name) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

function recipeExecutionBudget(recipe, {
  maxExpandedSteps = DEFAULT_MAX_EXPANDED_STEPS,
  maxRepeatDepth = DEFAULT_MAX_REPEAT_DEPTH,
} = {}) {
  base.validateRecipe(recipe);
  const stepLimit = positiveInteger(maxExpandedSteps, DEFAULT_MAX_EXPANDED_STEPS, 'maxExpandedSteps');
  const depthLimit = positiveInteger(maxRepeatDepth, DEFAULT_MAX_REPEAT_DEPTH, 'maxRepeatDepth');
  const limit = BigInt(stepLimit);

  function countSteps(steps, depth, path) {
    if (depth > depthLimit) {
      throw new base.RecipeEngineError('RECIPE_NESTING_LIMIT', `Recipe repeat nesting exceeds ${depthLimit}`, {
        maxRepeatDepth: depthLimit,
        path,
      });
    }
    let total = 0n;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      if (step.type === 'repeat') {
        const child = countSteps(step.steps, depth + 1, `${path}[${index}].steps`);
        total += BigInt(step.count) * child;
      } else {
        total += 1n;
      }
      if (total > limit) {
        throw new base.RecipeEngineError('RECIPE_EXECUTION_LIMIT', `Recipe expands beyond ${stepLimit} executable steps`, {
          maxExpandedSteps: stepLimit,
          path: `${path}[${index}]`,
        });
      }
    }
    return total;
  }

  const expandedSteps = countSteps(recipe.steps, 0, 'steps');
  return Object.freeze({ expandedSteps: Number(expandedSteps), maxExpandedSteps: stepLimit, maxRepeatDepth: depthLimit });
}

function validateRecipeSafety(recipe) {
  function visit(steps, path) {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const stepPath = `${path}[${index}]`;
      if (step.type === 'repeat') {
        visit(step.steps, `${stepPath}.steps`);
        continue;
      }
      if (step.type === 'armWrites' && step.confirmation?.confirmed !== true) {
        throw new base.RecipeEngineError('CONFIRMATION_REQUIRED', 'armWrites requires explicit confirmation', { path: stepPath });
      }
      if (step.type === 'armLab' && (step.confirmation?.confirmed !== true || step.confirmation?.raw !== true)) {
        throw new base.RecipeEngineError('LAB_CONFIRMATION_REQUIRED', 'armLab requires confirmed=true and raw=true', { path: stepPath });
      }
      if (step.type === 'write') {
        if (step.confirmation?.confirmed !== true) {
          throw new base.RecipeEngineError('CONFIRMATION_REQUIRED', 'Recipe write requires explicit confirmation', { path: stepPath });
        }
        const functionCode = Number(step.functionCode);
        // Validate function-specific payload shape before any connection/session is acquired.
        base.encodeWriteStep(step);
        if ([15, 16, 23].includes(functionCode) && step.confirmation?.bulk !== true) {
          throw new base.RecipeEngineError('BULK_CONFIRMATION_REQUIRED', 'FC15/FC16/FC23 recipe writes require bulk=true', { path: stepPath, functionCode });
        }
        if (Number(step.unitId) === 0 && step.confirmation?.broadcast !== true) {
          throw new base.RecipeEngineError('BROADCAST_CONFIRMATION_REQUIRED', 'Recipe broadcast writes require broadcast=true', { path: stepPath });
        }
      }
    }
  }
  visit(recipe.steps, 'steps');
  return true;
}

function validateRecipe(recipe, options = {}) {
  const budget = recipeExecutionBudget(recipe, options);
  validateRecipeSafety(recipe);
  return budget;
}

class RecipeEngine extends base.RecipeEngine {
  constructor({ maxExpandedSteps = DEFAULT_MAX_EXPANDED_STEPS, maxRepeatDepth = DEFAULT_MAX_REPEAT_DEPTH, ...options } = {}) {
    super(options);
    this.maxExpandedSteps = positiveInteger(maxExpandedSteps, DEFAULT_MAX_EXPANDED_STEPS, 'maxExpandedSteps');
    this.maxRepeatDepth = positiveInteger(maxRepeatDepth, DEFAULT_MAX_REPEAT_DEPTH, 'maxRepeatDepth');
  }

  run(recipe, options = {}) {
    validateRecipe(recipe, {
      maxExpandedSteps: this.maxExpandedSteps,
      maxRepeatDepth: this.maxRepeatDepth,
    });
    return super.run(recipe, options);
  }
}

module.exports = {
  ...base,
  DEFAULT_MAX_EXPANDED_STEPS,
  DEFAULT_MAX_REPEAT_DEPTH,
  recipeExecutionBudget,
  validateRecipeSafety,
  validateRecipe,
  RecipeEngine,
};
