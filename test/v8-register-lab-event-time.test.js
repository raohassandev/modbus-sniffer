'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

function event({ direction, raw, timestamp }) {
  return v8.createWorkbenchEvent({
    timestamp,
    type: direction === 'tx' ? 'traffic.tx' : 'traffic.rx',
    source: 'historical-register-lab-test',
    connectionId: 'historical-line-1',
    ownerMode: 'master',
    direction,
    unitId: 1,
    functionCode: 3,
    raw,
    details: { framing: 'rtu' },
  });
}

test('Register Lab pairs historical request/response evidence by event time, not wall clock', () => {
  const lab = new v8.RegisterLabService({ maxPoints: 100 });
  const request = v8.protocol.encodeRtuAdu(
    1,
    v8.protocol.encodeReadRequest({ functionCode: 3, address: 10, quantity: 3 }),
  );
  const response = v8.protocol.encodeRtuAdu(
    1,
    v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [111, 222, 333] }),
  );

  // Deliberately old capture timestamps: these must remain pairable during replay/offline analysis.
  lab.ingest(event({ direction: 'tx', raw: request, timestamp: 1_000_000 }));
  lab.ingest(event({ direction: 'rx', raw: response, timestamp: 1_000_010 }));

  const points = lab.list({ connectionId: 'historical-line-1', limit: 10 });
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((point) => point.rawValue), [111, 222, 333]);
  assert.deepEqual(points.map((point) => point.address), [10, 11, 12]);
});
