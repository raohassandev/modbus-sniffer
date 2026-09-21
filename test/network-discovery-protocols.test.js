'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const {
  parseTargets,iterateTargets,previewTargets,ipv6ToBigInt,bigIntToIpv6,privateIpv6,targetContains
}=require('../src/networkDiscovery/targetParser');
const {buildLogicalTopology,addressUtilization,subnetGroup}=require('../src/networkDiscovery/topology');
const {parseNmapXml,discoverWithNmap}=require('../src/networkDiscovery/nmapAdapter');
const {tlv,encInt,encOctet,encOid,requestPacket,parseResponse,snmpGet,SYSTEM_OIDS}=require('../src/networkDiscovery/snmpClient');
const {encodeDnsName,decodeDnsName,parseHttpLike}=require('../src/networkDiscovery/multicastDiscovery');
const {parseNmapPrefixes,parseIeeeCsv,prefix}=require('../src/networkDiscovery/ouiResolver');

test('IPv6 target model normalizes host and bounded CIDR targets',()=>{
  const value=ipv6ToBigInt('2001:db8::1');
  assert.equal(bigIntToIpv6(value),'2001:db8::1');
  const p=parseTargets({targets:'fd00::/126'});
  assert.equal(p.count,4);
  assert.deepEqual([...iterateTargets(p)],['fd00::','fd00::1','fd00::2','fd00::3']);
  assert.equal(privateIpv6('fd00::1'),true);
  assert.equal(targetContains(p,'fd00::2'),true);
  assert.equal(targetContains(p,'fd00::5'),false);
  assert.throws(()=>parseTargets({targets:'2001:db8::/64'}),e=>e?.code==='TARGET_HARD_LIMIT'||e?.code==='TARGET_LIMIT');
});

test('target preview reports compact-range count without losing samples',()=>{
  const p=previewTargets({targets:'192.168.1-2.1-3'});
  assert.equal(p.count,6);
  assert.deepEqual(p.samples,['192.168.1.1','192.168.1.2','192.168.1.3','192.168.2.1','192.168.2.2','192.168.2.3']);
});

test('logical topology does not invent physical links',()=>{
  const top=buildLogicalTopology([
    {id:'h1',ip:'192.168.1.10',hostname:'PLC-1',state:'online',industrial:true,modbus:{verified:true}},
    {id:'h2',ip:'192.168.1.20',hostname:'HMI-1',state:'online',industrial:true}
  ]);
  assert.equal(top.summary.hosts,2);
  assert.equal(top.summary.subnets,1);
  assert.equal(top.edges.every(e=>e.kind==='logical-membership'&&e.physical===false),true);
  const util=addressUtilization([{ip:'192.168.1.10',state:'online',modbus:{verified:true}},{ip:'192.168.1.20',state:'online'}]);
  assert.equal(util[0].used,2);
  assert.equal(util[0].modbus,1);
});

test('IPv6 hosts participate in /64 topology without fake free-address counts',()=>{
  assert.deepEqual(subnetGroup('fd00:1::25'),{family:6,subnet:'fd00:1::/64'});
  const top=buildLogicalTopology([{id:'v6',ip:'fd00:1::25',hostname:'PLC-v6',state:'online',modbus:{verified:true}}]);
  assert.equal(top.summary.hosts,1);
  assert.equal(top.summary.subnets,1);
  assert.equal(top.nodes.some(n=>n.kind==='subnet'&&n.family===6&&n.subnet==='fd00:1::/64'),true);
  const util=addressUtilization([{ip:'fd00:1::25',state:'online',modbus:{verified:true}}]);
  assert.equal(util[0].family,6);
  assert.equal(util[0].used,1);
  assert.equal(util[0].free,null);
  assert.deepEqual(util[0].usedAddresses,['fd00:1::25']);
});

test('Nmap XML parser preserves host, MAC vendor, service and OS provenance',()=>{
  const xml=`<?xml version="1.0"?><nmaprun><host><status state="up"/><address addr="192.168.1.10" addrtype="ipv4"/><address addr="00:11:22:33:44:55" addrtype="mac" vendor="Example Controls"/><hostnames><hostname name="plc-1.local"/></hostnames><ports><port protocol="tcp" portid="502"><state state="open"/><service name="modbus" product="Example PLC" version="1.2" method="probed" conf="10"/></port></ports><os><osmatch name="Embedded Linux" accuracy="92" line="1"/></os></host></nmaprun>`;
  const hosts=parseNmapXml(xml);
  assert.equal(hosts.length,1);
  assert.equal(hosts[0].ip,'192.168.1.10');
  assert.equal(hosts[0].macVendor,'Example Controls');
  assert.equal(hosts[0].ports[0].port,502);
  assert.equal(hosts[0].ports[0].product,'Example PLC');
  assert.equal(hosts[0].os.name,'Embedded Linux');
});

test('Nmap adapter rejects option-like or oversized targets before execution',async()=>{
  await assert.rejects(()=>discoverWithNmap({targets:'--script=vuln'}),/Unsupported IP target format|Invalid/);
  await assert.rejects(()=>discoverWithNmap({targets:'10.0.0.0/8'}),e=>e?.code==='TARGET_HARD_LIMIT'||e?.code==='TARGET_LIMIT');
});

test('SNMP BER parser decodes a bounded v2c GetResponse',()=>{
  const requestId=12345;
  const varbind=tlv(0x30,Buffer.concat([encOid(SYSTEM_OIDS.sysName),encOctet('PLC-01')]));
  const vars=tlv(0x30,varbind);
  const pdu=tlv(0xA2,Buffer.concat([encInt(requestId),encInt(0),encInt(0),vars]));
  const packet=tlv(0x30,Buffer.concat([encInt(1),encOctet('public'),pdu]));
  const parsed=parseResponse(packet);
  assert.equal(parsed.requestId,requestId);
  assert.equal(parsed.errorStatus,0);
  assert.equal(parsed.variables[0].oid,SYSTEM_OIDS.sysName);
  assert.equal(parsed.variables[0].value,'PLC-01');
  const req=requestPacket({community:'public',oids:[SYSTEM_OIDS.sysDescr],requestId:7});
  assert.equal(req.requestId,7);
  assert.equal(Buffer.isBuffer(req.packet),true);
});

test('SNMP read-only client rejects non-IP destinations before UDP transmission',async()=>{
  await assert.rejects(snmpGet({host:'device.local',community:'public',oids:[SYSTEM_OIDS.sysName],timeoutMs:100}),e=>e?.code==='SNMP_IP_REQUIRED');
});

test('multicast helpers parse DNS names and SSDP-like headers safely',()=>{
  const encoded=encodeDnsName('_modbus._tcp.local');
  const decoded=decodeDnsName(encoded,0);
  assert.equal(decoded.name,'_modbus._tcp.local');
  const http=parseHttpLike('HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.5/info\r\nSERVER: Test Device\r\n\r\n');
  assert.equal(http.headers.location,'http://192.168.1.5/info');
  assert.equal(http.headers.server,'Test Device');
});

test('offline OUI parsers accept Nmap prefixes and IEEE CSV assignments',()=>{
  const nmap=parseNmapPrefixes('001122 Example Controls\nAABBCC Another Vendor\n');
  assert.equal(nmap.get('001122'),'Example Controls');
  const ieee=parseIeeeCsv('Registry,Assignment,Organization Name\nMA-L,001122,Example Controls Ltd\n');
  assert.equal(ieee.get('001122'),'Example Controls Ltd');
  assert.equal(prefix('00:11:22:33:44:55'),'001122');
});
