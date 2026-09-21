'use strict';

const os=require('node:os');
const net=require('node:net');

function prefixFromNetmask(mask){
  if(net.isIP(String(mask))!==4)return null;
  const bits=String(mask).split('.').map(Number).map(n=>n.toString(2).padStart(8,'0')).join('');
  if(!/^1*0*$/.test(bits))return null;
  return bits.indexOf('0')<0?32:bits.indexOf('0');
}
function networkAddress(address,netmask){
  if(net.isIP(String(address))!==4||net.isIP(String(netmask))!==4)return null;
  const a=address.split('.').map(Number),m=netmask.split('.').map(Number);
  return a.map((x,i)=>x&m[i]).join('.');
}
function listNetworkInterfaces({interfaces=os.networkInterfaces()}={}){
  const rows=[];
  for(const [name,entries] of Object.entries(interfaces||{})){
    for(const row of entries||[]){
      if(!row||row.internal)continue;
      const family=typeof row.family==='string'?row.family:(Number(row.family)===4?'IPv4':Number(row.family)===6?'IPv6':String(row.family||''));
      if(!['IPv4','IPv6'].includes(family))continue;
      const prefix=family==='IPv4'?prefixFromNetmask(row.netmask):Number.isInteger(row.cidr?Number(String(row.cidr).split('/')[1]):NaN)?Number(String(row.cidr).split('/')[1]):null;
      const cidr=row.cidr||(prefix!=null?`${row.address}/${prefix}`:null);
      const network=family==='IPv4'?networkAddress(row.address,row.netmask):null;
      rows.push({
        id:`${name}|${row.address}`,name,family,address:row.address,netmask:row.netmask||null,cidr,
        network,prefix,mac:row.mac||null,scopeid:row.scopeid??null,
        suggestedTarget:family==='IPv4'&&network&&prefix!=null?`${network}/${prefix}`:cidr
      });
    }
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.family.localeCompare(b.family)||a.address.localeCompare(b.address));
}

module.exports={listNetworkInterfaces,prefixFromNetmask,networkAddress};
