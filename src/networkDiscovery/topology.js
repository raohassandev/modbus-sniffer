'use strict';

const net=require('node:net');
const {ipv6ToBigInt,bigIntToIpv6}=require('./targetParser');

function subnet24(ip){
  if(net.isIP(String(ip))!==4)return null;
  const p=String(ip).split('.');return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}
function subnetGroup(ip){
  const family=net.isIP(String(ip));
  if(family===4)return{family:4,subnet:subnet24(ip)};
  if(family===6){
    const n=ipv6ToBigInt(ip),network=(n>>64n)<<64n;
    return{family:6,subnet:`${bigIntToIpv6(network)}/64`};
  }
  return null;
}
function buildLogicalTopology(hosts=[]){
  const nodes=[],edges=[],subnets=new Map();
  for(const host of hosts){
    const ip=String(host.ip||''),group=subnetGroup(ip);if(!group)continue;
    const subnet=group.subnet;if(!subnets.has(subnet))subnets.set(subnet,{id:`subnet:${subnet}`,kind:'subnet',family:group.family,label:subnet,subnet,source:'address-membership',confidence:100});
    const id=String(host.id||`ip:${ip}`),label=host.hostname||host.type||ip;
    nodes.push({id,kind:'host',label,ip,mac:host.mac||null,type:host.type||'Unknown',state:host.state||'unknown',industrial:Boolean(host.industrial),modbus:Boolean(host.modbus?.verified),source:'network-scan',confidence:Number(host.confidence||0)});
    edges.push({id:`edge:${subnets.get(subnet).id}:${id}`,from:subnets.get(subnet).id,to:id,kind:'logical-membership',source:'address-membership',confidence:100,physical:false});
    for(const n of host.topologyNeighbors||[]){
      const target=String(n.hostId||n.ip||n.name||'').trim();if(!target)continue;
      edges.push({id:`edge:neighbor:${id}:${target}`,from:id,to:target,kind:'neighbor',source:n.source||'LLDP/SNMP',confidence:Math.max(0,Math.min(100,Number(n.confidence)||90)),physical:Boolean(n.physical!==false),localPort:n.localPort||null,remotePort:n.remotePort||null});
    }
  }
  nodes.unshift(...subnets.values());
  const uniqEdges=[...new Map(edges.map(e=>[e.id,e])).values()];
  return{generatedAt:new Date().toISOString(),mode:'evidence-logical',nodes,edges:uniqEdges,summary:{hosts:nodes.filter(n=>n.kind==='host').length,subnets:subnets.size,edges:uniqEdges.length,physicalEdges:uniqEdges.filter(e=>e.physical).length}};
}
function addressUtilization(hosts=[]){
  const map=new Map();
  for(const h of hosts){
    const group=subnetGroup(h.ip);if(!group)continue;
    if(!map.has(group.subnet))map.set(group.subnet,{family:group.family,subnet:group.subnet,used:new Set(),online:0,modbus:0,industrial:0,conflicts:0});
    const row=map.get(group.subnet);row.used.add(group.family===4?Number(String(h.ip).split('.')[3]):String(h.ip));
    if(h.state==='online'||h.alive)row.online++;if(h.modbus?.verified)row.modbus++;if(h.industrial)row.industrial++;if((h.macObservations||[]).length>1)row.conflicts++;
  }
  return[...map.values()].map(r=>({
    family:r.family,subnet:r.subnet,used:r.used.size,free:r.family===4?Math.max(0,254-r.used.size):null,
    online:r.online,modbus:r.modbus,industrial:r.industrial,conflicts:r.conflicts,
    usedHosts:r.family===4?[...r.used].sort((a,b)=>a-b):[],usedAddresses:r.family===6?[...r.used].sort().slice(0,1024):[]
  })).sort((a,b)=>a.subnet.localeCompare(b.subnet,undefined,{numeric:true}));
}
module.exports={subnet24,subnetGroup,buildLogicalTopology,addressUtilization};
