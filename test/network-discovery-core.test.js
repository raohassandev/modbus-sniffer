'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {prefixFromNetmask,networkAddress,listNetworkInterfaces}=require('../src/networkDiscovery/networkInterfaces');
const {parseNeighborText}=require('../src/networkDiscovery/hostDiscovery');
const {buildHostFingerprint,duplicateFindings,normalizeMac}=require('../src/networkDiscovery/deviceFingerprint');
const {buildReadHoldingRequest}=require('../src/networkDiscovery/modbusVerifier');
const {NetworkStore}=require('../src/networkDiscovery/networkStore');
const {NetworkScanManager}=require('../src/networkDiscovery/scanManager');

test('network interface helpers derive prefix and suggested target',()=>{
  assert.equal(prefixFromNetmask('255.255.255.0'),24);
  assert.equal(networkAddress('192.168.10.44','255.255.255.0'),'192.168.10.0');
  const rows=listNetworkInterfaces({interfaces:{Ethernet:[{address:'192.168.10.44',netmask:'255.255.255.0',family:'IPv4',mac:'00:11:22:33:44:55',internal:false,cidr:'192.168.10.44/24'}]}});
  assert.equal(rows[0].suggestedTarget,'192.168.10.0/24');
});

test('neighbor parser accepts Windows and Unix forms and preserves conflicting MAC observations',()=>{
  const map=parseNeighborText(`
Interface: 192.168.1.10 --- 0x8
  192.168.1.20          00-11-22-33-44-55     dynamic
? (192.168.1.20) at 66:77:88:99:aa:bb on en0
192.168.1.30 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
`);
  assert.deepEqual(map.get('192.168.1.20').macs,['00:11:22:33:44:55','66:77:88:99:AA:BB']);
  assert.equal(map.get('192.168.1.30').mac,'AA:BB:CC:DD:EE:FF');
});

test('fingerprint distinguishes verified Modbus from a port candidate',()=>{
  const candidate=buildHostFingerprint({ip:'192.168.1.5',services:[{port:502,open:true,name:'Modbus TCP',category:'modbus-candidate',rttMs:3}],modbus:{verified:false,port:502}});
  assert.equal(candidate.modbus.verified,false);
  const verified=buildHostFingerprint({ip:'192.168.1.5',services:[{port:502,open:true,name:'Modbus TCP',category:'modbus-candidate'}],modbus:{verified:true,port:502}});
  assert.equal(verified.type,'Modbus Device');
  assert.equal(verified.confidence>=95,true);
});

test('duplicate diagnostics use all observed MAC evidence',()=>{
  const findings=duplicateFindings([{ip:'192.168.1.50',mac:'00:11:22:33:44:55',macObservations:['00:11:22:33:44:55','66:77:88:99:AA:BB']}]);
  assert.equal(findings.some(x=>x.type==='duplicate-ip'),true);
  assert.equal(normalizeMac('00-11-22-33-44-55'),'00:11:22:33:44:55');
});

test('Modbus verifier request uses valid MBAP and read-only FC03',()=>{
  const b=buildReadHoldingRequest(0x1234,7,0,1);
  assert.equal(b.length,12);
  assert.equal(b.readUInt16BE(0),0x1234);
  assert.equal(b.readUInt16BE(2),0);
  assert.equal(b.readUInt16BE(4),6);
  assert.equal(b[6],7);
  assert.equal(b[7],3);
});

test('network store persists hosts scans baseline compare and events',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'modbus-network-store-'));
  try{
    const store=new NetworkStore({dataDir:dir});
    const a=store.mergeHost('p1',{ip:'192.168.1.10',mac:'00:11:22:33:44:55',hostname:'PLC-1',alive:true,state:'online',services:[{port:502,protocol:'tcp',name:'Modbus TCP',status:'verified'}]});
    const scan1=store.saveScan('p1',{id:'s1',profile:'standard',target:'192.168.1.0/24',hosts:[a],summary:{online:1}});
    const baseline=store.saveBaseline('p1',scan1.id,'Commissioning');
    const b=store.mergeHost('p1',{...a,hostname:'PLC-RENAMED',lastSeen:new Date().toISOString()});
    store.saveScan('p1',{id:'s2',profile:'standard',target:'192.168.1.0/24',hosts:[b],summary:{online:1}});
    const diff=store.compare('p1',{baselineId:baseline.id,rightScanId:'s2'});
    assert.equal(diff.summary.changed,1);
    assert.equal(store.listEvents('p1').length>=2,true);
    const reloaded=new NetworkStore({dataDir:dir});
    assert.equal(reloaded.listHosts('p1').length,1);
    assert.equal(reloaded.listScans('p1').length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('scan manager streams a compact range through injected workers and persists under starting project',async()=>{
  const seen=[],saved=[];
  const fakeStore={
    replaceScanHosts:(project,hosts)=>{saved.push(['hosts',project,hosts.length]);return hosts.map((h,i)=>({...h,id:`h${i}`}));},
    saveScan:(project,scan)=>{saved.push(['scan',project,scan.hosts.length]);return{id:scan.id};}
  };
  let project='p-start';
  const manager=new NetworkScanManager({
    store:fakeStore,getProjectId:()=>project,neighbors:async()=>new Map(),
    discover:async ip=>{seen.push(ip);await new Promise(r=>setTimeout(r,2));return{ip,alive:true,state:'online',services:[],hostnames:[],firstSeen:new Date().toISOString(),lastSeen:new Date().toISOString()};},
    enrich:async host=>({...host,type:'Unknown',industrial:false,modbus:null,services:[]})
  });
  const started=manager.start({target:'192.168.1.1-192.168.1.4',profile:'quick',hostConcurrency:2,useIcmp:false});
  assert.equal(started.running,true);
  project='p-changed';
  for(let i=0;i<100&&manager.status().running;i++)await new Promise(r=>setTimeout(r,5));
  const done=manager.status();
  assert.equal(done.state,'completed');
  assert.equal(done.summary.scanned,4);
  assert.equal(seen.length,4);
  assert.equal(saved.every(x=>x[1]==='p-start'),true);
});

test('scan manager requires explicit confirmation for public targets',()=>{
  const manager=new NetworkScanManager({neighbors:async()=>new Map(),discover:async()=>({alive:false})});
  assert.throws(()=>manager.start({target:'8.8.8.8'}),e=>e?.code==='PUBLIC_TARGET_CONFIRMATION_REQUIRED');
});
