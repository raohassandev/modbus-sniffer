'use strict';

const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const failures=[];
const check=(condition,message)=>{if(!condition)failures.push(message);};

const pkg=json('package.json');
const desktop=json('desktop/package.json');
const versionSource=read('src/v8/version.js');
const shell=read('public/v4.html');
const loader=read('public/platform-v6.js');
const master=read('public/master-v7.js');
const masterWrite=read('public/master-write-v7.js');
const help=read('public/help-v7.js');
const releaseNotes=read('docs/RELEASE_NOTES_8.0.0.md');
const activeTodo=read('docs/ACTIVE_TODO.md');
const laneRegistry=read('docs/MODBUS_PARALLEL_LANES.md');
const localGateDoc=read('docs/LOCAL_MAC_RELEASE_GATE.md');
const unifiedE2e=read('e2e/unified-engineering.spec.js');
const defaultPlaywright=read('playwright.config.js');
const unifiedPlaywright=read('playwright.unified.config.js');
const compatPlaywright=read('playwright.compat.config.js');
const releaseGate=read('scripts/release-gate-mac.sh');
const server=read('src/platformWebServerV61.js');
const slaveRuntime=read('src/slave/slaveRuntime.js');
const masterRuntime=read('src/master/masterRuntime.js');
const masterRoutes=read('src/master/masterRoutes.js');
const masterMonitorStore=read('src/master/masterMonitorSessionStore.js');
const masterSessionsUi=read('public/master-sessions-v7.js');
const desktopMain=read('desktop/main.js');
const navigationSafety=read('desktop/navigationSafety.js');
const rawFrameStudio=read('src/v8/testCenter/rawFrameStudio.js');
const loggerTrend=read('src/loggerTrend/loggerTrendService.js');
const loggerTrendRoutes=read('src/loggerTrend/loggerTrendRoutes.js');
const desktopStorage=read('desktop/storage.js');
const discoveryEngineering=read('src/discoveryEngineering.js');
const udpTransport=read('src/v8/transports/udpTransport.js');
const preflight=read('scripts/source-preflight.js');
const l8fRuntime=read('scripts/l8f-runtime-acceptance.js');
const windowsWorkflow=read('.github/workflows/desktop-windows.yml');
const macWorkflow=read('.github/workflows/test.yml');
const windowsPackageAcceptance=read('scripts/windows-package-acceptance.ps1');
const siteAcceptance=read('docs/SITE_ACCEPTANCE.md');
const l8fFinalize=read('scripts/l8f-finalize.js');
const l8fPhysicalTemplate=read('docs/L8F_PHYSICAL_ACCEPTANCE.template.json');
const legacyReleaseClosure=read('docs/V8_RELEASE_CLOSURE.md');
const legacyImplementationStatus=read('docs/V8_IMPLEMENTATION_STATUS.md');
const legacyMasterTodo=read('docs/V8_MASTER_TODO.md');

check(pkg.main==='src/index-v7.js','package main must be the unified runtime');
for(const name of ['start','sniffer','workbench','v7','v8'])check(pkg.scripts?.[name]==='node src/index-v7.js',`${name} must launch the unified runtime`);
check(pkg.scripts?.preflight==='node scripts/source-preflight.js','preflight script must exist');
check(pkg.scripts?.['acceptance:l8f']==='node scripts/l8f-runtime-acceptance.js','L8-F runtime acceptance command must exist');
check(pkg.scripts?.['acceptance:l8f:final']==='node scripts/l8f-finalize.js','L8-F final evidence convergence command must exist');
check(pkg.scripts?.['audit:source']==='node scripts/static-release-audit.js','source audit script must exist');
check(pkg.scripts?.['e2e:unified']==='playwright test --config=playwright.unified.config.js','unified browser gate script must exist');
check(pkg.scripts?.['check:syntax']==='node scripts/check-js-syntax.js','project-wide syntax gate must exist');
check(pkg.scripts?.e2e==='npm run e2e:unified && npm run e2e:compat','default browser gate must run unified then compatibility coverage');
check(pkg.scripts?.['e2e:compat']==='playwright test --config=playwright.compat.config.js','compatibility browser gate script must use its dedicated config');
check(versionSource.includes(`PRODUCT_VERSION = '${pkg.version}'`),'product version source must match package.json');
check(versionSource.includes("PRODUCT_NAME = 'Modbus Engineering Tool'"),'product name source must be unified');
check(desktop.version===pkg.version,'desktop version must match package version');
check(desktop.build?.productName==='Modbus Engineering Tool','desktop productName must be unified');
check(desktop.build?.artifactName==='Modbus-Engineering-Tool-Setup-${version}.${ext}','desktop artifact name must be unified');
const desktopSrcResource=desktop.build?.extraResources?.find(item=>item.from==='../src');
const desktopPublicResource=desktop.build?.extraResources?.find(item=>item.from==='../public');
check(Array.isArray(desktopSrcResource?.filter)&&desktopSrcResource.filter.includes('!index-v8.js'),'packaged desktop must exclude the compatibility launch entrypoint');
check(Array.isArray(desktopPublicResource?.filter)&&desktopPublicResource.filter.includes('!v8/**'),'packaged desktop must exclude the compatibility web shell');

