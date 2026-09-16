'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

function repeated(count, steps) {
  return { type: 'repeat', count, steps };
}

test('v8 recipes reject expanded workloads above the execution budget', () => {
  const recipe = {
    schemaVersion: v8.RECIPE_SCHEMA_VERSION,
    steps: [repeated(1000, [repeated(1000, [{ type: 'delay', ms: 0 }])])],
  };
  assert.throws(
    () => v8.validateRecipe(recipe),
    (error) => error.code === 'RECIPE_EXECUTION_LIMIT' && error.details?.maxExpandedSteps === 10000,
  );
});

test('v8 recipes reject excessive repeat nesting', () => {
  let step = { type: 'delay', ms: 0 };
  for (let depth = 0; depth < 9; depth += 1) step = repeated(1, [step]);
  const recipe = { schemaVersion: v8.RECIPE_SCHEMA_VERSION, steps: [step] };
  assert.throws(
    () => v8.validateRecipe(recipe),
    (error) => error.code === 'RECIPE_NESTING_LIMIT' && error.details?.maxRepeatDepth === 8,
  );
});

test('v8 RecipeEngine enforces expansion budget before resolving any I/O context', async () => {
  let resolved = 0;
  const engine = new v8.RecipeEngine({
    resolveContext() {
      resolved += 1;
      return { master: { open: async () => ({}) } };
    },
  });
  const recipe = {
    schemaVersion: v8.RECIPE_SCHEMA_VERSION,
    steps: [repeated(1000, [repeated(1000, [{ type: 'connect', connectionId: 'unsafe' }])])],
  };
  await assert.rejects(
    () => engine.run(recipe, { defaultConnectionId: 'unsafe' }),
    (error) => error.code === 'RECIPE_EXECUTION_LIMIT',
  );
  assert.equal(resolved, 0);
});
