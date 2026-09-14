'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {ModbusTcpStreamParser,decodeTcpAdu}=require('../src/modbus/tcpParser');
const {TcpTransactionTracker}=require('../src/modbus/tcpTransactionTracker');
const {PlatformRuntimeStateV62}=require('../src/platformRuntimeStateV62');
const {buildRtuChannel,buildTcpChannel}=require('../src/transportIdentity');
const {HistoryStore}=require('../src/historyStore');
const {validateTcp,isLoopbackHost}=require('../src/platformWebServerV61');
const {ModbusTcpProxy,listLocalIpv4Interfaces,recommendedListenHost,isLocalListenHost}=require('../src/modbusTcpProxy');

function rspTx(channel,unitId,value,address=100){return{direction:'RSP',transport:channel.transport,channel,decoded:{transport:channel.transport,slaveId:unitId,unitId,functionCode:3,functionName:'Read Holding Registers',registers:[{address,value}]},request:{transport:channel.transport,slaveId:unitId,unitId,functionCode:3,functionName:'Read Holding Registers',startAddress:address,quantity:1,timestamp:1000},rttMs:20};}

const reqRaw=Buffer.from([0,1,0,0,0,6,1,3,0,100,0,2]);

test('TCP parser accepts every fragmentation boundary and coalesced ADUs',()=>{
  for(let split=1;split<reqRaw.length;split++){
    const p=new ModbusTcpStreamParser(),seen=[];p.on('frame',f=>seen.push(f));
    p.push(reqRaw.subarray(0,split),100);p.push(reqRaw.subarray(split),101);
    assert.equal(seen.length,1,`split ${split}`);assert.equal(seen[0].decoded.startAddress,100);
  }
  const p=new ModbusTcpStreamParser(),seen=[];p.on('frame',f=>seen.push(f));p.push(Buffer.concat([reqRaw,reqRaw]),100);assert.equal(seen.length,2);
});

test('TCP parser reports malformed prefixes, resynchronizes, and reports truncated close',()=>{
  const p=new ModbusTcpStreamParser(),seen=[],errors=[];p.on('frame',f=>seen.push(f));p.on('error-frame',e=>errors.push(e.code));
  const malformed=Buffer.from([0,9,0,1,0,6,1,3,0,1,0,1]);p.push(Buffer.concat([malformed,reqRaw]),100);
  assert.equal(seen.length,1);assert.ok(errors.includes('MBAP_PROTOCOL_ID'));
  const q=new ModbusTcpStreamParser(),truncated=[];q.on('error-frame',e=>truncated.push(e.code));q.push(reqRaw.subarray(0,9),100);assert.equal(q.finish(101),9);assert.deepEqual(truncated,['MBAP_TRUNCATED']);
});

test('TCP tracker preserves reused transaction IDs and pairs out-of-order responses by function',()=>{
  const fc3=decodeTcpAdu(Buffer.from([0,7,0,0,0,6,1,3,0,10,0,1]));
  const fc4=decodeTcpAdu(Buffer.from([0,7,0,0,0,6,1,4,0,20,0,1]));
  const r4=decodeTcpAdu(Buffer.from([0,7,0,0,0,5,1,4,2,0,22]));
  const r3=decodeTcpAdu(Buffer.from([0,7,0,0,0,5,1,3,2,0,11]));
  const collisions=[];const t=new TcpTransactionTracker({onCollision:x=>collisions.push(x)});
  t.request(fc3,1000);t.request(fc4,1010);assert.equal(t.pendingCount(),2);assert.equal(t.collisions,1);assert.equal(collisions.length,1);
  const tx4=t.response(r4,1040);assert.equal(tx4.request.functionCode,4);assert.equal(tx4.decoded.registers[0].address,20);
  const tx3=t.response(r3,1050);assert.equal(tx3.request.functionCode,3);assert.equal(tx3.decoded.registers[0].address,10);assert.equal(t.pendingCount(),0);
});

