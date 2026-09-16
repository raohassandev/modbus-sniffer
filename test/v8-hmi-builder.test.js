'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('../src/v8');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-hmi-'));
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const reads = [];
  const writes = [];
  const masterWorkspace = {
    async readOnce(spec) {
      reads.push(spec);
      return { decoded: { values: [123] }, rttMs: 4, requestRawHex: '010300000001840A', responseRawHex: '010302007BF867' };
    },
    async writeOnce(spec) {
      writes.push(spec);
      return { ok: true, decoded: { functionCode: spec.functionCode }, requestRawHex: 'WRITE', responseRawHex: 'ACK' };
    },
  };
  const recipes = [];
  const testCenter = { async runRecipe(recipe, options) { recipes.push({ recipe, options }); return { ok: true, recipeId: recipe.recipeId }; } };
  const hmi = new v8.HmiBuilderService({ store, masterWorkspace, testCenter });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  return { store, hmi, reads, writes, recipes };
}

test('v8 HMI persists normalized screens, snaps geometry and supports the planned widget palette', (t) => {
  const { store, hmi } = setup(t);
  const screen = hmi.save({
    screenId: 'main', name: 'Plant Overview', width: 1280, height: 720,
    grid: { size: 10, snap: true, visible: true },
    widgets: [
      { widgetId: 'power', type: 'numericDisplay', x: 13, y: 26, w: 153, h: 77, binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 10, dataType: 'uint16', scale: 0.1, unit: 'kW' } },
      { widgetId: 'run', type: 'lamp', x: 200, y: 20 },
      { widgetId: 'cmd', type: 'numericInput', x: 400, y: 20, binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 20, dataType: 'uint16', scale: 0.1 }, write: { functionCode: 6, readBack: true } },
      { widgetId: 'status', type: 'bitfield', x: 600, y: 20 },
      { widgetId: 'trend', type: 'trend', x: 20, y: 160, w: 600, h: 240 },
    ],
  });
  assert.equal(screen.widgets[0].x, 10);
  assert.equal(screen.widgets[0].y, 30);
  assert.equal(screen.widgets[0].w, 150);
  assert.equal(screen.widgets[0].h, 80);
  assert.deepEqual(screen.widgets.map((item) => item.type), ['numericDisplay', 'lamp', 'numericInput', 'bitfield', 'trend']);
  assert.equal(store.getActiveProject().hmiScreens[0].screenId, 'main');
});

test('v8 HMI runtime reads through Master workspace and applies engineering scaling', async (t) => {
  const { hmi, reads } = setup(t);
  hmi.save({ screenId: 'main', widgets: [{ widgetId: 'power', type: 'numericDisplay', binding: { connectionId: 'grid', unitId: 2, functionCode: 3, address: 10, dataType: 'uint16', scale: 0.1, offset: 1, unit: 'kW' } }] });
  const result = await hmi.readWidget('main', 'power');
  assert.equal(result.value, 13.3);
  assert.equal(result.unit, 'kW');
  assert.deepEqual(reads[0], { connectionId: 'grid', unitId: 2, functionCode: 3, address: 10, quantity: 1, dataType: 'uint16', byteOrder: null, scale: 0.1, offset: 1, unit: 'kW', precision: 2, staleAfterMs: 5000 });
});

test('v8 HMI write widgets cannot bypass explicit confirmation and central Master write safety', async (t) => {
  const { hmi, writes } = setup(t);
  hmi.save({ screenId: 'main', widgets: [{ widgetId: 'setpoint', type: 'numericInput', binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 20, dataType: 'uint16', scale: 0.1 }, write: { functionCode: 6, readBack: true, autoLockMs: 5000 } }] });
  await assert.rejects(() => hmi.writeWidget('main', 'setpoint', { value: 12.5 }), (error) => error.code === 'CONFIRMATION_REQUIRED');
  const result = await hmi.writeWidget('main', 'setpoint', { value: 12.5, confirmation: { confirmed: true } });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].connectionId, 'grid');
  assert.equal(writes[0].functionCode, 6);
  assert.equal(writes[0].address, 20);
  assert.equal(writes[0].value, 125);
  assert.equal(writes[0].readBack, true);
  assert.deepEqual(writes[0].confirmation, { confirmed: true, bulk: false });
});

test('v8 HMI switch writes use guarded FC05 and templates create independent widget IDs', async (t) => {
  const { hmi, writes } = setup(t);
  hmi.save({ screenId: 'main', widgets: [{ widgetId: 'pump', type: 'switch', binding: { connectionId: 'plc', unitId: 3, functionCode: 1, address: 5, dataType: 'bool' }, write: { readBack: true } }] });
  await hmi.writeWidget('main', 'pump', { value: true, confirmation: { confirmed: true } });
  assert.equal(writes[0].functionCode, 5);
  assert.equal(writes[0].value, true);
  const template = hmi.saveTemplate({ templateId: 'motor', name: 'Motor', widgets: [{ widgetId: 'lamp-template', type: 'lamp', x: 0, y: 0 }] });
  assert.equal(template.templateId, 'motor');
  const updated = hmi.applyTemplate('main', 'motor', { x: 100, y: 100 });
  const added = updated.widgets.find((widget) => widget.type === 'lamp');
  assert.ok(added.widgetId !== 'lamp-template');
  assert.equal(added.x, 100);
  assert.equal(added.y, 100);
});

test('v8 HMI recipe buttons require confirmation while screen navigation remains passive', async (t) => {
  const { store, hmi, recipes } = setup(t);
  store.updateProject(store.getActiveProject().id, { testRecipes: [{ recipeId: 'safe-read', name: 'Safe read', steps: [] }] });
  hmi.save({ screenId: 'main', widgets: [
    { widgetId: 'go', type: 'button', action: { kind: 'screen', targetId: 'details' } },
    { widgetId: 'recipe', type: 'button', action: { kind: 'recipe', targetId: 'safe-read', defaultConnectionId: 'grid' } },
  ] });
  assert.deepEqual(await hmi.triggerWidget('main', 'go'), { kind: 'screen', targetId: 'details' });
  await assert.rejects(() => hmi.triggerWidget('main', 'recipe'), (error) => error.code === 'CONFIRMATION_REQUIRED');
  await hmi.triggerWidget('main', 'recipe', { confirmation: { confirmed: true }, variables: { n: 1 } });
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].recipe.recipeId, 'safe-read');
});

test('v8 HMI rejects unsupported widget types and duplicate widget IDs', (t) => {
  const { hmi } = setup(t);
  assert.throws(() => hmi.save({ screenId: 'bad', widgets: [{ type: 'script' }] }), (error) => error.code === 'INVALID_WIDGET_TYPE');
  assert.throws(() => hmi.save({ screenId: 'dup', widgets: [{ widgetId: 'x', type: 'text' }, { widgetId: 'x', type: 'lamp' }] }), (error) => error.code === 'DUPLICATE_WIDGET_ID');
});
