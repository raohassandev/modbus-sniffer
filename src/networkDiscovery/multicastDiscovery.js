'use strict';

const dgram=require('node:dgram');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const crypto=require('node:crypto');
const execFileAsync=promisify(execFile);

function sanitize(v,max=1000){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);}
function udpCollect({host,port,payload,timeoutMs=1200,onMessage=null,multicastTtl=2}={}){
  return new Promise((resolve,reject)=>{
    const socket=dgram.createSocket({type:'udp4',reuseAddr:true}),rows=[];let done=false;
    const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);try{socket.close();}catch{}err?reject(err):resolve(rows);};
    const timer=setTimeout(()=>finish(),Math.max(200,Math.min(5000,Number(timeoutMs)||1200)));
    socket.on('error',e=>finish(e));
    socket.on('message',(msg,rinfo)=>{try{const parsed=onMessage?onMessage(msg,rinfo):{raw:msg.toString('utf8'),ip:rinfo.address};if(parsed)rows.push(parsed);}catch{}});
    socket.bind(0,()=>{try{socket.setMulticastTTL(multicastTtl);}catch{}socket.send(Buffer.from(payload),Number(port),String(host),e=>{if(e)finish(e);});});
  });
}
function parseHttpLike(text){
  const lines=String(text||'').split(/\r?\n/),headers={};for(const line of lines.slice(1)){const i=line.indexOf(':');if(i>0)headers[line.slice(0,i).trim().toLowerCase()]=sanitize(line.slice(i+1));}
  return{status:sanitize(lines[0]||'',200),headers};
}
async function discoverSsdp({timeoutMs=1200}={}){
  const payload='M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n';
  const rows=await udpCollect({host:'239.255.255.250',port:1900,payload,timeoutMs,onMessage:(msg,rinfo)=>{const p=parseHttpLike(msg.toString('utf8'));return{method:'ssdp',ip:rinfo.address,port:rinfo.port,location:p.headers.location||null,server:p.headers.server||null,usn:p.headers.usn||null,serviceType:p.headers.st||null,cacheControl:p.headers['cache-control']||null,source:'SSDP/UPnP'};}});
  return[...new Map(rows.map(r=>[`${r.ip}|${r.usn||r.location||''}`,r])).values()];
}
function encodeDnsName(name){const out=[];for(const part of String(name).split('.').filter(Boolean)){const b=Buffer.from(part,'utf8');if(b.length>63)throw new Error('mDNS label too long.');out.push(Buffer.from([b.length]),b);}out.push(Buffer.from([0]));return Buffer.concat(out);}
function mdnsQueryPacket(name='_services._dns-sd._udp.local'){
  const header=Buffer.alloc(12);header.writeUInt16BE(0,0);header.writeUInt16BE(0,2);header.writeUInt16BE(1,4);
  const q=Buffer.concat([encodeDnsName(name),Buffer.from([0,12,0x80,1])]);return Buffer.concat([header,q]);
}
function decodeDnsName(buf,offset,depth=0){
  if(depth>20)return{name:'',next:offset};const labels=[];let pos=offset,next=null;
  while(pos<buf.length){const len=buf[pos++];if(len===0){if(next==null)next=pos;break;}if((len&0xC0)===0xC0){if(pos>=buf.length)break;const ptr=((len&0x3F)<<8)|buf[pos++];if(next==null)next=pos;const sub=decodeDnsName(buf,ptr,depth+1);if(sub.name)labels.push(sub.name);break;}if(pos+len>buf.length)break;labels.push(buf.subarray(pos,pos+len).toString('utf8'));pos+=len;}
  return{name:labels.join('.'),next:next??pos};
}
function parseMdnsPacket(buf){
  if(!Buffer.isBuffer(buf)||buf.length<12)return[];const qd=buf.readUInt16BE(4),an=buf.readUInt16BE(6),ns=buf.readUInt16BE(8),ar=buf.readUInt16BE(10);let off=12;
  for(let i=0;i<qd;i++){const n=decodeDnsName(buf,off);off=n.next+4;if(off>buf.length)return[];}
  const rows=[];for(let i=0;i<an+ns+ar&&off<buf.length;i++){const n=decodeDnsName(buf,off);off=n.next;if(off+10>buf.length)break;const type=buf.readUInt16BE(off),klass=buf.readUInt16BE(off+2)&0x7FFF,ttl=buf.readUInt32BE(off+4),len=buf.readUInt16BE(off+8);off+=10;const start=off,end=off+len;if(end>buf.length)break;let value=null;
    if(type===1&&len===4)value=[...buf.subarray(start,end)].join('.');
    else if(type===28&&len===16){const groups=[];for(let x=start;x<end;x+=2)groups.push(buf.readUInt16BE(x).toString(16));value=groups.join(':');}
    else if(type===12||type===5)value=decodeDnsName(buf,start).name;
    else if(type===33&&len>=6){const target=decodeDnsName(buf,start+6).name;value={priority:buf.readUInt16BE(start),weight:buf.readUInt16BE(start+2),port:buf.readUInt16BE(start+4),target};}
    else if(type===16){const vals=[];let p=start;while(p<end){const l=buf[p++];vals.push(buf.subarray(p,Math.min(end,p+l)).toString('utf8'));p+=l;}value=vals;}
    rows.push({name:n.name,type,klass,ttl,value});off=end;
  }return rows;
}
async function discoverMdns({timeoutMs=1200}={}){
  const packet=mdnsQueryPacket(),responses=await udpCollect({host:'224.0.0.251',port:5353,payload:packet,timeoutMs,onMessage:(msg,rinfo)=>({ip:rinfo.address,records:parseMdnsPacket(msg),source:'mDNS'})});
  const byIp=new Map();for(const row of responses){const x=byIp.get(row.ip)||{method:'mdns',ip:row.ip,names:new Set(),services:new Set(),records:[],source:'mDNS'};x.records.push(...row.records);for(const rec of row.records){if(rec.name)x.names.add(rec.name);if(rec.type===12&&typeof rec.value==='string')x.services.add(rec.value);}byIp.set(row.ip,x);}
  return[...byIp.values()].map(x=>({...x,names:[...x.names].slice(0,32),services:[...x.services].slice(0,64),records:x.records.slice(0,128)}));
}
function wsdProbe(){
  const id=`urn:uuid:${crypto.randomUUID()}`;
  return `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><e:Header><w:MessageID>${id}</w:MessageID><w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe/></e:Body></e:Envelope>`;
}
async function discoverWsd({timeoutMs=1200}={}){
  const rows=await udpCollect({host:'239.255.255.250',port:3702,payload:wsdProbe(),timeoutMs,onMessage:(msg,rinfo)=>{const text=msg.toString('utf8'),xaddrs=[...text.matchAll(/<(?:\w+:)?XAddrs[^>]*>([\s\S]*?)<\/(?:\w+:)?XAddrs>/gi)].flatMap(m=>sanitize(m[1],2000).split(/\s+/)).filter(Boolean),types=[...text.matchAll(/<(?:\w+:)?Types[^>]*>([\s\S]*?)<\/(?:\w+:)?Types>/gi)].flatMap(m=>sanitize(m[1],1000).split(/\s+/)).filter(Boolean);return{method:'wsd',ip:rinfo.address,xaddrs:xaddrs.slice(0,16),types:types.slice(0,32),source:'WS-Discovery'};}});
  return[...new Map(rows.map(r=>[`${r.ip}|${r.xaddrs.join(',')}`,r])).values()];
}
async function discoverDhcpFromOs(){
  const platform=os.platform(),rows=[];
  try{
    if(platform==='win32'){
      const {stdout}=await execFileAsync('ipconfig',['/all'],{windowsHide:true,timeout:5000,maxBuffer:2*1024*1024});
      let adapter=null;for(const line of String(stdout).split(/\r?\n/)){if(/^\S.*adapter .*:$/i.test(line.trim()))adapter=sanitize(line.trim().replace(/:$/,''),200);const m=/DHCP Server[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i.exec(line);if(m)rows.push({method:'dhcp-os',ip:m[1],adapter,source:'OS DHCP configuration'});}
    }else if(platform==='darwin'){
      const ifaces=Object.entries(os.networkInterfaces()).filter(([,xs])=>(xs||[]).some(x=>!x.internal&&x.family==='IPv4')).map(([name])=>name);
      for(const iface of ifaces){try{const {stdout}=await execFileAsync('ipconfig',['getpacket',iface],{timeout:2500,maxBuffer:512*1024});const m=/server_identifier \(ip\):\s*([^\s]+)/i.exec(stdout);if(m)rows.push({method:'dhcp-os',ip:m[1],adapter:iface,source:'OS DHCP configuration'});}catch{}}
    }else{
      try{const {stdout}=await execFileAsync('nmcli',['-t','-f','GENERAL.DEVICE,DHCP4.OPTION','device','show'],{timeout:5000,maxBuffer:2*1024*1024});for(const m of String(stdout).matchAll(/dhcp_server_identifier\s*=\s*(\d{1,3}(?:\.\d{1,3}){3})/gi))rows.push({method:'dhcp-os',ip:m[1],adapter:null,source:'OS DHCP configuration'});}catch{}
    }
  }catch{}
  return[...new Map(rows.map(r=>[`${r.ip}|${r.adapter||''}`,r])).values()];
}
async function auxiliaryDiscovery({ssdp=true,mdns=true,wsd=true,dhcp=true,timeoutMs=1200}={}){
  const tasks=[];if(ssdp)tasks.push(discoverSsdp({timeoutMs}).catch(()=>[]));if(mdns)tasks.push(discoverMdns({timeoutMs}).catch(()=>[]));if(wsd)tasks.push(discoverWsd({timeoutMs}).catch(()=>[]));if(dhcp)tasks.push(discoverDhcpFromOs().catch(()=>[]));
  const groups=await Promise.all(tasks),results=groups.flat();return{generatedAt:new Date().toISOString(),results,summary:{total:results.length,ips:new Set(results.map(x=>x.ip).filter(Boolean)).size,ssdp:results.filter(x=>x.method==='ssdp').length,mdns:results.filter(x=>x.method==='mdns').length,wsd:results.filter(x=>x.method==='wsd').length,dhcp:results.filter(x=>x.method==='dhcp-os').length}};
}

module.exports={parseHttpLike,discoverSsdp,encodeDnsName,mdnsQueryPacket,decodeDnsName,parseMdnsPacket,discoverMdns,discoverWsd,discoverDhcpFromOs,auxiliaryDiscovery};
