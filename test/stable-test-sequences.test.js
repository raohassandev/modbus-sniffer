'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const { SlaveRuntime }=require('../src/slave/slaveRuntime');
const { MasterRuntime }=require('../src/master/masterRuntime');
const { TestSequenceService, validateStableSequence }=require('../src/testSequences/testSequenceService');

test('stable Test Sequences run read/assert and guarded write/read-back against built-in Slave',async t=>{
  const slave=new SlaveRuntime();
  const master=new MasterRuntime();
  const sequences=new TestSequenceService({masterRuntime:master});
  t.after(async()=>{sequences.stop();await master.disconnect();await slave.shutdown();});

  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  slave.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[123,456]});
  await master.connect({type:'tcp',host:'127.0.0.1',port:started.listenAddress.port,timeoutMs:1000});

  const readRecipe={
    schemaVersion:1,id:'read-check',name:'Read Check',
    steps:[
      {type:'read',id:'read',unitId:1,functionCode:3,address:0,quantity:2,saveAs:'holding'},
      {type:'assert',id:'assert',variable:'holding',operator:'includes',expected:123},
    ],
  };
  const readRun=await sequences.run(readRecipe);
  assert.equal(readRun.result.passed,true);
  assert.deepEqual(readRun.result.variables.holding,[123,456]);
  assert.equal(master.status().writeState,'LOCKED');

  const writeRecipe={
    schemaVersion:1,id:'write-check',name:'Write Check',
    steps:[
      {type:'write',id:'write',unitId:1,functionCode:6,address:1,value:777,confirmation:{confirmed:true}},
      {type:'read',id:'verify',unitId:1,functionCode:3,address:0,quantity:2,saveAs:'after'},
      {type:'assert',id:'assert-after',variable:'after',operator:'includes',expected:777},
    ],
  };
  const writeRun=await sequences.run(writeRecipe);
  assert.equal(writeRun.result.passed,true);
  assert.deepEqual(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:2}).values,[123,777]);
  assert.equal(master.status().writeState,'LOCKED');
  assert.ok(master.writeAuditEntries({limit:20}).some(row=>
    row.functionCode===6&&
    row.result==='success'&&
    row.context?.source==='stable-test-sequence'&&
    row.verification?.matched===true
  ));
  assert.ok(writeRun.result.evidence.some(row=>row.type==='write'&&row.requestRawHex&&row.responseRawHex));
});

test('Test Sequence failure after a write still leaves Master write latch locked',async t=>{
  const slave=new SlaveRuntime();
  const master=new MasterRuntime();
  const sequences=new TestSequenceService({masterRuntime:master});
  t.after(async()=>{sequences.stop();await master.disconnect();await slave.shutdown();});

  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0});
  slave.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[1]});
  await master.connect({type:'tcp',host:'127.0.0.1',port:started.listenAddress.port,timeoutMs:1000});

  const recipe={
    schemaVersion:1,id:'fail-after-write',name:'Fail After Write',
    steps:[
      {type:'write',id:'write',unitId:1,functionCode:6,address:0,value:55,confirmation:{confirmed:true}},
      {type:'read',id:'read',unitId:1,functionCode:3,address:0,quantity:1,saveAs:'after'},
      {type:'assert',id:'forced-fail',variable:'after',operator:'includes',expected:999},
    ],
  };

  await assert.rejects(
    sequences.run(recipe),
    error=>error?.code==='ASSERTION_FAILED'&&error?.recipeResult?.passed===false
  );
  assert.equal(master.status().writeState,'LOCKED');
  assert.deepEqual(slave.readMemory({unitId:1,area:'holdingRegisters',address:0,quantity:1}).values,[55]);
  assert.equal(sequences.history({limit:10}).at(-1).passed,false);
});

test('stable Test Sequence validation rejects generic automation/raw steps and bounds expansion',()=>{
  for(const type of ['connect','disconnect','raw','armLab','disarmLab','armWrites','lockWrites']){
    assert.throws(
      ()=>validateStableSequence({schemaVersion:1,steps:[{type,...(type==='raw'?{hex:'0103'}:{})}]}),
      error=>error?.code==='STEP_NOT_ALLOWED'
    );
  }

  assert.throws(
    ()=>validateStableSequence({
      schemaVersion:1,
      steps:[{
        type:'repeat',count:1000,steps:[
          {type:'repeat',count:1000,steps:[{type:'delay',ms:1}]}
        ]
      }]
    }),
    error=>error?.code==='RECIPE_EXECUTION_LIMIT'
  );

  const valid=validateStableSequence({
    schemaVersion:1,
    steps:[{type:'write',unitId:1,functionCode:16,address:0,values:[1,2],confirmation:{confirmed:true,bulk:true}}],
  });
  assert.equal(valid.writes,1);
});

test('stable Test Sequences workspace loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/test-sequences-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/test-sequences-v7.css'),'utf8');
  const routes=fs.readFileSync(path.join(root,'src/testSequences/testSequenceRoutes.js'),'utf8');

  new vm.Script(ui,{filename:'test-sequences-v7.js'});
  assert.match(loader,/test-sequences-v7\.css/);
  assert.match(loader,/sequences\.src='\/test-sequences-v7\.js/);
  assert.match(ui,/Modbus Test Sequences/);
  assert.match(ui,/\/api\/test-sequences\/validate/);
  assert.match(ui,/\/api\/test-sequences\/run/);
  assert.match(ui,/command\('pause'\)/);
  assert.match(ui,/command\('resume'\)/);
  assert.match(ui,/command\('stop'\)/);
  assert.match(routes,/\/api\/test-sequences\/pause/);
  assert.match(routes,/\/api\/test-sequences\/resume/);
  assert.match(routes,/\/api\/test-sequences\/stop/);
  assert.match(ui,/one-shot guarded/i);
  assert.match(css,/\.sequence-workspace/);
});
