'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

function engine(options = {}) {
  return new v8.DynamicValueEngine({ resolveDevice: () => null, ...options });
}

test('v8 simulator generator engine caps total generator definitions', () => {
  const generators = engine({ maxGenerators: 2 });
  generators.upsert({ generatorId: 'g1', serverId: 's1', unitId: 1, kind: 'constant', area: 'holdingRegisters', address: 0, params: { value: 1 } });
  generators.upsert({ generatorId: 'g2', serverId: 's1', unitId: 1, kind: 'constant', area: 'holdingRegisters', address: 1, params: { value: 2 } });
  assert.throws(
    () => generators.upsert({ generatorId: 'g3', serverId: 's1', unitId: 1, kind: 'constant', area: 'holdingRegisters', address: 2, params: { value: 3 } }),
    (error) => error.code === 'GENERATOR_LIMIT' && error.details?.maxGenerators === 2,
  );
});

test('v8 simulator formula and schedule inputs are resource bounded before compilation', () => {
  const generators = engine({ maxFormulaChars: 8, maxScheduleSteps: 2 });
  assert.throws(
    () => generators.upsert({ generatorId: 'formula', serverId: 's1', unitId: 1, kind: 'formula', area: 'holdingRegisters', address: 0, params: { expression: 'x+x+x+x+x' } }),
    (error) => error.code === 'FORMULA_LENGTH_LIMIT',
  );
  assert.throws(
    () => generators.upsert({ generatorId: 'schedule', serverId: 's1', unitId: 1, kind: 'schedule', area: 'holdingRegisters', address: 0, params: { steps: [{ afterMs: 0, value: 1 }, { afterMs: 1, value: 2 }, { afterMs: 2, value: 3 }] } }),
    (error) => error.code === 'SCHEDULE_STEP_LIMIT',
  );
});

test('v8 simulator formulas use the parser rather than arbitrary JavaScript execution', () => {
  assert.throws(
    () => v8.compileFormula('process.exit()'),
    (error) => error.code === 'INVALID_FORMULA',
  );
  const compiled = v8.compileFormula('(x * 2) + i');
  assert.equal(v8.evaluateFormula(compiled, { x: 5, t: 0, i: 3 }), 13);
});
