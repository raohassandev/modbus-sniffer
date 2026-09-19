'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('Traffic evidence tools expose source/session/range selection and export',()=>{
  const root=path.resolve(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'public/traffic-evidence-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/traffic-evidence-v7.css'),'utf8');
  new vm.Script(ui,{filename:'traffic-evidence-v7.js'});
  assert.match(ui,/Raw Lab/);
  assert.match(ui,/trafficConnection/);
  assert.match(ui,/trafficAddressMin/);
  assert.match(ui,/trafficExportSelected/);
  assert.match(ui,/modbus-selected-evidence\.csv/);
  assert.match(ui,/Evidence annotation/);
  assert.match(css,/evidence-bookmarked/);
});
