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

function validateRecipe(recipe, options = {}) {
  recipeExecutionBudget(recipe, options);
  return true;
}

class RecipeEngine extends base.RecipeEngine {
  constructor({ maxExpandedSteps = DEFAULT_MAX_EXPANDED_STEPS, maxRepeatDepth = DEFAULT_MAX_REPEAT_DEPTH, ...options } = {}) {
    super(options);
    this.maxExpandedSteps = positiveInteger(maxExpandedSteps, DEFAULT_MAX_EXPANDED_STEPS, 'maxExpandedSteps');
    this.maxRepeatDepth = positiveInteger(maxRepeatDepth, DEFAULT_MAX_REPEAT_DEPTH, 'maxRepeatDepth');
  }

  run(recipe, options = {}) {
    recipeExecutionBudget(recipe, {
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
  validateRecipe,
  RecipeEngine,
};