check(shell.includes('Modbus Engineering Tool'),'stable shell must identify the unified product');
check(shell.includes('Sniffer · Master · Slave'),'stable shell must identify primary modes');
check(!shell.includes('PASSIVE / RX ONLY'),'global shell must not claim all modes are passive');
check(!shell.includes('UI v7.0'),'stable shell must not hard-code an obsolete product version');

for(const asset of [
  'master-v7.js','slave-v7.js','traffic-evidence-v7.js','protocol-diagnostics-v7.js',
  'data-lab-v7.js','logger-trend-v7.js','compare-v7.js','transport-lab-v7.js',
  'raw-lab-v7.js','discovery-engineering-v7.js','slave-lab-v7.js','help-v7.js','navigation-v7.js'
])check(loader.includes(asset),`stable loader missing ${asset}`);

check(!master.includes('id="masterOpenTraffic"'),'base Master must not duplicate masterOpenTraffic');
check(!master.includes('id="masterResetCounters"'),'base Master must not duplicate masterResetCounters');
check((masterWrite.match(/id="masterOpenTraffic"/g)||[]).length===1,'Master write extension must own exactly one Traffic button');
check((masterWrite.match(/id="masterResetCounters"/g)||[]).length===1,'Master write extension must own exactly one counter reset button');
check(!help.includes('HMI Builder'),'stable Help must not expose generic HMI Builder scope');

