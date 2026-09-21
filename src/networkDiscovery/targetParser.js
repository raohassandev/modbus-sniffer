'use strict';

const net=require('node:net');

class TargetParseError extends Error{
  constructor(message,code='INVALID_TARGET',details={}){super(message);this.name='TargetParseError';this.code=code;Object.assign(this,details);}
}

function ipv4ToInt(ip){
  if(net.isIP(String(ip))!==4)throw new TargetParseError(`Invalid IPv4 address: ${ip}`);
  return String(ip).split('.').reduce((n,x)=>((n<<8)>>>0)+Number(x),0)>>>0;
}
function intToIpv4(n){
  const v=Number(n)>>>0;
  return [v>>>24,(v>>>16)&255,(v>>>8)&255,v&255].join('.');
}
function parseOctet(part){
  const text=String(part).trim();
  if(/^\d+$/.test(text)){
    const n=Number(text);if(n<0||n>255)throw new TargetParseError(`IPv4 octet must be 0..255: ${text}`);
    return [n,n];
  }
  const m=/^(\d+)-(\d+)$/.exec(text);
  if(!m)throw new TargetParseError(`Invalid IPv4 octet/range: ${text}`);
  const a=Number(m[1]),b=Number(m[2]);
  if(a<0||b>255||b<a)throw new TargetParseError(`Invalid IPv4 octet range: ${text}`);
  return [a,b];
}
function descriptorCount(d){
  if(d.kind==='compact')return d.octets.reduce((n,[a,b])=>n+(0),1)*d.octets.reduce((n,[a,b])=>n*(b-a+1),1);
  return Number(d.end-d.start+1);
}
function parseSingleTarget(input,{excludeNetworkBroadcast=true}={}){
  const raw=String(input||'').trim();
  if(!raw)throw new TargetParseError('Network target is required.');
  if(raw.includes('/')){
    const m=/^([^/]+)\/(\d{1,2})$/.exec(raw);
    if(!m||net.isIP(m[1])!==4)throw new TargetParseError(`Invalid IPv4 CIDR: ${raw}`);
    const prefix=Number(m[2]);if(prefix<0||prefix>32)throw new TargetParseError(`CIDR prefix must be 0..32: ${raw}`);
    const ip=ipv4ToInt(m[1]),mask=prefix===0?0:(0xFFFFFFFF<<(32-prefix))>>>0,network=(ip&mask)>>>0,broadcast=(network|(~mask>>>0))>>>0;
    let start=network,end=broadcast;
    if(excludeNetworkBroadcast&&prefix<=30){start=(network+1)>>>0;end=(broadcast-1)>>>0;}
    return {kind:'cidr',raw,prefix,network:intToIpv4(network),broadcast:intToIpv4(broadcast),start,end,count:end>=start?end-start+1:0};
  }
  if(net.isIP(raw)===4){
    const n=ipv4ToInt(raw);return{kind:'host',raw,start:n,end:n,count:1};
  }
  const dash=raw.indexOf('-');
  if(dash>0&&raw.includes('.',dash)){
    const left=raw.slice(0,dash),right=raw.slice(dash+1);
    if(net.isIP(left)===4&&net.isIP(right)===4){
      const start=ipv4ToInt(left),end=ipv4ToInt(right);
      if(end<start)throw new TargetParseError('Target range end must be greater than or equal to start.');
      return{kind:'range',raw,start,end,count:end-start+1};
    }
  }
  const parts=raw.split('.');
  if(parts.length===4&&parts.some(x=>x.includes('-'))){
    const octets=parts.map(parseOctet),count=octets.reduce((n,[a,b])=>n*(b-a+1),1);
    return{kind:'compact',raw,octets,count};
  }
  throw new TargetParseError(`Unsupported IPv4 target format: ${raw}`);
}
function splitTargets(value){
  if(Array.isArray(value))return value.flatMap(splitTargets);
  return String(value||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
}
function *iterateDescriptor(d){
  if(d.kind!=='compact'){for(let n=d.start;n<=d.end;n++){yield intToIpv4(n>>>0);if(n===0xFFFFFFFF)break;}return;}
  const [[a0,b0],[a1,b1],[a2,b2],[a3,b3]]=d.octets;
  for(let a=a0;a<=b0;a++)for(let b=a1;b<=b1;b++)for(let c=a2;c<=b2;c++)for(let e=a3;e<=b3;e++)yield `${a}.${b}.${c}.${e}`;
}
function privateIpv4(ip){
  const n=ipv4ToInt(ip),a=n>>>24,b=(n>>>16)&255;
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===127)||(a===169&&b===254);
}
function exclusionMatcher(descriptors){
  const compact=descriptors.filter(d=>d.kind==='compact');
  const ranges=descriptors.filter(d=>d.kind!=='compact');
  return ip=>{
    const n=ipv4ToInt(ip);
    if(ranges.some(d=>n>=d.start&&n<=d.end))return true;
    if(!compact.length)return false;
    const o=ip.split('.').map(Number);
    return compact.some(d=>d.octets.every(([a,b],i)=>o[i]>=a&&o[i]<=b));
  };
}
function parseTargets({targets,exclude=[],maxTargets=262144,hardMaxTargets=1000000,excludeNetworkBroadcast=true}={}){
  const rawTargets=splitTargets(targets);if(!rawTargets.length)throw new TargetParseError('At least one network target is required.');
  const descriptors=rawTargets.map(x=>parseSingleTarget(x,{excludeNetworkBroadcast}));
  const exclusionDescriptors=splitTargets(exclude).map(x=>parseSingleTarget(x,{excludeNetworkBroadcast:false}));
  const theoretical=descriptors.reduce((n,d)=>n+Number(d.count||descriptorCount(d)),0);
  const hard=Math.max(1,Math.min(10000000,Number(hardMaxTargets)||1000000));
  if(theoretical>hard)throw new TargetParseError(`Target expands to ${theoretical.toLocaleString()} addresses; hard safety limit is ${hard.toLocaleString()}.`,'TARGET_HARD_LIMIT',{theoretical,hardMaxTargets:hard});
  const limit=Math.max(1,Math.min(hard,Number(maxTargets)||262144));
  if(theoretical>limit)throw new TargetParseError(`Target expands to ${theoretical.toLocaleString()} addresses; current scan limit is ${limit.toLocaleString()}.`,'TARGET_LIMIT',{theoretical,maxTargets:limit});
  const excluded=exclusionMatcher(exclusionDescriptors);
  let count=0,publicCount=0,privateCount=0;
  const seen=new Set();
  for(const d of descriptors)for(const ip of iterateDescriptor(d)){
    if(excluded(ip)||seen.has(ip))continue;seen.add(ip);count++;if(privateIpv4(ip))privateCount++;else publicCount++;
  }
  return{
    version:1,descriptors,exclusions:exclusionDescriptors,count,theoreticalCount:theoretical,
    privateCount,publicCount,hasPublicTargets:publicCount>0,
    summary:descriptors.map(d=>({kind:d.kind,raw:d.raw,count:d.count})),
  };
}
function *iterateTargets(parsed){
  const excluded=exclusionMatcher(parsed.exclusions||[]),seen=new Set();
  for(const d of parsed.descriptors||[])for(const ip of iterateDescriptor(d)){
    if(excluded(ip)||seen.has(ip))continue;seen.add(ip);yield ip;
  }
}
function previewTargets(input={}){
  const parsed=parseTargets(input);
  const samples=[];for(const ip of iterateTargets(parsed)){samples.push(ip);if(samples.length>=8)break;}
  return{...parsed,descriptors:parsed.descriptors.map(d=>({...d,start:d.start==null?undefined:intToIpv4(d.start),end:d.end==null?undefined:intToIpv4(d.end)})),exclusions:parsed.exclusions.map(d=>({...d,start:d.start==null?undefined:intToIpv4(d.start),end:d.end==null?undefined:intToIpv4(d.end)})),samples};
}

module.exports={TargetParseError,ipv4ToInt,intToIpv4,parseSingleTarget,parseTargets,iterateTargets,previewTargets,privateIpv4};
