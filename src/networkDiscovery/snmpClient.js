'use strict';

const dgram=require('node:dgram');
const net=require('node:net');
const crypto=require('node:crypto');

function encLen(n){if(n<128)return Buffer.from([n]);const bytes=[];let x=n;while(x>0){bytes.unshift(x&255);x>>>=8;}return Buffer.from([0x80|bytes.length,...bytes]);}
function tlv(tag,body){const b=Buffer.from(body||[]);return Buffer.concat([Buffer.from([tag]),encLen(b.length),b]);}
function encInt(n){
  let x=BigInt(n),bytes=[];
  if(x===0n)bytes=[0];
  else{while(x>0n){bytes.unshift(Number(x&255n));x>>=8n;}if(bytes[0]&0x80)bytes.unshift(0);}
  return tlv(0x02,Buffer.from(bytes));
}
function encOctet(v){return tlv(0x04,Buffer.from(String(v??''),'utf8'));}
function encNull(){return tlv(0x05,Buffer.alloc(0));}
function encOid(oid){
  const parts=String(oid).replace(/^\./,'').split('.').filter(Boolean).map(Number);
  if(parts.length<2||parts.some(x=>!Number.isInteger(x)||x<0))throw new Error('Invalid SNMP OID.');
  const bytes=[parts[0]*40+parts[1]];
  for(const p of parts.slice(2)){let stack=[p&0x7f],x=p>>>7;while(x){stack.unshift((x&0x7f)|0x80);x>>>=7;}bytes.push(...stack);}
  return tlv(0x06,Buffer.from(bytes));
}
function requestPacket({community='public',oids=[],requestId=null,pduTag=0xA0,version=1}={}){
  const id=requestId??crypto.randomInt(1,0x7fffffff);
  const vars=Buffer.concat(oids.map(oid=>tlv(0x30,Buffer.concat([encOid(oid),encNull()]))));
  const pdu=tlv(pduTag,Buffer.concat([encInt(id),encInt(0),encInt(0),tlv(0x30,vars)]));
  return{requestId:id,packet:tlv(0x30,Buffer.concat([encInt(version),encOctet(community),pdu]))};
}
function readLen(buf,offset){
  const first=buf[offset++];if(first==null)throw new Error('Truncated BER length.');
  if(!(first&0x80))return{length:first,offset};
  const count=first&0x7f;if(count<1||count>4||offset+count>buf.length)throw new Error('Invalid BER length.');
  let n=0;for(let i=0;i<count;i++)n=(n<<8)|buf[offset++];return{length:n,offset};
}
function readTlv(buf,offset=0){
  const tag=buf[offset++];if(tag==null)throw new Error('Truncated BER tag.');const l=readLen(buf,offset);const start=l.offset,end=start+l.length;if(end>buf.length)throw new Error('Truncated BER value.');return{tag,start,end,length:l.length,next:end,value:buf.subarray(start,end)};
}
function children(t){const out=[];let o=t.start;while(o<t.end){const x=readTlv(t._buf,o);x._buf=t._buf;out.push(x);o=x.next;}return out;}
function wrap(buf,t){t._buf=buf;return t;}
function decInt(buf){
  if(!buf.length)return 0;let n=0n;for(const b of buf)n=(n<<8n)|BigInt(b);
  if(buf[0]&0x80)n-=1n<<BigInt(buf.length*8);
  const num=Number(n);return Number.isSafeInteger(num)?num:n.toString();
}
function decOid(buf){
  if(!buf.length)return'';const first=buf[0],parts=[Math.min(2,Math.floor(first/40)),first-(Math.min(2,Math.floor(first/40))*40)];let n=0;
  for(const b of buf.subarray(1)){n=(n<<7)|(b&0x7f);if(!(b&0x80)){parts.push(n);n=0;}}
  return parts.join('.');
}
function decValue(t){
  const b=t.value;
  if(t.tag===0x02)return decInt(b);
  if(t.tag===0x04)return b.toString('utf8').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
  if(t.tag===0x05)return null;
  if(t.tag===0x06)return decOid(b);
  if(t.tag===0x40)return[...b].join('.');
  if([0x41,0x42,0x43,0x46].includes(t.tag)){let n=0n;for(const x of b)n=(n<<8n)|BigInt(x);const num=Number(n);return Number.isSafeInteger(num)?num:n.toString();}
  if([0x80,0x81,0x82].includes(t.tag))return{exception:t.tag===0x80?'noSuchObject':t.tag===0x81?'noSuchInstance':'endOfMibView'};
  return{tag:t.tag,hex:b.toString('hex').toUpperCase()};
}
function parseResponse(packet){
  const buf=Buffer.from(packet),root=wrap(buf,readTlv(buf,0));if(root.tag!==0x30)throw new Error('Invalid SNMP message.');
  const top=children(root);if(top.length<3)throw new Error('Invalid SNMP response.');
  const version=decInt(top[0].value),community=top[1].value.toString('utf8'),pdu=top[2];if(pdu.tag!==0xA2)throw new Error('SNMP packet is not a GetResponse.');
  const parts=children(pdu),requestId=decInt(parts[0].value),errorStatus=decInt(parts[1].value),errorIndex=decInt(parts[2].value),list=parts[3],variables=[];
  for(const vb of children(list)){const pair=children(vb);if(pair.length>=2)variables.push({oid:decOid(pair[0].value),tag:pair[1].tag,value:decValue(pair[1])});}
  return{version,community,requestId,errorStatus,errorIndex,variables};
}
function snmpRequest({host,port=161,community,oids,pduTag=0xA0,timeoutMs=900,signal=null}={}){
  if(!community){const e=new Error('SNMP community is required explicitly.');e.code='SNMP_COMMUNITY_REQUIRED';return Promise.reject(e);}
  const {requestId,packet}=requestPacket({community,oids,requestId:null,pduTag});
  return new Promise((resolve,reject)=>{
    const family=net.isIP(String(host));if(!family){const e=new Error('SNMP host must be an IP literal.');e.code='SNMP_IP_REQUIRED';return reject(e);}const socket=dgram.createSocket(family===6?'udp6':'udp4');let settled=false;
    const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);try{socket.close();}catch{}err?reject(err):resolve(value);};
    const onAbort=()=>{const e=new Error('SNMP request cancelled.');e.code='NETWORK_SCAN_CANCELLED';finish(e);};
    const timer=setTimeout(()=>{const e=new Error('SNMP request timed out.');e.code='SNMP_TIMEOUT';finish(e);},Math.max(100,Math.min(5000,Number(timeoutMs)||900)));
    signal?.addEventListener?.('abort',onAbort,{once:true});
    socket.on('error',e=>finish(e));
    socket.on('message',msg=>{try{const parsed=parseResponse(msg);if(Number(parsed.requestId)!==Number(requestId))return;finish(null,{...parsed,host:String(host),port:Number(port)});}catch(e){finish(e);}});
    socket.send(packet,Number(port),String(host),e=>{if(e)finish(e);});
  });
}
async function snmpGet({host,port=161,community,oids,timeoutMs=900,signal=null}={}){return snmpRequest({host,port,community,oids,pduTag:0xA0,timeoutMs,signal});}
async function snmpGetNext({host,port=161,community,oid,timeoutMs=900,signal=null}={}){return snmpRequest({host,port,community,oids:[oid],pduTag:0xA1,timeoutMs,signal});}
async function snmpWalk({host,port=161,community,prefix,maxRows=64,timeoutMs=900,signal=null}={}){
  const root=String(prefix).replace(/^\./,''),rows=[];let cursor=root;
  for(let i=0;i<Math.max(1,Math.min(256,Number(maxRows)||64));i++){
    const response=await snmpGetNext({host,port,community,oid:cursor,timeoutMs,signal}),row=response.variables?.[0];if(!row)break;
    if(row.value?.exception||!(row.oid===root||row.oid.startsWith(root+'.'))||row.oid===cursor)break;
    rows.push(row);cursor=row.oid;
  }
  return rows;
}
const SYSTEM_OIDS=Object.freeze({
  sysDescr:'1.3.6.1.2.1.1.1.0',sysObjectID:'1.3.6.1.2.1.1.2.0',sysUpTime:'1.3.6.1.2.1.1.3.0',sysName:'1.3.6.1.2.1.1.5.0',sysLocation:'1.3.6.1.2.1.1.6.0'
});
async function readSnmpSystem({host,port=161,community,timeoutMs=900,signal=null}={}){
  const names=Object.keys(SYSTEM_OIDS),response=await snmpGet({host,port,community,oids:names.map(k=>SYSTEM_OIDS[k]),timeoutMs,signal}),byOid=new Map((response.variables||[]).map(x=>[x.oid,x.value])),system={};
  for(const name of names)system[name]=byOid.get(SYSTEM_OIDS[name])??null;
  return{host,port:Number(port),system,response:{errorStatus:response.errorStatus,errorIndex:response.errorIndex}};
}
const LLDP_REM_SYS_NAME='1.0.8802.1.1.2.1.4.1.1.9';
const LLDP_REM_PORT_ID='1.0.8802.1.1.2.1.4.1.1.7';
const LLDP_REM_CHASSIS_ID='1.0.8802.1.1.2.1.4.1.1.5';
function suffix(oid,prefix){return String(oid).slice(String(prefix).length).replace(/^\./,'');}
async function readLldpNeighbors({host,port=161,community,timeoutMs=900,signal=null,maxRows=64}={}){
  const [names,ports,chassis]=await Promise.all([
    snmpWalk({host,port,community,prefix:LLDP_REM_SYS_NAME,maxRows,timeoutMs,signal}).catch(()=>[]),
    snmpWalk({host,port,community,prefix:LLDP_REM_PORT_ID,maxRows,timeoutMs,signal}).catch(()=>[]),
    snmpWalk({host,port,community,prefix:LLDP_REM_CHASSIS_ID,maxRows,timeoutMs,signal}).catch(()=>[])
  ]);
  const map=new Map(),put=(rows,prefix,key)=>{for(const row of rows){const idx=suffix(row.oid,prefix),v=map.get(idx)||{index:idx,source:'LLDP/SNMP',confidence:95,physical:true};v[key]=row.value;const p=idx.split('.').map(Number);if(p.length>=2)v.localPort=p[p.length-2];map.set(idx,v);}};
  put(names,LLDP_REM_SYS_NAME,'name');put(ports,LLDP_REM_PORT_ID,'remotePort');put(chassis,LLDP_REM_CHASSIS_ID,'chassisId');
  return[...map.values()].slice(0,maxRows);
}

module.exports={encLen,tlv,encInt,encOctet,encOid,requestPacket,readTlv,parseResponse,snmpGet,snmpGetNext,snmpWalk,readSnmpSystem,readLldpNeighbors,SYSTEM_OIDS};