check(server.includes('WEB_EXTERNAL_BIND_CONFIRMATION_REQUIRED'),'web server must require explicit external-bind confirmation');
check(server.includes('CROSS_ORIGIN_MUTATION_BLOCKED'),'web server must block cross-origin mutations');
check(server.includes('jsonBodyLimitForPath'),'web server must enforce parser-level JSON limits');
check(server.includes("app.use('/v8'"),'unified server must block the internal compatibility shell path');
check(server.includes('Content-Security-Policy'),'web server must emit CSP');
check(slaveRuntime.includes('out.tls.key = null'),'Slave public config must redact TLS private keys');
check(masterRuntime.includes('this.safety.preflight'),'Master writes must preflight before unlock/transmit');
check(masterRoutes.includes("/api/master/monitor-sessions"),'Master routes must expose durable Monitor Session persistence');
check(server.includes('dataDir:options.dataDir'),'unified server must bind Master Monitor Sessions to the configured runtime data root');
check(masterMonitorStore.includes("master-monitor-sessions.json")&&masterMonitorStore.includes('fs.renameSync'),'Master Monitor Session store must use durable atomic file persistence');
check(masterMonitorStore.includes('this.backupFile')&&masterMonitorStore.includes('fs.fsyncSync'),'Master Monitor Session store must retain a recoverable backup and flush temporary writes before replace');
check(masterMonitorStore.includes("rowsHtml:''"),'Master Monitor Session persistence must not retain rendered field-derived HTML');
check(masterSessionsUi.includes("/api/master/monitor-sessions")&&masterSessionsUi.includes('loadRemoteStore'),'Master Monitor Session UI must load durable workstation state');
check(masterSessionsUi.includes('function mergeStores')&&masterSessionsUi.includes('store=mergeStores(local,remote)'),'Master Monitor Session UI must union local and durable state while preferring newer session revisions');
check(masterSessionsUi.includes("rowsHtml:''")&&!masterSessionsUi.includes('snap.rowsHtml'),'Master Monitor Session UI must not persist or restore rendered field HTML');
check(desktopMain.includes('isAllowedNavigationUrl(url, selectedPort)'),'desktop renderer navigation must be origin-locked');
check(navigationSafety.includes('parsed.origin === expected.origin'),'desktop navigation must compare exact origins');
check(desktopMain.includes('probePort(18787)')&&desktopMain.includes('return probePort(0)'),'desktop must prefer a stable loopback origin and safely fall back when occupied');
check(desktopMain.includes('MODBUS_DESKTOP_INSTANCE_TOKEN')&&desktopMain.includes('desktopInstanceToken !== child.modbusInstanceToken'),'desktop health readiness must be bound to the spawned backend process');
check(server.includes('desktopInstanceToken:process.env.MODBUS_DESKTOP_INSTANCE_TOKEN||null'),'unified status must expose the desktop readiness token only from the current process environment');
check(rawFrameStudio.includes('validateResponseSemantics'),'Raw Lab must perform semantic Modbus response validation');
check(rawFrameStudio.includes('validateSuccessfulResponsePdu'),'Raw Lab must validate successful response structure/quantity');
check(loggerTrend.includes('_hydrateHistory'),'Logger/Trend must hydrate persisted history on restart');
check(loggerTrendRoutes.includes("dataDir=null")&&loggerTrendRoutes.includes("StableLoggerTrendService({state,masterRuntime,...(dataDir?{dataDir}:{})})"),'Logger/Trend routes must accept the configured runtime data directory');
check(server.includes("dataDir:path.join(options.dataDir,'logger-trend')"),'unified server must keep Logger/Trend persistence under the configured runtime data root');
check(desktopStorage.includes("'logger-trend'")&&desktopStorage.includes('MIGRATABLE_DATA'),'desktop migration must preserve Logger/Trend evidence');
check(desktopStorage.includes("'master-monitor-sessions.json'"),'desktop migration must preserve durable Master Monitor Sessions');
check(desktopStorage.includes("'master-monitor-sessions.json.bak'"),'desktop migration must preserve Monitor Session recovery backups');
check(desktopStorage.includes('hasPersistedData'),'desktop migration must refuse to mix legacy data into any populated user-data store');
check(loggerTrend.includes('eventsLoaded'),'Logger/Trend must hydrate protocol-event evidence');
check(discoveryEngineering.includes("framing==='tcp'?255:247"),'Discovery Unit-ID limits must be framing-aware');
check(udpTransport.includes('_prunePeers'),'UDP server must expire stale peer identities');
check(udpTransport.includes('expiredPeers'),'UDP peer expiry must be observable in transport stats');
check(preflight.includes("['l8f-runtime', ['run','acceptance:l8f']]"),'source preflight must execute L8-F runtime acceptance');
for(const marker of ['Master to Slave TCP loopback read','unsafe bulk write rejected before transmit','Monitor Session durable save sanitizes rendered HTML','Monitor Sessions persist across runtime restart','restart does not restore live write or LAB state'])check(l8fRuntime.includes(marker),`L8-F runtime harness missing: ${marker}`);
for(const marker of ['test-windows-sqlite.js','npm run soak -- --cycles 50000','npm run e2e:unified','windows-package-acceptance.ps1'])check(windowsWorkflow.includes(marker),`Windows workflow missing L8-F gate: ${marker}`);
for(const marker of ['npm run audit:source','npm run check:syntax'])check(macWorkflow.includes(marker),`Mac manual validation missing release gate: ${marker}`);
for(const marker of ['NSIS clean install','Installed health identity','Installed serial enumerator','NSIS clean uninstall','WINDOWS-ACCEPTANCE.json','WINDOWS-ENVIRONMENT.txt'])check(windowsPackageAcceptance.includes(marker),`Windows package acceptance missing: ${marker}`);
check(siteAcceptance.includes('http://127.0.0.1:8080/'),'site acceptance must use unified browser URL');
check(siteAcceptance.includes('npm run acceptance:l8f'),'site acceptance must document L8-F runtime gate');
check(!siteAcceptance.includes('http://127.0.0.1:8088/v8/'),'site acceptance must not point to legacy v8 shell');
check(!siteAcceptance.includes('/api/v8/status'),'site acceptance must not require legacy v8 health endpoint');
check(siteAcceptance.includes('npm run acceptance:l8f:final'),'site acceptance must document the final L8-F evidence convergence gate');
for(const marker of ['runtime','windows','field','physical'])check(l8fFinalize.includes("arg('--"+marker+"')"),`L8-F finalizer missing evidence input: ${marker}`);
for(const marker of [
  "spawnSync('git',['rev-parse','HEAD']",
  "evidence is stale for this checkout",
  "evidence kind mismatch",
  "Physical acceptance missing evidence reference"
])check(l8fFinalize.includes(marker),`L8-F finalizer missing fail-closed marker: ${marker}`);
for(const marker of ['passive-rtu','master-rtu','master-tcp','external-master-slave','tls-mtls','windows-production']){
  check(l8fFinalize.includes("'"+marker+"'"),`L8-F finalizer missing physical gate: ${marker}`);
  check(l8fPhysicalTemplate.includes('"name": "'+marker+'"'),`L8-F physical template missing: ${marker}`);
}


