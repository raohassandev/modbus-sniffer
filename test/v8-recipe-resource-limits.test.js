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

test('v8 recipe safety preflight rejects missing arm/write confirmations before execution', () => {
  assert.throws(
    () => v8.validateRecipe({ schemaVersion: 1, steps: [{ type: 'armWrites', connectionId: 'c1' }] }),
    (error) => error.code === 'CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => v8.validateRecipe({ schemaVersion: 1, steps: [{ type: 'armLab', connectionId: 'c1', confirmation: { confirmed: true } }] }),
    (error) => error.code === 'LAB_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => v8.validateRecipe({
      schemaVersion: 1,
      steps: [{ type: 'write', connectionId: 'c1', unitId: 1, functionCode: 16, address: 0, values: [1], confirmation: { confirmed: true } }],
    }),
    (error) => error.code === 'BULK_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => v8.validateRecipe({
      schemaVersion: 1,
      steps: [{ type: 'write', connectionId: 'c1', unitId: 0, functionCode: 6, address: 0, value: 1, confirmation: { confirmed: true } }],
    }),
    (error) => error.code === 'BROADCAST_CONFIRMATION_REQUIRED',
  );
});

test('v8 Test Center rejects an unsafe recipe before acquiring any connection session', async () => {
  const service = new v8.TestCenterWorkspaceService({ store: {}, broker: {}, connectionCenter: {} });
  let acquired = 0;
  service._ensureSession = async () => {
    acquired += 1;
    throw new Error('must not acquire');
  };

  await assert.rejects(
    () => service.runRecipe({
      schemaVersion: 1,
      steps: [{ type: 'write', connectionId: 'c1', unitId: 1, functionCode: 16, address: 0, values: [1], confirmation: { confirmed: true } }],
    }),
    (error) => error.code === 'BULK_CONFIRMATION_REQUIRED',
  );
  assert.equal(acquired, 0);
});
