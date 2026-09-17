'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loader = fs.readFileSync(path.join(root, 'public/platform-v6.js'), 'utf8');
const masterJs = fs.readFileSync(path.join(root, 'public/master-v7.js'), 'utf8');
const masterCss = fs.readFileSync(path.join(root, 'public/master-v7.css'), 'utf8');
const discoveryRoutes = fs.readFileSync(path.join(root, 'src/activeDiscoveryRoutes.js'), 'utf8');

test('stable v7 shell loads Master as an additive workspace', () => {
  assert.match(loader, /master-v7\.css/);
  assert.match(loader, /master-v7\.js/);
  assert.match(masterJs, /pageMeta\.master/);
  assert.match(masterJs, /data-page="master"|dataset\.page = 'master'/);
  assert.match(masterJs, /Modbus Master/);
  assert.match(masterJs, /ACTIVE MODE/);
});

test('Master first screen exposes familiar connection and FC01-04 polling controls', () => {
  for (const token of [
    'Connection & Session', 'RTU', 'ASCII', 'TCP', 'Unit / Slave ID',
    'FC01', 'FC02', 'FC03', 'FC04', 'Start Address', 'Quantity',
    'Read Once', 'Start Polling', 'Pause', 'Stop', 'Live Data Grid',
    'Tx Requests', 'Rx Responses', 'Timeouts', 'Avg RTT',
  ]) assert.ok(masterJs.includes(token), `Master UI must contain ${token}`);
});

test('Master workspace keeps writes visibly locked in the M1 read foundation', () => {
  assert.match(masterJs, /WRITES LOCKED/);
  assert.match(masterJs, /Unlock Writes…/);
  assert.match(masterJs, /disabled>Unlock Writes/);
});

test('Master polling schedules the next request only after the previous read completes', () => {
  const loop = masterJs.slice(masterJs.indexOf('function scheduleNextPoll'), masterJs.indexOf('function pausePolling'));
  assert.match(loop, /await readOnce/);
  assert.match(loop, /scheduleNextPoll\(\)/);
  assert.ok(!/setInterval/.test(loop), 'poll loop must not use overlapping setInterval requests');
});

test('reference-address mode translates familiar notation to raw PDU addresses', () => {
  assert.match(masterJs, /function referenceBase/);
  assert.match(masterJs, /function normalizedPduAddress/);
  assert.match(masterJs, /functionCode === 3\) return 40001/);
  assert.match(masterJs, /functionCode === 4\) return 30001/);
  assert.match(masterJs, /address: normalizedPduAddress\(\)/);
});

test('serial takeover requires confirmation and releases passive capture before retrying', () => {
  const connectFlow = masterJs.slice(masterJs.indexOf('async function connect'), masterJs.indexOf('async function disconnect'));
  assert.match(connectFlow, /PASSIVE_CAPTURE_ACTIVE/);
  assert.match(connectFlow, /confirm\(/);
  assert.match(connectFlow, /\/api\/serial\/disconnect/);
  assert.match(connectFlow, /return connect\(\)/);
});

test('Master CSS is scoped and responsive rather than replacing stable Analyzer styles', () => {
  assert.match(masterCss, /\.master-workspace/);
  assert.match(masterCss, /\.master-grid/);
  assert.match(masterCss, /@media\(max-width:1250px\)/);
  assert.match(masterCss, /@media\(max-width:850px\)/);
  assert.doesNotMatch(masterCss, /(^|\n)(body|\.sidebar|\.workspace)\s*\{/);
});

test('stable active-route installer mounts Master API and closes it through the existing server cleanup path', () => {
  assert.match(discoveryRoutes, /installMasterRoutes/);
  assert.match(discoveryRoutes, /masterRuntime\.disconnect/);
});