test('TCP read payload mismatch is flagged and not mapped to engineering registers',()=>{
  const t=new TcpTransactionTracker(),request=decodeTcpAdu(Buffer.from([0,3,0,0,0,6,1,3,0,10,0,2])),response=decodeTcpAdu(Buffer.from([0,3,0,0,0,5,1,3,2,0,11]));
  t.request(request,1000);const tx=t.response(response,1020);assert.equal(tx.decoded.payloadValid,false);assert.equal(tx.decoded.registers,undefined);assert.match(tx.decoded.protocolWarning,/does not match expected/);
});

test('TCP tracker drains pending requests with explicit connection outcome',()=>{
  const outcomes=[];const t=new TcpTransactionTracker({onTimeout:r=>outcomes.push(r.outcome)});const f=decodeTcpAdu(reqRaw);
  t.request(f,1000);t.request({...f,transactionId:2},1010);const drained=t.drain('target-reset',1100);
  assert.equal(drained.length,2);assert.equal(t.pendingCount(),0);assert.deepEqual(outcomes,['target-reset','target-reset']);assert.ok(drained.every(x=>x.connectionClosed));
});

test('TCP proxy configuration is loopback-safe by default and external bind requires explicit confirmation',()=>{
  assert.equal(isLoopbackHost('127.0.0.1'),true);assert.equal(isLoopbackHost('localhost'),true);assert.equal(isLoopbackHost('0.0.0.0'),false);
  const local=validateTcp({targetHost:'192.168.1.5'});assert.equal(local.listenHost,'127.0.0.1');assert.equal(local.maxClientSessions,8);
  assert.throws(()=>validateTcp({listenHost:'0.0.0.0',targetHost:'192.168.1.5'}),e=>e.code==='EXTERNAL_BIND_CONFIRMATION_REQUIRED');
  const external=validateTcp({listenHost:'0.0.0.0',targetHost:'192.168.1.5',confirmExternalBind:true,maxClientSessions:4});assert.equal(external.maxClientSessions,4);
  assert.throws(()=>validateTcp({targetHost:'192.168.1.5',maxClientSessions:129}),/1\.\.128/);
});

test('TCP interface inventory separates Ethernet Wi-Fi and loopback and recommends the target subnet',()=>{
  const synthetic={
    Ethernet:[{address:'192.168.10.20',netmask:'255.255.255.0',family:'IPv4',internal:false,mac:'00:11:22:33:44:55',cidr:'192.168.10.20/24'}],
    'Wi-Fi':[{address:'192.168.1.30',netmask:'255.255.255.0',family:'IPv4',internal:false,mac:'00:11:22:33:44:66',cidr:'192.168.1.30/24'}],
    Loopback:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',internal:true,mac:'00:00:00:00:00:00',cidr:'127.0.0.1/8'}]
  };
  const list=listLocalIpv4Interfaces(synthetic);
  assert.deepEqual(list.map(x=>x.address).sort(),['127.0.0.1','192.168.1.30','192.168.10.20'].sort());
  assert.equal(list.find(x=>x.address==='192.168.10.20').kind,'Ethernet');
  assert.equal(list.find(x=>x.address==='192.168.1.30').kind,'Wi-Fi');
  assert.equal(recommendedListenHost('192.168.10.50',list),'192.168.10.20');
  assert.equal(recommendedListenHost('192.168.1.80',list),'192.168.1.30');
  assert.equal(recommendedListenHost('10.0.0.5',list),null);
  assert.equal(isLocalListenHost('192.168.1.30',list),true);
  assert.equal(isLocalListenHost('203.0.113.77',list),false);
  assert.equal(isLocalListenHost('0.0.0.0',list),true);
});

test('TCP proxy refuses a listen IP that is not assigned to this PC before opening a socket',async()=>{
  const proxy=new ModbusTcpProxy();
  await assert.rejects(proxy.start({listenHost:'203.0.113.77',targetHost:'127.0.0.1',targetPort:502}),e=>e.code==='LISTEN_HOST_NOT_LOCAL');
  assert.equal(proxy.server,null);
});

