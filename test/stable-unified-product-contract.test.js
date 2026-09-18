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

test('stable shell surfaces packaged asset load failures instead of failing silently',()=>{
  const loader=read('public/platform-v6.js');
  assert.match(loader,/platformAssetFailure/);
  assert.match(loader,/could not load a required UI asset/);
  assert.match(loader,/window\.addEventListener\('error'/);
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

test('stable server cleanup releases active resources and export manifest follows product version',()=>{
  const server=read('src/platformWebServerV61.js');
  assert.match(server,/version:PRODUCT_VERSION/);
  assert.match(server,/Promise\.allSettled/);
  assert.match(server,/masterRuntime\.disconnect\(\)/);
  assert.match(server,/slaveRuntime\.shutdown\(\)/);
  assert.match(server,/activeDiscovery\.close\(\)/);
  assert.match(server,/tcpProxy\.stop\(\)/);
  assert.match(server,/if\(failed\)throw failed\.reason/);
});

test('unified Playwright acceptance spec parses and covers loopback read plus no-transmit write rejection',()=>{
  const e2e=read('e2e/unified-engineering.spec.js');
  new vm.Script(e2e,{filename:'unified-engineering.spec.js'});
  assert.match(e2e,/primary Modbus workspaces are available from one stable shell/);
  assert.match(e2e,/built-in TCP Slave and stable Master complete a loopback read/);
  assert.match(e2e,/unsafe bulk write is rejected before transmission/);
  assert.match(e2e,/BULK_CONFIRMATION_REQUIRED/);
  assert.match(e2e,/preflightRejected===true&&row\.transmitted===false/);
});

test('fast source preflight fails closed across quality audit tests smoke and acceptance',()=>{
  const preflight=read('scripts/source-preflight.js');
  new vm.Script(preflight,{filename:'source-preflight.js'});
  for(const command of ['version:check','lint','check:v8','audit:runtime','test','smoke','acceptance'])assert.match(preflight,new RegExp(command.replace(':','\\:')));
  assert.match(preflight,/SOURCE PREFLIGHT FAIL/);
  assert.match(preflight,/process\.exit\(result\.status\|\|1\)/);
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
