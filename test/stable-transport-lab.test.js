'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const {SlaveRuntime}=require('../src/slave/slaveRuntime');
const {UdpServerTransport,protocol}=require('../src/modbusCore');
const {TransportLabService,buildPdu,descriptor,normalizeConfig}=require('../src/transportLab/transportLabService');

test('Transport Lab performs native Modbus TCP one-shot read against built-in Slave',async t=>{
  const slave=new SlaveRuntime();
  t.after(()=>slave.shutdown());
  const started=await slave.start({type:'tcp',host:'127.0.0.1',port:0,maxClients:4});
  slave.seedMemory({unitId:1,area:'holdingRegisters',address:0,values:[321,654]});

  const service=new TransportLabService();
  const result=await service.test({
    transport:'tcp',host:'127.0.0.1',port:started.listenAddress.port,
    unitId:1,functionCode:3,address:0,quantity:2,timeoutMs:1000
  });
  assert.equal(result.ok,true);
  assert.equal(result.transport.standard,true);
  assert.equal(result.transport.id,'tcp');
  assert.deepEqual(result.decoded.values,[321,654]);
  assert.match(result.requestRawHex,/^[0-9A-F]+$/);
  assert.match(result.responseRawHex,/^[0-9A-F]+$/);
  assert.ok(result.rttMs>=0);
});

test('Transport Lab performs MBAP UDP request through existing UDP transport',async t=>{
  const server=new UdpServerTransport({host:'127.0.0.1',port:0,receiveTimeoutMs:1000});
  await server.open();
  t.after(()=>server.close());
  const addr=server.address();
  const responder=(async()=>{
    const item=await server.receive({timeoutMs:1200,withMeta:true});
    const adu=protocol.decodeTcpAdu(item.bytes);
    const request=protocol.decodeReadRequest(adu.pdu);
    assert.equal(request.address,4);
    assert.equal(request.quantity,1);
    const response=protocol.encodeTcpAdu({
      transactionId:adu.transactionId,protocolId:0,unitId:adu.unitId,
      pdu:protocol.encodeReadRegistersResponse({functionCode:3,values:[777]})
    });
    await server.send(response,{route:item.meta});
  })();

  const service=new TransportLabService();
  const result=await service.test({
    transport:'udp',host:'127.0.0.1',port:addr.port,
    unitId:5,functionCode:3,address:4,quantity:1,timeoutMs:1000
  });
  await responder;
  assert.equal(result.ok,true);
  assert.equal(result.transport.standard,false);
  assert.deepEqual(result.decoded.values,[777]);
  assert.match(result.note,/non-standard/i);
});

test('UDP server expires stale peer identities before enforcing peer limit',()=>{
  const server=new UdpServerTransport({host:'127.0.0.1',port:0,maxPeers:1,peerIdleMs:10});
  server.peers.set('127.0.0.1:1000',{peerId:'127.0.0.1:1000',remoteAddress:'127.0.0.1',remotePort:1000,family:'IPv4',firstSeenAt:1,lastSeenAt:1,framesRx:1});
  const removed=server._prunePeers(20);
  assert.equal(removed,1);
  assert.equal(server.peers.size,0);
  assert.equal(server.status().stats.expiredPeers,1);
  assert.equal(server.status().peerIdleMs,10);
});

test('Transport Lab builders enforce read-only/LAB boundaries and standard labels',()=>{
  assert.equal(descriptor('tls').defaultPort,802);
  assert.equal(descriptor('tls').standard,true);
  assert.equal(descriptor('rtu-tcp').standard,false);
  assert.equal(normalizeConfig({transport:'tls',host:'127.0.0.1'}).port,802);
  assert.equal(buildPdu({functionCode:3,address:0,quantity:1})[0],3);
  assert.throws(()=>buildPdu({functionCode:6,address:0,value:1}),error=>error?.code==='FUNCTION_NOT_ALLOWED');
  assert.throws(()=>buildPdu({functionCode:8,subFunction:10,data:0}),error=>error?.code==='LAB_CONFIRMATION_REQUIRED');
  assert.equal(buildPdu({functionCode:8,subFunction:10,data:0,labConfirmed:true})[0],8);
});

test('Transport Lab browser workspace loads and parses',()=>{
  const root=path.resolve(__dirname,'..');
  const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'public/transport-lab-v7.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'public/transport-lab-v7.css'),'utf8');
  new vm.Script(ui,{filename:'transport-lab-v7.js'});
  assert.match(loader,/transport-lab-v7\.css/);
  assert.match(loader,/transportLab\.src='\/transport-lab-v7\.js/);
  assert.match(ui,/Modbus TCP Security \/ TLS/);
  assert.match(ui,/RTU over TCP — non-standard tunnel/);
  assert.match(ui,/\/api\/transport-lab\/test/);
  assert.match(ui,/\/api\/transport-lab\/interfaces/);
  assert.match(css,/\.tl-workspace/);
});
