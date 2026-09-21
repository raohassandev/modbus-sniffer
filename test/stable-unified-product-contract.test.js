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
    'raw-lab-v7.js','discovery-engineering-v7.js','network-discovery-v8.js','slave-lab-v7.js','help-v7.js','navigation-v7.js'
  ])assert.equal(loader.includes(asset),true,asset+' must be loaded');
  const nav=read('public/navigation-v7.js');
  new vm.Script(nav,{filename:'navigation-v7.js'});
  for(const heading of ['CORE','ANALYZE','LAB','EVIDENCE','SYSTEM'])assert.match(nav,new RegExp(heading));
});


test('industrial network discovery is integrated as an enabling Modbus workflow',()=>{
  const ui=read('public/network-discovery-v8.js');
  const routes=read('src/networkDiscovery/networkDiscoveryRoutes.js');
  const parser=read('src/networkDiscovery/targetParser.js');
  const server=read('src/platformWebServerV61.js');
  new vm.Script(ui,{filename:'network-discovery-v8.js'});
  new vm.Script(routes,{filename:'networkDiscoveryRoutes.js'});
  new vm.Script(parser,{filename:'targetParser.js'});
  assert.match(ui,/Network Scan/);
  assert.match(ui,/Devices/);
  assert.match(ui,/Topology/);
  assert.match(ui,/Modbus Discovery/);
  assert.match(ui,/History/);
  assert.match(ui,/VERIFIED/);
  assert.match(ui,/CANDIDATE/);
  assert.match(routes,/\/api\/network\/hosts\/:id\/open-master/);
  assert.match(routes,/transmit:false/);
  assert.match(routes,/connect:false/);
  assert.match(routes,/SNMP_COMMUNITY_REQUIRED/);
  assert.match(parser,/TARGET_HARD_LIMIT/);
  assert.match(parser,/cidr6/);
  assert.match(server,/installNetworkDiscoveryRoutes/);
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

test('stable analyzer never promotes unmatched serial noise into confirmed engineering data',()=>{
  const html=read('public/v4.html');
  const app=read('public/app-v4.js');
  const tcpUi=read('public/platform-v6-main.js');
  const runtime=read('src/platformRuntimeStateV62.js');
  new vm.Script(app,{filename:'app-v4.js'});
  new vm.Script(tcpUi,{filename:'platform-v6-main.js'});
  new vm.Script(runtime,{filename:'platformRuntimeStateV62.js'});
  assert.match(html,/id="sourceBanner"/);
  assert.match(app,/WRONG \/ NOISY SOURCE/);
  assert.match(app,/d\.confirmed!==false/);
  assert.match(app,/state\.tcpStatus=m\.payload\.tcp/);
  assert.match(app,/trafficDeviceKey/);
  assert.match(runtime,/matchedResponses/);
  assert.match(runtime,/matchedResponses>0/);
  assert.match(runtime,/tx\?\.direction==='RSP'&&!tx\?\.request/);
  assert.match(tcpUi,/direct PLC traffic sent straight to the target device bypasses this application/);
  assert.match(tcpUi,/tcpFixed502/);
});

test('stable server cleanup releases active resources and export manifest follows product version',()=>{
  const server=read('src/platformWebServerV61.js');
  assert.match(server,/version:PRODUCT_VERSION/);
  assert.match(server,/Promise\.allSettled/);
  assert.match(server,/masterRuntime\.disconnect\(\)/);
  assert.match(server,/slaveRuntime\.shutdown\(\)/);
  assert.match(server,/activeDiscovery\.close\(\)/);
  assert.match(server,/networkDiscovery\.close\(\)/);
  assert.match(server,/tcpProxy\.stop\(\)/);
  assert.match(server,/if\(failed\)throw failed\.reason/);
  assert.match(server,/ws\.terminate\(\)/);
  assert.match(server,/wss\.close/);
});

test('unified Playwright acceptance spec parses and covers loopback read plus no-transmit write rejection',()=>{
  const e2e=read('e2e/unified-engineering.spec.js');
  new vm.Script(e2e,{filename:'unified-engineering.spec.js'});
  assert.match(e2e,/primary Modbus workspaces are available from one stable shell/);
  assert.match(e2e,/built-in TCP Slave and stable Master complete a loopback read/);
  assert.match(e2e,/all navigation workspaces stay usable without shell overflow at supported desktop viewports/);
  assert.match(e2e,/width:1100,height:700/);
  assert.match(e2e,/\.nav-item\[data-page\]/);
  assert.match(e2e,/Master Monitor Sessions merge local fallback and durable workstation state across browser reloads/);
  assert.match(e2e,/unsafe bulk write is rejected before transmission/);
  assert.match(e2e,/BULK_CONFIRMATION_REQUIRED/);
  assert.match(e2e,/preflightRejected===true&&row\.transmitted===false/);
});

test('browser validation separates fast unified runtime acceptance from compatibility coverage',()=>{
  const pkg=JSON.parse(read('package.json'));
  const defaultConfig=read('playwright.config.js');
  const unified=read('playwright.unified.config.js');
  const compat=read('playwright.compat.config.js');
  const gate=read('scripts/release-gate-mac.sh');
  new vm.Script(defaultConfig,{filename:'playwright.config.js'});
  assert.match(defaultConfig,/playwright\.unified\.config/);
  assert.doesNotMatch(defaultConfig,/src\/index-v8\.js/);
  new vm.Script(unified,{filename:'playwright.unified.config.js'});
  assert.equal(pkg.scripts['e2e:unified'],'playwright test --config=playwright.unified.config.js');
  assert.equal(pkg.scripts.e2e,'npm run e2e:unified && npm run e2e:compat');
  assert.equal(pkg.scripts['e2e:compat'],'playwright test --config=playwright.compat.config.js');
  assert.match(unified,/src\/index-v7\.js/);
  assert.doesNotMatch(unified,/src\/index-v8\.js/);
  assert.match(unified,/unified-engineering\.spec\.js/);
  new vm.Script(compat,{filename:'playwright.compat.config.js'});
  assert.match(compat,/src\/index-v8\.js/);
  assert.doesNotMatch(compat,/src\/index-v7\.js/);
  assert.match(gate,/browser-e2e-unified/);
  assert.match(gate,/browser-e2e-compatibility/);
  assert.ok(gate.indexOf('browser-e2e-unified')<gate.indexOf('browser-e2e-compatibility'));
});

test('fast source preflight fails closed across quality audit tests smoke and acceptance',()=>{
  const preflight=read('scripts/source-preflight.js');
  new vm.Script(preflight,{filename:'source-preflight.js'});
  for(const command of ['version:check','audit:source','lint','check:syntax','check:v8','audit:runtime','test','smoke','acceptance'])assert.match(preflight,new RegExp(command.replace(':','\\:')));
  assert.match(preflight,/SOURCE PREFLIGHT FAIL/);
  assert.match(preflight,/process\.exit\(result\.status\|\|1\)/);
});

test('release source audit is fail-closed for identity assets workflow triggers and duplicate Master controls',()=>{
  const audit=read('scripts/static-release-audit.js');
  new vm.Script(audit,{filename:'static-release-audit.js'});
  assert.match(audit,/workflow_dispatch/);
  assert.match(audit,/must not auto-run on push/);
  assert.match(audit,/Modbus Engineering Tool/);
  assert.match(audit,/masterOpenTraffic/);
  assert.match(audit,/SOURCE RELEASE AUDIT FAIL/);
});

test('unified CLI requires explicit external web exposure and documents the current entrypoint',()=>{
  const cli=read('src/cli.js');
  const server=read('src/platformWebServerV61.js');
  assert.match(cli,/confirmWebExternalBind:false/);
  assert.match(cli,/--confirm-web-external-bind/);
  assert.match(cli,/node src\/index-v7\.js/);
  assert.match(cli,/PRODUCT_VERSION/);
  assert.match(cli,/Modbus Engineering Tool \$\{PRODUCT_VERSION\}/);
  assert.doesNotMatch(cli,/index-v6\.js/);
  assert.match(server,/WEB_EXTERNAL_BIND_CONFIRMATION_REQUIRED/);
  assert.match(server,/INVALID_WEB_HOST/);
  assert.match(server,/webHostAllowed/);
});

test('canonical docs separate source completion from release evidence',()=>{
  const todo=read('docs/ACTIVE_TODO.md');
  const lanes=read('docs/MODBUS_PARALLEL_LANES.md');
  assert.match(todo,/Approved product source scope: COMPLETE/);
  assert.match(todo,/exact-current-head/);
  assert.match(lanes,/Software and release-engineering completion: 100%/);
  assert.match(lanes,/External release evidence still to execute/);
  assert.match(read('docs/MODBUS_FUNCTION_MATRIX.md'),/\|\s*43\/14\s*\|/);
  assert.match(read('docs/PCAP_FEASIBILITY.md'),/do not generate synthetic PCAP\/PCAPNG/);
});
