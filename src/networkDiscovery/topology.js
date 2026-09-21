'use strict';

const net=require('node:net');

function subnet24(ip){
  if(net.isIP(String(ip))!==4)return null;
  const p=String(ip).split('.');return `${p[0]}.${p[1]}.${p[2]}.0/24`;
}
function buildLogicalTopology(hosts=[]){
  const nodes=[],edges=[],subnets=new Map();
  for(const host of hosts){
    const ip=String(host.ip||'');if(net.isIP(ip)!==4)continue;
    const subnet=subnet24(ip);if(!subnets.has(subnet))subnets.set(subnet,{id:`subnet:${subnet}`,kind:'subnet',label:subnet,subnet,source:'address-membership',confidence:100});
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
  for(const h of hosts){const subnet=subnet24(h.ip);if(!subnet)continue;if(!map.has(subnet))map.set(subnet,{subnet,used:new Set(),online:0,modbus:0,industrial:0,conflicts:0});const row=map.get(subnet),last=Number(String(h.ip).split('.')[3]);row.used.add(last);if(h.state==='online'||h.alive)row.online++;if(h.modbus?.verified)row.modbus++;if(h.industrial)row.industrial++;if((h.macObservations||[]).length>1)row.conflicts++;}
  return[...map.values()].map(r=>({subnet:r.subnet,used:r.used.size,free:Math.max(0,254-r.used.size),online:r.online,modbus:r.modbus,industrial:r.industrial,conflicts:r.conflicts,usedHosts:[...r.used].sort((a,b)=>a-b)})).sort((a,b)=>a.subnet.localeCompare(b.subnet,undefined,{numeric:true}));
}
module.exports={subnet24,buildLogicalTopology,addressUtilization};
