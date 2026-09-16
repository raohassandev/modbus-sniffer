'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('../src/v8');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-hmi-hardening-'));
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const masterWorkspace = {
    async readOnce() { return { decoded: { values: [1] }, rttMs: 1, requestRawHex: 'AA', responseRawHex: 'BB' }; },
    async writeOnce() { return { ok: true }; },
  };
  const hmi = new v8.HmiBuilderService({ store, masterWorkspace });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));
  return { store, hmi };
}

test('v8 HMI draft widgets with an empty connection remain saveable but unbound', (t) => {
  const { hmi } = setup(t);
  const screen = hmi.save({ screenId: 'draft', widgets: [{ widgetId: 'value', type: 'numericDisplay', binding: { connectionId: '', unitId: 1, functionCode: 3, address: 0 } }] });
  assert.equal(screen.widgets[0].binding, null);
});

test('v8 HMI rejects protocol bindings instead of silently clamping invalid Unit IDs or addresses', (t) => {
  const { hmi } = setup(t);
  assert.throws(
    () => hmi.save({ screenId: 'bad-unit', widgets: [{ type: 'numericDisplay', binding: { connectionId: 'grid', unitId: 999, functionCode: 3, address: 0 } }] }),
    (error) => error.code === 'INVALID_BINDING' && /unitId/.test(error.message),
  );
  assert.throws(
    () => hmi.save({ screenId: 'bad-address', widgets: [{ type: 'numericDisplay', binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: -1 } }] }),
    (error) => error.code === 'INVALID_BINDING' && /address/.test(error.message),
  );
});

test('v8 HMI validates read area/data type combinations and byte permutations at save time', (t) => {
  const { hmi } = setup(t);
  assert.throws(
    () => hmi.save({ screenId: 'bad-coil', widgets: [{ type: 'lamp', binding: { connectionId: 'grid', unitId: 1, functionCode: 1, address: 0, dataType: 'uint16' } }] }),
    (error) => error.code === 'INVALID_BINDING',
  );
  assert.throws(
    () => hmi.save({ screenId: 'bad-order', widgets: [{ type: 'numericDisplay', binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 0, dataType: 'float32', byteOrder: 'ABC' } }] }),
    (error) => error.code === 'INVALID_BYTE_ORDER',
  );
});

test('v8 HMI blocks unsafe 64-bit integer numeric input to avoid precision loss', (t) => {
  const { hmi } = setup(t);
  assert.throws(
    () => hmi.save({ screenId: 'unsafe64', widgets: [{ type: 'numericInput', binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 0, dataType: 'uint64' }, write: { functionCode: 16 } }] }),
    (error) => error.code === 'INVALID_WRITE_BINDING' && /precision loss/.test(error.message),
  );
});

test('v8 HMI event owner mode does not label design activity as passive analyzer traffic', (t) => {
  const { hmi } = setup(t);
  const events = [];
  hmi.on('event', (event) => events.push(event));
  hmi.save({ screenId: 'main', widgets: [] });
  assert.equal(events.at(-1).ownerMode, null);
});
