'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

const {ConnectionBroker,RawFrameStudio,protocol}=require('../src/modbusCore');
const {createVirtualLoopbackPair}=require('../src/v8/transports/virtualLoopback');
const {StableRawLabService}=require('../src/rawLab/rawLabService');

test('Raw Frame Studio appends RTU CRC and validates expected masked response',async()=>{
  const pair=createVirtualLoopbackPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'raw',resourceKey:'loop:raw',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'raw',ownerId:'test-raw',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    const req=await pair.b.receive({timeoutMs:500});
    const adu=protocol.decodeRtuAdu(req);
    const rsp=protocol.encodeRtuAdu(adu.unitId,protocol.encodeReadRegistersResponse({functionCode:3,values:[0x1234]}));
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

test('Raw Frame Studio semantic response policy rejects exception where success is required',async()=>{
  const pair=createVirtualLoopbackPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'semantic-success',resourceKey:'loop:semantic-success',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'semantic-success',ownerId:'test-semantic',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    const req=await pair.b.receive({timeoutMs:500});
    const adu=protocol.decodeRtuAdu(req);
    await pair.b.send(protocol.encodeRtuAdu(adu.unitId,Buffer.from([0x83,0x02])));
  })();
  await assert.rejects(
    ()=>studio.send({hex:'01 03 00 00 00 01',autoChecksum:true,timeoutMs:500,responsePolicy:'success'}),
    error=>error?.code==='MODBUS_EXCEPTION'&&error?.details?.exceptionCode===2
  );
  await responder;await studio.close();await pair.b.close();
});

test('Raw Frame Studio matching policy accepts a matching Modbus exception as evidence',async()=>{
  const pair=createVirtualLoopbackPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'semantic-exception',resourceKey:'loop:semantic-exception',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'semantic-exception',ownerId:'test-semantic',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    const req=await pair.b.receive({timeoutMs:500});
    const adu=protocol.decodeRtuAdu(req);
    await pair.b.send(protocol.encodeRtuAdu(adu.unitId,Buffer.from([0x83,0x03])));
  })();
  const result=await studio.send({hex:'01 03 00 00 00 00',autoChecksum:true,timeoutMs:500,responsePolicy:'matching'});
  await responder;
  assert.equal(result.responseValidation.exception,true);
  assert.equal(result.responseValidation.exceptionCode,3);
  assert.equal(result.responseValidation.requestFunctionCode,3);
  await studio.close();await pair.b.close();
});

test('Raw Frame Studio success policy rejects structurally invalid FC03 payloads',async()=>{
  const pair=createVirtualLoopbackPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'semantic-pdu',resourceKey:'loop:semantic-pdu',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'semantic-pdu',ownerId:'test-semantic',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    const req=await pair.b.receive({timeoutMs:500});
    const adu=protocol.decodeRtuAdu(req);
    await pair.b.send(protocol.encodeRtuAdu(adu.unitId,Buffer.from([0x03,0x01,0x7F])));
  })();
  await assert.rejects(
    ()=>studio.send({hex:'01 03 00 00 00 01',autoChecksum:true,timeoutMs:500,responsePolicy:'success'}),
    error=>error?.code==='INVALID_RESPONSE_PDU'&&error?.details?.causeCode==='BYTE_COUNT_MISMATCH'
  );
  await responder;await studio.close();await pair.b.close();
});

test('Raw Frame Studio semantic matching rejects a response from the wrong Unit',async()=>{
  const pair=createVirtualLoopbackPair();
  const broker=new ConnectionBroker();
  broker.defineConnection({connectionId:'semantic-unit',resourceKey:'loop:semantic-unit',transportKind:'virtual',transport:pair.a,exclusive:true});
  const studio=new RawFrameStudio({broker,connectionId:'semantic-unit',ownerId:'test-semantic',framing:'rtu'});
  await pair.b.open();await studio.open();
  const responder=(async()=>{
    await pair.b.receive({timeoutMs:500});
    await pair.b.send(protocol.encodeRtuAdu(2,protocol.encodeReadRegistersResponse({functionCode:3,values:[7]})));
  })();
  await assert.rejects(
    ()=>studio.send({hex:'01 03 00 00 00 01',autoChecksum:true,timeoutMs:500,responsePolicy:'matching'}),
    error=>error?.code==='RESPONSE_UNIT_MISMATCH'
  );
  await responder;await studio.close();await pair.b.close();
});

test('Raw Frame Studio refuses malformed raw frame until LAB armed',async()=>{
  const pair=createVirtualLoopbackPair();
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
