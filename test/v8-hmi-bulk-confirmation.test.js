'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('../src/v8');

test('v8 HMI FC16 write requires explicit operator bulk confirmation', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modbus-v8-hmi-bulk-'));
  const store = new v8.V8ProjectStore({ dataDir: dir, autoMigrate: false });
  const writes = [];
  const masterWorkspace = {
    async readOnce() { return { decoded: { values: [0, 0] }, rttMs: 1, requestRawHex: 'AA', responseRawHex: 'BB' }; },
    async writeOnce(input) { writes.push(input); return { ok: true }; },
  };
  const hmi = new v8.HmiBuilderService({ store, masterWorkspace });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }));

  hmi.save({
    screenId: 'main',
    widgets: [{
      widgetId: 'setpoint',
      type: 'numericInput',
      binding: { connectionId: 'grid', unitId: 1, functionCode: 3, address: 100, dataType: 'uint32' },
      write: { functionCode: 16, readBack: true },
    }],
  });

  await assert.rejects(
    hmi.writeWidget('main', 'setpoint', { value: 42, confirmation: { confirmed: true } }),
    (error) => error.code === 'BULK_CONFIRMATION_REQUIRED',
  );
  assert.equal(writes.length, 0);

  await hmi.writeWidget('main', 'setpoint', { value: 42, confirmation: { confirmed: true, bulk: true } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].functionCode, 16);
  assert.equal(writes[0].confirmation.bulk, true);
});
