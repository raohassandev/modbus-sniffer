'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const {compareCaptures,compareRegisterMaps,compareTestRuns,registersFromCapture}=require('../src/compare/compareService');

test('capture comparison detects unit/function/register changes without mutating captures',()=>{
  const left={
    createdAt:'2026-01-01T00:00:00Z',
    transactions:[
      {id:1,timestamp:100,direction:'RSP',unitId:1,functionCode:3,transport:'RTU',decoded:{functionCode:3,registers:[{address:0,value:10},{address:1,value:20}]}},
      {id:2,timestamp:200,direction:'TIMEOUT',unitId:1,functionCode:3,transport:'RTU',timeout:true},
    ],
  };
  const right={
    createdAt:'2026-01-02T00:00:00Z',
    transactions:[
      {id:3,timestamp:100,direction:'RSP',unitId:1,functionCode:3,transport:'RTU',decoded:{functionCode:3,registers:[{address:0,value:11},{address:1,value:20}]}},
      {id:4,timestamp:120,direction:'RSP',unitId:2,functionCode:4,transport:'TCP',decoded:{functionCode:4,registers:[{address:5,value:99}]}},
    ],
  };
  const snapshot=JSON.stringify({left,right});
  const diff=compareCaptures(left,right);
  assert.deepEqual(diff.units.added,[2]);
  assert.deepEqual(diff.functions.added,[4]);
  assert.equal(diff.deltas.timeouts,-1);
  assert.equal(diff.registerDiff.totals.changed,1);
  assert.equal(diff.registerDiff.totals.added,1);
  assert.equal(diff.registerDiff.changed[0].beforeValue,10);
  assert.equal(diff.registerDiff.changed[0].afterValue,11);
  assert.equal(JSON.stringify({left,right}),snapshot);
});

test('register map comparison reports added removed changed and unchanged entries',()=>{
  const left=[
    {deviceKey:'d1',functionCode:3,address:0,lastValue:1},
    {deviceKey:'d1',functionCode:3,address:1,lastValue:2},
    {deviceKey:'d1',functionCode:3,address:2,lastValue:3},
  ];
  const right=[
    {deviceKey:'d1',functionCode:3,address:0,lastValue:1},
    {deviceKey:'d1',functionCode:3,address:1,lastValue:22},
    {deviceKey:'d1',functionCode:3,address:3,lastValue:4},
  ];
  const diff=compareRegisterMaps(left,right);
  assert.deepEqual(diff.totals,{left:3,right:3,added:1,removed:1,changed:1,unchanged:1});
  assert.equal(diff.changed[0].beforeValue,2);
  assert.equal(diff.changed[0].afterValue,22);
});

test('Test Sequence run comparison detects result and per-step changes',()=>{
  const left={runId:'a',recipeId:'r',passed:true,elapsedMs:100,evidence:[
    {stepId:'read',result:'passed',value:[1]},
    {stepId:'assert',result:'passed',value:true},
  ]};
  const right={runId:'b',recipeId:'r',passed:false,elapsedMs:150,evidence:[
    {stepId:'read',result:'passed',value:[2]},
    {stepId:'assert',result:'failed',error:{code:'ASSERTION_FAILED'}},
    {stepId:'cleanup',result:'passed'},
  ]};
  const diff=compareTestRuns(left,right);
  assert.equal(diff.resultChanged,true);
  assert.equal(diff.elapsedDeltaMs,50);
  assert.ok(diff.steps.some(x=>x.stepId==='read'&&x.status==='changed'));
  assert.ok(diff.steps.some(x=>x.stepId==='cleanup'&&x.status==='added'));
});

test('Test Sequence comparison preserves repeated step occurrences instead of collapsing by stepId',()=>{
  const left={runId:'left',recipeId:'repeat',passed:true,evidence:[
    {stepId:'sample',result:'passed',value:[10]},
    {stepId:'sample',result:'passed',value:[20]},
    {stepId:'sample',result:'passed',value:[30]},
  ]};
  const right={runId:'right',recipeId:'repeat',passed:true,evidence:[
    {stepId:'sample',result:'passed',value:[10]},
    {stepId:'sample',result:'passed',value:[25]},
    {stepId:'sample',result:'passed',value:[30]},
  ]};
  const diff=compareTestRuns(left,right);
  assert.equal(diff.steps.length,3);
  assert.deepEqual(diff.steps.map(x=>x.occurrence),[1,2,3]);
  assert.deepEqual(diff.steps.map(x=>x.key),['sample#1','sample#2','sample#3']);
  assert.equal(diff.steps[0].status,'unchanged');
  assert.equal(diff.steps[1].status,'changed');
  assert.equal(diff.steps[2].status,'unchanged');
});

test('Replay Compare browser workspace loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/compare-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/compare-v7.css'),'utf8');
  new vm.Script(ui,{filename:'compare-v7.js'});
  assert.match(loader,/compare-v7\.css/);
  assert.match(loader,/compare\.src='\/compare-v7\.js/);
  assert.match(ui,/Capture vs Capture/);
  assert.match(ui,/\/api\/compare\/captures/);
  assert.match(ui,/\/api\/compare\/register-maps/);
  assert.match(ui,/\/api\/compare\/test-runs/);
  assert.match(css,/\.compare-workspace/);
});
