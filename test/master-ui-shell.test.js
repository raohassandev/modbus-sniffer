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

test('Master CSS is scoped and responsive rather than replacing stable Analyzer styles', () => {
  assert.match(masterCss, /\.master-workspace/);
  assert.match(masterCss, /\.master-grid/);
  assert.match(masterCss, /@media\(max-width:1250px\)/);
  assert.match(masterCss, /@media\(max-width:850px\)/);
  assert.doesNotMatch(masterCss, /(^|\n)(body|\.sidebar|\.workspace)\s*\{/);
});

test('stable route installer mounts Master API and closes it through the existing server cleanup path', () => {
  assert.match(discoveryRoutes, /installMasterRoutes/);
  assert.match(discoveryRoutes, /masterRuntime\.disconnect/);
});
