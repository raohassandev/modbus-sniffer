'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('product shell remains Modbus-only and does not expose HMI Builder',()=>{
  const index=read('public/v8/index.html');
  const shell=read('public/v8/shell-extras.js');
  const help=read('public/v8/help.js');

  assert.doesNotMatch(index,/data-workspace="hmi"/i);
  assert.doesNotMatch(shell,/loadScript\('\/v8\/hmi-workspace\.js'/);
  assert.doesNotMatch(help,/id:\s*'hmi'\s*,\s*title:/);

  assert.match(index,/>Slave<\/span>/);
  assert.match(index,/>Logger \/ Trend<\/span>/);
  assert.match(index,/>Test Sequences<\/span>/);
  assert.match(shell,/compatibility Modbus engineering shell/);
  assert.doesNotMatch(shell,/release-candidate workspace/);
  assert.match(shell,/Unified Modbus Engineering Tool/);
});

test('generic workspace names stay reframed around Modbus engineering',()=>{
  const help=read('public/v8/help.js');
  assert.match(help,/title:\s*'Slave \/ Simulator'/);
  assert.match(help,/title:\s*'Logger \/ Trend'/);
  assert.match(help,/title:\s*'Test Sequences \/ API'/);
  assert.doesNotMatch(help,/title:\s*'Historian'/);
  assert.doesNotMatch(help,/title:\s*'Automation'/);
  assert.doesNotMatch(help,/title:\s*'HMI Builder'/);
});

test('canonical Modbus core facade exports concrete shared primitives',()=>{
  const core=require('../src/modbusCore');
  for(const key of ['ConnectionBroker','MasterEngine','SerialTransport','TcpClientTransport','TcpServerTransport','TlsClientTransport','TlsServerTransport','UdpClientTransport','UdpServerTransport','protocol']){
    assert.ok(core[key],`modbusCore must export ${key}`);
  }
  const runtime=read('src/master/masterRuntime.js');
  assert.match(runtime,/require\('\.\.\/modbusCore'\)/);
  assert.doesNotMatch(runtime,/require\('\.\.\/v8\//);
});

test('register mapping extension is loaded after Monitor Sessions and parses',()=>{
  const loader=read('public/platform-v6.js');
  const mapping=read('public/master-register-meta-v7.js');
  const css=read('public/master-register-meta-v7.css');
  new vm.Script(mapping,{filename:'master-register-meta-v7.js'});

  const sessions=loader.indexOf("sessions.src='/master-sessions-v7.js");
  const mappingLoad=loader.indexOf("registerMeta.src='/master-register-meta-v7.js",sessions);
  assert.ok(sessions>=0&&mappingLoad>sessions,'register mapping must load after Monitor Sessions');
  assert.match(loader,/master-register-meta-v7\.css/);
  assert.match(mapping,/modbus\.master\.register-meta\.v1/);
  assert.match(mapping,/Register Mapping/);
  assert.match(mapping,/master-register-map-change/);
  assert.match(css,/\.master-map-dialog/);
});

test('canonical product audit explicitly forbids non-Modbus scope',()=>{
  const audit=read('docs/MODBUS_ONLY_PRODUCT_AUDIT.md');
  for(const phrase of ['generic HMI/SCADA design','generic process control','src/modbusCore.js','Device Clone','Test Sequences']){
    assert.ok(audit.includes(phrase),`scope audit must retain: ${phrase}`);
  }
  assert.match(audit,/former v8 shell is no longer a product or desktop launch path/);
});
