'use strict';

const {SERVICE_CATALOG}=require('./serviceScanner');

function normalizeMac(value){
  const hex=String(value||'').replace(/[^0-9a-f]/gi,'').toUpperCase();
  if(hex.length!==12)return null;
  return hex.match(/.{2}/g).join(':');
}
function macCharacteristics(value){
  const mac=normalizeMac(value);if(!mac)return{mac:null,locallyAdministered:null,multicast:null};
  const first=parseInt(mac.slice(0,2),16);
  return{mac,locallyAdministered:Boolean(first&2),multicast:Boolean(first&1)};
}
function serviceFacts(services=[]){
  return (services||[]).filter(x=>x?.open).map(x=>({
    port:Number(x.port),protocol:'tcp',name:x.name||SERVICE_CATALOG[x.port]?.name||'Unknown TCP',
    category:x.category||SERVICE_CATALOG[x.port]?.category||'unknown',rttMs:x.rttMs??null,
    source:'tcp-connect',confidence:100,status:'verified'
  })).sort((a,b)=>a.port-b.port);
}
function inferDeviceType({hostname='',services=[],modbus=null}={}){
  const h=String(hostname||'').toLowerCase(),ports=new Set((services||[]).filter(x=>x.open).map(x=>Number(x.port)));
  const candidates=[];
  const add=(type,confidence,reason)=>candidates.push({type,confidence,reason});
  if(modbus?.verified)add('Modbus Device',90,'Valid Modbus TCP response');
  if(ports.has(102))add('PLC / Automation Controller',72,'Siemens S7 service candidate');
  if(ports.has(44818))add('PLC / EtherNet-IP Device',70,'EtherNet/IP service candidate');
  if(ports.has(4840))add('OPC UA Device',66,'OPC UA service candidate');
  if(/\b(hmi|panel|weintek|kinco)\b/.test(h))add('HMI / Operator Panel',62,'Hostname pattern');
  if(/\b(plc|cpu|s7)\b/.test(h))add('PLC / Automation Controller',62,'Hostname pattern');
  if(/\b(meter|pm|analyzer|power)\b/.test(h))add('Meter / Analyzer',58,'Hostname pattern');
  if(/\b(logger|gateway|gw)\b/.test(h))add('Gateway / Logger',58,'Hostname pattern');
  if(!candidates.length&&ports.has(80)||ports.has(443))add('Network Device',35,'Web management service');
  candidates.sort((a,b)=>b.confidence-a.confidence);
  return candidates[0]||{type:'Unknown',confidence:0,reason:null};
}
function buildHostFingerprint(input={}){
  const services=serviceFacts(input.services),modbus=input.modbus||null,hostname=String(input.hostname||input.hostnames?.[0]||'').trim(),mac=macCharacteristics(input.mac),type=inferDeviceType({hostname,services:input.services,modbus});
  const industrial=Boolean(modbus?.verified||services.some(s=>['industrial-candidate','modbus-candidate'].includes(s.category)));
  const evidence=[];
  if(input.ip)evidence.push({field:'ip',value:String(input.ip),source:'scan-target',confidence:100,status:'observed'});
  if(mac.mac)evidence.push({field:'mac',value:mac.mac,source:input.macSource||'neighbor-table',confidence:95,status:'observed'});
  if(hostname)evidence.push({field:'hostname',value:hostname,source:'reverse-dns',confidence:70,status:'observed'});
  for(const s of services)evidence.push({field:`service:${s.port}`,value:s.name,source:s.source,confidence:s.confidence,status:s.status});
  if(modbus?.verified)evidence.push({field:'modbus',value:`${input.ip}:${modbus.port}`,source:'modbus-protocol-verification',confidence:100,status:'verified'});
  if(type.confidence)evidence.push({field:'deviceType',value:type.type,source:'fingerprint-rules',confidence:type.confidence,status:'inferred'});
  return{
    ip:String(input.ip||''),hostname:hostname||null,hostnames:(input.hostnames||[]).slice(0,8),mac:mac.mac,
    macLocallyAdministered:mac.locallyAdministered,macMulticast:mac.multicast,
    services,industrial,modbus,type:type.type,typeConfidence:type.confidence,typeReason:type.reason,
    evidence,confidence:Math.min(100,Math.max(modbus?.verified?95:0,mac.mac?75:0,services.length?70:0,hostname?55:0)),
  };
}
function duplicateFindings(hosts=[]){
  const ipMac=new Map(),macIp=new Map();
  for(const h of hosts){
    const ip=String(h.ip||''),mac=normalizeMac(h.mac);if(!ip||!mac)continue;
    if(!ipMac.has(ip))ipMac.set(ip,new Set());ipMac.get(ip).add(mac);
    if(!macIp.has(mac))macIp.set(mac,new Set());macIp.get(mac).add(ip);
  }
  const findings=[];
  for(const [ip,set] of ipMac)if(set.size>1)findings.push({type:'duplicate-ip',severity:'critical',ip,macs:[...set],message:`${ip} was observed with multiple MAC addresses.`});
  for(const [mac,set] of macIp)if(set.size>1)findings.push({type:'multi-ip-mac',severity:'warning',mac,ips:[...set],message:`${mac} was observed on multiple IP addresses.`});
  return findings;
}

module.exports={normalizeMac,macCharacteristics,serviceFacts,inferDeviceType,buildHostFingerprint,duplicateFindings};
