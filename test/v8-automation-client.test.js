'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkbenchApiClient, normalizeBaseUrl } = require('../src/v8/automation/workbenchClient');
const cli = require('../scripts/v8-cli');

function fakeFetch(log, payload = { ok: true }) {
  return async (url, options) => {
    log.push({ url: String(url), options: { ...options } });
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(payload); },
    };
  };
}

test('v8 automation client is loopback-only unless remote access is explicitly enabled', () => {
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8088').hostname, '127.0.0.1');
  assert.throws(() => normalizeBaseUrl('http://192.168.1.50:8088'), (error) => error.code === 'REMOTE_API_DISABLED');
  assert.equal(normalizeBaseUrl('https://192.168.1.50:8443', { allowRemote: true }).protocol, 'https:');
});

test('v8 automation write cannot bypass confirmation, bulk or broadcast interlocks', async () => {
  const calls = [];
  const client = new WorkbenchApiClient({ fetchImpl: fakeFetch(calls) });
  await assert.rejects(() => client.write({ connectionId: 'c1', unitId: 1, functionCode: 6, address: 0, value: 1 }), (error) => error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => client.write({ connectionId: 'c1', unitId: 1, functionCode: 16, address: 0, values: [1] }, { confirmed: true }), (error) => error.code === 'BULK_CONFIRMATION_REQUIRED');
  await assert.rejects(() => client.write({ connectionId: 'c1', unitId: 0, functionCode: 6, address: 0, value: 1 }, { confirmed: true }), (error) => error.code === 'BROADCAST_CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 0);

  await client.write({ connectionId: 'c1', unitId: 1, functionCode: 16, address: 0, values: [1, 2] }, { confirmed: true, bulk: true });
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.confirmation, { confirmed: true, bulk: true, broadcast: false });
});

test('v8 CLI parser exposes machine-readable and guarded write options', () => {
  const parsed = cli.parse(['write', '--connection', 'plant', '--unit', '2', '--fc', '16', '--values', '1,2', '--confirm', '--bulk-confirm', '--json']);
  assert.equal(parsed._[0], 'write');
  assert.equal(parsed.connection, 'plant');
  assert.equal(parsed.confirm, true);
  assert.equal(parsed.bulkConfirm, true);
  assert.equal(parsed.json, true);
});
