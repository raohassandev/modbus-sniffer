'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v8 = require('../src/v8');

function event({ connectionId = 'c1', ownerMode = 'master', direction, raw, framing = 'rtu', timestamp = Date.now(), source = 'master-engine' }) {
  let unitId = null;
  let functionCode = null;
  try {
    const decoded = framing === 'tcp' ? v8.protocol.decodeTcpAdu(raw) : framing === 'ascii' ? v8.protocol.decodeAsciiAdu(raw) : v8.protocol.decodeRtuAdu(raw);
    unitId = decoded.unitId;
    functionCode = decoded.pdu[0];
  } catch { /* malformed traffic is still evidence */ }
  return v8.createWorkbenchEvent({
    timestamp,
    type: direction === 'tx' ? 'traffic.tx' : 'traffic.rx',
    source,
    connectionId,
    ownerMode,
    direction,
    unitId,
    functionCode,
    raw,
    details: { framing },
  });
}

function fakeStore() {
  let project = { id: 'p1', registerLabDefinitions: {} };
  return {
    getActiveProject: () => JSON.parse(JSON.stringify(project)),
    getProject: (id) => id === 'p1' ? JSON.parse(JSON.stringify(project)) : null,
    updateProject: (id, patch) => {
      assert.equal(id, 'p1');
      project = { ...project, ...JSON.parse(JSON.stringify(patch)) };
      return JSON.parse(JSON.stringify(project));
    },
  };
}

test('v8 Traffic timeline stays bounded and supports filters, HEX search and bookmarks', () => {
  const timeline = new v8.TrafficTimelineService({ maxEvents: 100, maxBookmarks: 10 });
  for (let index = 0; index < 105; index += 1) {
    timeline.ingest(v8.createWorkbenchEvent({
      type: index === 104 ? 'master.timeout' : 'traffic.tx',
      source: 'test',
      connectionId: index % 2 ? 'a' : 'b',
      ownerMode: 'master',
      direction: 'tx',
      unitId: 1,
      functionCode: 3,
      raw: Buffer.from([1, 3, index & 0xFF]),
      details: index === 104 ? { errorCode: 'TIMEOUT' } : {},
    }));
  }
  const stats = timeline.stats();
  assert.equal(stats.retained, 100);
  assert.equal(stats.dropped, 5);
  assert.equal(timeline.query({ connectionId: 'a', limit: 200 }).every((entry) => entry.connectionId === 'a'), true);
  assert.equal(timeline.query({ rawSearch: '6800', limit: 200 }).length, 1);
  const errors = timeline.query({ errorOnly: true });
  assert.equal(errors.length, 1);
  timeline.bookmark(errors[0].eventId, { note: 'investigate' });
  assert.equal(timeline.query({ bookmarkedOnly: true }).length, 1);
  assert.equal(timeline.get(errors[0].eventId).bookmark.note, 'investigate');
});

test('v8 Register Lab pairs RTU read request/response and exposes interpretation matrix', () => {
  const store = fakeStore();
  const broker = { getConnection: () => ({ state: 'open', owner: { ownerMode: 'master' }, writeLock: 'ENABLED' }) };
  const lab = new v8.RegisterLabService({ store, broker });
  const requestPdu = v8.protocol.encodeReadRequest({ functionCode: 3, address: 10, quantity: 4 });
  const responsePdu = v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [0x3F80, 0x0000, 0x1234, 0x5678] });
  lab.ingest(event({ direction: 'tx', raw: v8.protocol.encodeRtuAdu(1, requestPdu) }));
  lab.ingest(event({ direction: 'rx', raw: v8.protocol.encodeRtuAdu(1, responsePdu), timestamp: Date.now() + 5 }));

  const points = lab.list();
  assert.equal(points.length, 4);
  assert.deepEqual(points.map((point) => point.rawValue).sort((a, b) => a - b), [0, 0x1234, 0x3F80, 0x5678].sort((a, b) => a - b));
  const sourceKey = v8.registerSourceKey({ connectionId: 'c1', unitId: 1, area: 'holdingRegisters', address: 10 });
  const matrix = lab.interpretationMatrix(sourceKey);
  const float = matrix.find((entry) => entry.type === 'float32' && entry.byteOrder === 'ABCD');
  assert.equal(float.value, 1);
  assert.equal(lab.get(sourceKey).writeAccess.allowed, true);
});