for(const [label,source] of [['V8_RELEASE_CLOSURE',legacyReleaseClosure],['V8_IMPLEMENTATION_STATUS',legacyImplementationStatus],['V8_MASTER_TODO',legacyMasterTodo]]){
  check(source.includes('HISTORICAL / SUPERSEDED'),label+' must be explicitly marked superseded');
  check(source.includes('src/index-v7.js'),label+' supersession notice must point to the unified runtime');
}
check(releaseNotes.includes(`Modbus Engineering Tool ${pkg.version}`),'release notes heading must match product/version');
check(releaseNotes.includes('src/index-v7.js'),'release notes must name the unified runtime');
check(!activeTodo.includes('\\n- [x]'),'ACTIVE_TODO must not contain escaped checklist line breaks');
check(!laneRegistry.includes('\\n- [x]'),'lane registry must not contain escaped checklist line breaks');
check(laneRegistry.includes('Software and release-engineering completion: 100%'),'lane registry must declare software/release-engineering completion');
check(!laneRegistry.includes('EXECUTING'),'lane registry must not retain executing software lanes after source closure');
for(const lane of ['L8-A','L8-B','L8-C','L8-D','L8-E','L8-F']){
  check(new RegExp('\\| '+lane.replace('-','\\-')+' \\|[^\\n]*\\| 100% \\|').test(laneRegistry),lane+' must be source-complete at 100%');
}
check(localGateDoc.startsWith(`# Local Mac Release Gate — Modbus Engineering Tool ${pkg.version}`),'local release gate heading must match product/version');
for(const marker of ['primary Modbus workspaces','Master Monitor Sessions merge local fallback and durable workstation state','loopback read','unsafe bulk write'])check(unifiedE2e.includes(marker),`unified E2E missing coverage marker: ${marker}`);
check(defaultPlaywright.includes("require('./playwright.unified.config')"),'default Playwright gate must target the shipped unified product');
check(!defaultPlaywright.includes('src/index-v8.js'),'default Playwright gate must not launch the internal compatibility runtime');
check(unifiedPlaywright.includes('src/index-v7.js'),'unified Playwright gate must launch the unified runtime');
check(!unifiedPlaywright.includes('src/index-v8.js'),'unified Playwright gate must not launch the compatibility runtime');
check(compatPlaywright.includes('src/index-v8.js'),'compatibility Playwright gate must launch only the internal compatibility runtime');
check(!compatPlaywright.includes('src/index-v7.js'),'compatibility Playwright gate must not boot the unified runtime');
check(releaseGate.includes('npm run check:syntax'),'release gate must run project-wide syntax validation');
check(releaseGate.includes('npm run acceptance:l8f'),'release gate must capture L8-F runtime acceptance');
check(releaseGate.indexOf('browser-e2e-unified')>=0,'release gate must run unified browser acceptance');
check(releaseGate.indexOf('browser-e2e-compatibility')>releaseGate.indexOf('browser-e2e-unified'),'compatibility browser coverage must run after unified acceptance');

const workflowDir=path.join(root,'.github','workflows');
for(const name of fs.readdirSync(workflowDir).filter(x=>/\.ya?ml$/i.test(x))){
  const source=fs.readFileSync(path.join(workflowDir,name),'utf8');
  check(/workflow_dispatch\s*:/.test(source),`${name} must remain manual workflow_dispatch only`);
  check(!/^\s*push\s*:/m.test(source),`${name} must not auto-run on push`);
  check(!/^\s*pull_request\s*:/m.test(source),`${name} must not auto-run on pull_request`);
}

for(const [label,source] of [
  ['stable shell',shell],['stable loader',loader],['desktop metadata',JSON.stringify(desktop)],['release notes',releaseNotes]
]){
  for(const stale of ['release-candidate workspace','experimental v8']){
    check(!source.toLowerCase().includes(stale.toLowerCase()),`${label} contains stale phrase: ${stale}`);
  }
}

if(failures.length){
  console.error(`SOURCE RELEASE AUDIT FAIL: ${failures.length} issue(s)`);
  for(const issue of failures)console.error(' - '+issue);
  process.exit(1);
}
console.log(`SOURCE RELEASE AUDIT PASS: product=${pkg.version}, workflows=manual-only, unified runtime/assets/desktop/docs consistent`);