test('offline capture device status is relative to capture time, not current wall clock',()=>{
  const channel=buildRtuChannel({port:'COM4',identity:{serialNumber:'OLD'},config:{baudRate:9600,parity:'none',dataBits:8,stopBits:1}});
  const event={timestamp:1000,direction:'RSP',transport:'RTU',channelId:channel.channelId,channel,unitId:1,slaveId:1,functionCode:3,functionName:'Read Holding Registers',matched:true,rttMs:20,byteLength:7,rawHex:'01',decoded:{transport:'RTU',channelId:channel.channelId,unitId:1,slaveId:1,functionCode:3,functionName:'Read Holding Registers',registers:[{address:100,value:5}]},request:{transport:'RTU',channelId:channel.channelId,unitId:1,slaveId:1,functionCode:3,startAddress:100,quantity:1,timestamp:980}};
  const state=new PlatformRuntimeStateV62();state.loadCapture({format:'mbcap',version:2,schemaVersion:2,channels:[channel],transactions:[event]});
  const d=state.getDevices()[0];assert.equal(d.status,'online');assert.equal(d.statusReference,'capture');assert.equal(d.referenceTime,1000);
});

test('RTU and TCP health expose transport-specific metrics without mixing serial noise into TCP',()=>{
  const state=new PlatformRuntimeStateV62();
  const rtu=buildRtuChannel({port:'COM8',identity:{serialNumber:'R1'},config:{baudRate:9600,parity:'none',dataBits:8,stopBits:1}});
  const tcp=buildTcpChannel({targetHost:'192.168.1.50',targetPort:502});
  state.recordFrame(rspTx(rtu,1,10),1100,Buffer.from([1,3,2,0,10]));
  state.recordFrame(rspTx(tcp,1,20),1200,Buffer.from([1,3,2,0,20]));
  state.recordNoise(5,1200,rtu.channelId);
  state.recordTcpDiagnostic(tcp,'parser-error',{code:'MBAP_PROTOCOL_ID',timestamp:1201});
  const channels=state.getChannels(),r=channels.find(c=>c.transport==='RTU'),t=channels.find(c=>c.transport==='TCP');
  assert.ok(Object.hasOwn(r.health,'noiseRatio'));assert.ok(Object.hasOwn(r.health,'wireUtilizationPct'));
  assert.equal(Object.hasOwn(t.health,'noiseRatio'),false);assert.equal(Object.hasOwn(t.health,'wireUtilizationPct'),false);assert.equal(t.health.protocolIdErrors,1);
  const a=state.getAnalysis();assert.equal(a.healthAggregation,'minimum-channel-score');assert.equal(a.rates.noiseScope,'RTU-only');
});

test('TCP connection-close outcomes are separated from silent timeout rate',()=>{
  const state=new PlatformRuntimeStateV62(),tcp=buildTcpChannel({targetHost:'10.0.0.2',targetPort:502});state.registerChannel(tcp);
  const req={transport:'TCP',channel:tcp,channelId:tcp.channelId,unitId:1,slaveId:1,functionCode:3,functionName:'Read Holding Registers',startAddress:1,quantity:1,timestamp:1000,outcome:'target-reset',connectionClosed:true};
  state.recordTimeout(req,1100,5000,'TCP');const c=state.getChannels().find(x=>x.channelId===tcp.channelId);assert.equal(c.health.timeouts,0);assert.equal(c.health.connectionClosedRequests,1);assert.equal(c.health.timeoutRate,0);
});

test('history query can isolate one channel or device without rewriting stored history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mbhist62-')),h=new HistoryStore({dataDir:dir});
  h.append('p',{recordedAt:100,channels:[{channelId:'a'},{channelId:'b'}],devices:[{deviceKey:'a|1',channelId:'a'},{deviceKey:'b|1',channelId:'b'}]});
  const byChannel=h.query('p',{channelId:'b'});assert.deepEqual(byChannel[0].channels.map(x=>x.channelId),['b']);assert.deepEqual(byChannel[0].devices.map(x=>x.deviceKey),['b|1']);
  const byDevice=h.query('p',{deviceKey:'a|1'});assert.deepEqual(byDevice[0].devices.map(x=>x.deviceKey),['a|1']);
});
