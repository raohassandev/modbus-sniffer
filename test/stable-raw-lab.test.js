'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

const {ConnectionBroker,RawFrameStudio,protocol}=require('../src/modbusCore');
const {VirtualLoopbackTransport}=require('../src/v8/transports/virtualLoopback');
const {StableRawLabService}=require('../src/rawLab/rawLabService');

test('Raw Frame Studio appends RTU CRC and validates expected masked response',async()=>{
  const pair=VirtualLoopbackTransport.createPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'raw',resourceKey:'loop:raw',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'raw',ownerId:'test-raw',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    const req=await pair.b.receive({timeoutMs:500});
    const adu=protocol.decodeRtuAdu(req);
    const rsp=protocol.encodeRtuAdu(adu.unitId,protocol.encodeReadRegistersResponse({values:[0x1234]}));
    await pair.b.send(rsp);
  })();
  const result=await studio.send({
    hex:'01 03 00 00 00 01',autoChecksum:true,timeoutMs:500,
    expectedHex:'01 03 02 12 34 B5 33',expectedMaskHex:'FF FF FF FF FF 00 00'
  });
  await responder;
  assert.equal(result.ok,true);
  assert.equal(result.intent,'read');
  assert.equal(protocol.decodeRtuAdu(result.requestRaw).unitId,1);
  await studio.close();await pair.b.close();
});

test('Raw Frame Studio refuses malformed raw frame until LAB armed',async()=>{
  const pair=VirtualLoopbackTransport.createPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'raw',resourceKey:'loop:raw2',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'raw',ownerId:'test-raw',framing:'rtu'});
  await pair.b.open();await studio.open();
  await assert.rejects(()=>studio.send({hex:'01 99 00',expectResponse:false,confirmation:{raw:true}}),e=>e?.code==='LAB_NOT_ARMED');
  studio.armLab({confirmation:{confirmed:true,raw:true},durationMs:1000});
  const result=await studio.send({hex:'01 99 00',expectResponse:false,confirmation:{raw:true}});
  assert.equal(result.intent,'raw');
  await studio.close();await pair.b.close();
});

test('stable Raw Lab case persistence is bounded to Modbus raw cases',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rawlab-'));
  const service=new StableRawLabService({dataDir:dir});
  t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
  service.saveCase({name:'FC03 basic',framing:'rtu',hex:'01 03 00 00 00 01',autoChecksum:true,expectResponse:true,expectedHex:null});
  assert.equal(service.listCases().length,1);
  assert.equal(service.listCases()[0].id,'fc03-basic');
  assert.equal(service.removeCase('fc03-basic'),true);
  assert.equal(service.listCases().length,0);
});

test('stable Raw Lab browser workspace loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/raw-lab-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/raw-lab-v7.css'),'utf8');
  new vm.Script(ui,{filename:'raw-lab-v7.js'});
  assert.match(loader,/raw-lab-v7\.css/);
  assert.match(loader,/rawLab\.src='\/raw-lab-v7\.js/);
  assert.match(ui,/Raw Frame \/ Conformance Lab/);
  assert.match(ui,/\/api\/raw-lab\/send/);
  assert.match(ui,/Expected mask HEX/);
  assert.match(css,/\.rawlab-workspace/);
});