test('v8 Register Lab preserves TCP Transaction-ID pairing when responses arrive out of order', () => {
  const lab = new v8.RegisterLabService();
  const reqA = v8.protocol.encodeTcpAdu({ transactionId: 11, unitId: 2, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 1, quantity: 1 }) });
  const reqB = v8.protocol.encodeTcpAdu({ transactionId: 12, unitId: 2, pdu: v8.protocol.encodeReadRequest({ functionCode: 3, address: 2, quantity: 1 }) });
  const rspA = v8.protocol.encodeTcpAdu({ transactionId: 11, unitId: 2, pdu: v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [111] }) });
  const rspB = v8.protocol.encodeTcpAdu({ transactionId: 12, unitId: 2, pdu: v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [222] }) });
  lab.ingest(event({ framing: 'tcp', direction: 'tx', raw: reqA }));
  lab.ingest(event({ framing: 'tcp', direction: 'tx', raw: reqB }));
  lab.ingest(event({ framing: 'tcp', direction: 'rx', raw: rspB }));
  lab.ingest(event({ framing: 'tcp', direction: 'rx', raw: rspA }));
  const points = lab.list();
  const one = points.find((point) => point.address === 1);
  const two = points.find((point) => point.address === 2);
  assert.equal(one.rawValue, 111);
  assert.equal(two.rawValue, 222);
});

test('v8 Register Lab isolates identical Unit/address identities by connection', () => {
  const lab = new v8.RegisterLabService();
  for (const [connectionId, value] of [['line-a', 10], ['line-b', 20]]) {
    lab.ingest(event({ connectionId, direction: 'tx', raw: v8.protocol.encodeRtuAdu(7, v8.protocol.encodeReadRequest({ functionCode: 4, address: 0, quantity: 1 })) }));
    lab.ingest(event({ connectionId, direction: 'rx', raw: v8.protocol.encodeRtuAdu(7, v8.protocol.encodeReadRegistersResponse({ functionCode: 4, values: [value] })) }));
  }
  const rows = lab.list({ unitId: 7, area: 'inputRegisters' });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.connectionId === 'line-a').rawValue, 10);
  assert.equal(rows.find((row) => row.connectionId === 'line-b').rawValue, 20);
  assert.notEqual(rows[0].sourceKey, rows[1].sourceKey);
});

test('v8 Register Lab saves engineering definitions with scale, enum, bitfield, limits and provenance', () => {
  const store = fakeStore();
  const lab = new v8.RegisterLabService({ store });
  const request = v8.protocol.encodeRtuAdu(1, v8.protocol.encodeReadRequest({ functionCode: 3, address: 5, quantity: 1 }));
  const response = v8.protocol.encodeRtuAdu(1, v8.protocol.encodeReadRegistersResponse({ functionCode: 3, values: [10] }));
  lab.ingest(event({ direction: 'tx', raw: request }));
  lab.ingest(event({ direction: 'rx', raw: response }));
  const sourceKey = lab.list()[0].sourceKey;
  lab.saveDefinition({ sourceKey, name: 'Power', type: 'uint16', scale: 0.5, offset: 1, precision: 1, unit: 'kW', enum: { 10: 'TEN' }, bitfield: { 1: 'READY' }, limits: { min: 0, max: 5 }, notes: 'field confirmed', provenance: { manual: true } });
  const point = lab.get(sourceKey);
  assert.equal(point.definition.name, 'Power');
  assert.equal(point.engineering.value, 6);
  assert.equal(point.engineering.outOfLimits, true);
  assert.equal(point.engineering.unit, 'kW');
  assert.deepEqual(point.engineering.activeBits, ['READY']);
  assert.equal(lab.listDefinitions()[sourceKey].notes, 'field confirmed');
});
