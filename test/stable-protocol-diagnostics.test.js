'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const { protocol }=require('../src/modbusCore');
const { analyzeProtocolTraffic }=require('../src/evidence/protocolDiagnostics');

test('protocol diagnostics validates RTU CRC, matches pairs, reports exception and corrupt frame',()=>{
  const reqPdu=protocol.encodeReadRequest({functionCode:3,address:0,quantity:2});
  const rspPdu=protocol.encodeReadRegistersResponse({values:[11,22]});
  const exPdu=Buffer.from([0x83,0x02]);
  const req=protocol.encodeRtuAdu(1,reqPdu);
  const rsp=protocol.encodeRtuAdu(1,rspPdu);
  const ex=protocol.encodeRtuAdu(1,exPdu);
  const corrupt=Buffer.from(req);corrupt[corrupt.length-1]^=0xFF;

  const rows=[
    {id:1,timestamp:1000,direction:'REQ',unitId:1,functionCode:3,rawHex:req.toString('hex'),transport:'RTU',channelId:'rtu:com5',sourceType:'Sniffer'},
    {id:2,timestamp:1012,direction:'RSP',unitId:1,functionCode:3,rawHex:rsp.toString('hex'),transport:'RTU',channelId:'rtu:com5',sourceType:'Sniffer'},
    {id:3,timestamp:2000,direction:'REQ',unitId:1,functionCode:3,rawHex:req.toString('hex'),transport:'RTU',channelId:'rtu:com5',sourceType:'Sniffer'},
    {id:4,timestamp:2010,direction:'RSP',unitId:1,functionCode:3,rawHex:ex.toString('hex'),transport:'RTU',channelId:'rtu:com5',sourceType:'Sniffer'},
    {id:5,timestamp:3000,direction:'REQ',unitId:1,functionCode:3,rawHex:corrupt.toString('hex'),transport:'RTU',channelId:'rtu:com5',sourceType:'Sniffer'},
  ];

  const out=analyzeProtocolTraffic(rows,{serialConfig:{baudRate:9600,dataBits:8,parity:'none',stopBits:1}});
  assert.equal(out.totals.matchedPairs,2);
  assert.equal(out.totals.invalidFrames,1);
  assert.equal(out.totals.exceptions,1);
  assert.equal(out.exceptions[0].exceptionCode,2);
  assert.equal(out.exceptions[0].exceptionName,'Illegal Data Address');
  assert.equal(out.latency.p95Ms,12);
  assert.ok(out.frameIssues.some(x=>x.code==='CRC_MISMATCH'));
  assert.ok(out.gapAnalysis[0].silentIntervalMs>0);
});

test('protocol diagnostics detects duplicate request and out-of-order TCP responses',()=>{
  const req1=protocol.encodeTcpAdu({transactionId:10,unitId:1,pdu:protocol.encodeReadRequest({functionCode:3,address:0,quantity:1})});
  const req2=protocol.encodeTcpAdu({transactionId:11,unitId:1,pdu:protocol.encodeReadRequest({functionCode:3,address:1,quantity:1})});
  const rsp1=protocol.encodeTcpAdu({transactionId:10,unitId:1,pdu:protocol.encodeReadRegistersResponse({values:[100]})});
  const rsp2=protocol.encodeTcpAdu({transactionId:11,unitId:1,pdu:protocol.encodeReadRegistersResponse({values:[200]})});
  const rows=[
    {id:10,timestamp:100,direction:'REQ',unitId:1,functionCode:3,rawHex:req1.toString('hex'),transport:'TCP',connectionId:'c1',sourceType:'Master'},
    {id:11,timestamp:101,direction:'REQ',unitId:1,functionCode:3,rawHex:req1.toString('hex'),transport:'TCP',connectionId:'c1',sourceType:'Master'},
    {id:12,timestamp:102,direction:'REQ',unitId:1,functionCode:3,rawHex:req2.toString('hex'),transport:'TCP',connectionId:'c1',sourceType:'Master'},
    {id:13,timestamp:110,direction:'RSP',unitId:1,functionCode:3,rawHex:rsp2.toString('hex'),transport:'TCP',connectionId:'c1',sourceType:'Master'},
    {id:14,timestamp:112,direction:'RSP',unitId:1,functionCode:3,rawHex:rsp1.toString('hex'),transport:'TCP',connectionId:'c1',sourceType:'Master'},
  ];
  const out=analyzeProtocolTraffic(rows);
  assert.equal(out.totals.duplicateRequests,1);
  assert.equal(out.totals.outOfOrderTcpResponses,1);
  assert.ok(out.outOfOrderTcpResponses.some(x=>x.transactionId===10&&x.previousTransactionId===11));
});

test('protocol diagnostics and Data Lab browser extensions load and parse',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const pd=fs.readFileSync(path.join(root,'public/protocol-diagnostics-v7.js'),'utf8');
  const dl=fs.readFileSync(path.join(root,'public/data-lab-v7.js'),'utf8');
  new vm.Script(pd,{filename:'protocol-diagnostics-v7.js'});
  new vm.Script(dl,{filename:'data-lab-v7.js'});
  assert.match(loader,/protocol-diagnostics-v7\.js/);
  assert.match(loader,/data-lab-v7\.js/);
  assert.match(pd,/CRC\/LRC\/MBAP/);
  assert.match(dl,/Advanced Register\/Data Lab/);
  assert.match(dl,/\/api\/register\/interpret/);
});
