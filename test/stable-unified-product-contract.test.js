'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('unified product keeps one user-facing runtime contract',()=>{
  const pkg=JSON.parse(read('package.json'));
  const desktop=read('desktop/main.js');
  const readme=read('README.md');
  assert.equal(pkg.main,'src/index-v7.js');
  for(const name of ['start','sniffer','workbench','v7','v8'])assert.equal(pkg.scripts[name],'node src/index-v7.js');
  assert.doesNotMatch(desktop,/MODBUS_DESKTOP_MODE/);
  assert.match(desktop,/desktopMode\(\).*unified/s);
  assert.match(readme,/unified field-oriented Modbus application/i);
  assert.match(readme,/src\/index-v7\.js/);
});

test('stable shell does not overwrite the server-injected product version badge',()=>{
  const loader=read('public/platform-v6.js');
  assert.doesNotMatch(loader,/badge\.textContent='UI v7\.0'/);
  assert.doesNotMatch(loader,/UI v7\.0/);
});

test('global shell describes unified mode safety without claiming the whole product is passive',()=>{
  const html=read('public/v4.html');
  assert.match(html,/Modbus Engineering Tool/);
  assert.match(html,/Sniffer · Master · Slave/);
  assert.match(html,/MODE SAFE/);
  assert.match(html,/Sniffer is RX-only · active TX modes are explicit/);
  assert.doesNotMatch(html,/PASSIVE \/ RX ONLY/);
});

test('stable shell loads the final Modbus-only workspaces and grouped navigation',()=>{
  const loader=read('public/platform-v6.js');
  for(const asset of [
    'master-v7.js','slave-v7.js','traffic-evidence-v7.js','protocol-diagnostics-v7.js',
    'data-lab-v7.js','logger-trend-v7.js','compare-v7.js','transport-lab-v7.js',
    'raw-lab-v7.js','discovery-engineering-v7.js','slave-lab-v7.js','help-v7.js','navigation-v7.js'
  ])assert.equal(loader.includes(asset),true,asset+' must be loaded');
  const nav=read('public/navigation-v7.js');
  new vm.Script(nav,{filename:'navigation-v7.js'});
  for(const heading of ['CORE','ANALYZE','LAB','EVIDENCE','SYSTEM'])assert.match(nav,new RegExp(heading));
});

test('Master owns a single Traffic/counter control set and Logger shortcut tolerates load ordering',()=>{
  const master=read('public/master-v7.js');
  const write=read('public/master-write-v7.js');
  const logger=read('public/logger-trend-v7.js');
  assert.doesNotMatch(master,/id="masterOpenTraffic"/);
  assert.doesNotMatch(master,/id="masterResetCounters"/);
  assert.equal((write.match(/id="masterOpenTraffic"/g)||[]).length,1);
  assert.equal((write.match(/id="masterResetCounters"/g)||[]).length,1);
  assert.match(write,/ModbusMasterSessionCounters/);
  assert.match(logger,/installMasterShortcut/);
  assert.match(logger,/MutationObserver/);
});

test('canonical docs separate source completion from release evidence',()=>{
  const todo=read('docs/ACTIVE_TODO.md');
  const lanes=read('docs/MODBUS_PARALLEL_LANES.md');
  assert.match(todo,/Approved product source scope: COMPLETE/);
  assert.match(todo,/exact-current-head/);
  assert.match(lanes,/Approved source-roadmap completion: 100%/);
  assert.match(lanes,/PENDING EVIDENCE/);
  assert.match(read('docs/MODBUS_FUNCTION_MATRIX.md'),/\|\s*43\/14\s*\|/);
  assert.match(read('docs/PCAP_FEASIBILITY.md'),/do not generate synthetic PCAP\/PCAPNG/);
});
