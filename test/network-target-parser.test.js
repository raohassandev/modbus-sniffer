'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseSingleTarget,parseTargets,iterateTargets,previewTargets,privateIpv4,ipv4ToInt,intToIpv4}=require('../src/networkDiscovery/targetParser');

test('IPv4 helpers round-trip',()=>{
  for(const ip of ['0.0.0.0','10.0.0.1','192.168.254.254','255.255.255.255'])assert.equal(intToIpv4(ipv4ToInt(ip)),ip);
});

test('CIDR target excludes network and broadcast by default',()=>{
  const d=parseSingleTarget('192.168.10.0/24');
  assert.equal(d.count,254);
  assert.equal(intToIpv4(d.start),'192.168.10.1');
  assert.equal(intToIpv4(d.end),'192.168.10.254');
});

test('compact octet ranges support the requested 192.168.1-254.1-254 form',()=>{
  const p=parseTargets({targets:'192.168.1-254.1-254'});
  assert.equal(p.count,254*254);
  const it=iterateTargets(p);
  assert.equal(it.next().value,'192.168.1.1');
  let last;for(const ip of it)last=ip;
  assert.equal(last,'192.168.254.254');
});

test('multiple targets deduplicate and exclusions apply',()=>{
  const p=parseTargets({targets:['192.168.1.1-192.168.1.5','192.168.1.4/32'],exclude:'192.168.1.3'});
  assert.deepEqual([...iterateTargets(p)],['192.168.1.1','192.168.1.2','192.168.1.4','192.168.1.5']);
  assert.equal(p.count,4);
});

test('large target safety limits fail before execution',()=>{
  assert.throws(()=>parseTargets({targets:'10.0.0.0/8'}),e=>e?.code==='TARGET_HARD_LIMIT'||e?.code==='TARGET_LIMIT');
  assert.throws(()=>parseTargets({targets:'192.168.0.0/16',maxTargets:1000}),e=>e?.code==='TARGET_LIMIT');
});

test('preview reports public target acknowledgement requirement',()=>{
  const local=previewTargets({targets:'192.168.1.0/30'});
  assert.equal(local.hasPublicTargets,false);
  assert.equal(local.count,2);
  const publicNet=previewTargets({targets:'8.8.8.8'});
  assert.equal(publicNet.hasPublicTargets,true);
  assert.equal(privateIpv4('172.16.0.1'),true);
  assert.equal(privateIpv4('172.32.0.1'),false);
});

test('invalid ranges are rejected',()=>{
  for(const target of ['192.168.999.1','192.168.10-2.1','192.168.1.20-192.168.1.10','192.168.1.0/33'])assert.throws(()=>parseTargets({targets:target}));
});
