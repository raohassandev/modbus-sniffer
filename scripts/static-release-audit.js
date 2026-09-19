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
const server=read('src/platformWebServerV61.js');
const slaveRuntime=read('src/slave/slaveRuntime.js');
const masterRuntime=read('src/master/masterRuntime.js');
const desktopMain=read('desktop/main.js');
const navigationSafety=read('desktop/navigationSafety.js');

check(pkg.main==='src/index-v7.js','package main must be the unified runtime');
for(const name of ['start','sniffer','workbench','v7','v8'])check(pkg.scripts?.[name]==='node src/index-v7.js',`${name} must launch the unified runtime`);
check(versionSource.includes(`PRODUCT_VERSION = '${pkg.version}'`),'product version source must match package.json');
check(versionSource.includes("PRODUCT_NAME = 'Modbus Engineering Tool'"),'product name source must be unified');
check(desktop.version===pkg.version,'desktop version must match package version');
check(desktop.build?.productName==='Modbus Engineering Tool','desktop productName must be unified');
check(desktop.build?.artifactName==='Modbus-Engineering-Tool-Setup-${version}.${ext}','desktop artifact name must be unified');

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
check(server.includes('Content-Security-Policy'),'web server must emit CSP');
check(slaveRuntime.includes('out.tls.key = null'),'Slave public config must redact TLS private keys');
check(masterRuntime.includes('this.safety.preflight'),'Master writes must preflight before unlock/transmit');
check(desktopMain.includes('isAllowedNavigationUrl(url, selectedPort)'),'desktop renderer navigation must be origin-locked');
check(navigationSafety.includes('parsed.origin === expected.origin'),'desktop navigation must compare exact origins');


check(releaseNotes.includes(`Modbus Engineering Tool ${pkg.version}`),'release notes heading must match product/version');
check(releaseNotes.includes('src/index-v7.js'),'release notes must name the unified runtime');

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
