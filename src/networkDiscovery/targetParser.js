'use strict';

const net=require('node:net');

class TargetParseError extends Error{
  constructor(message,code='INVALID_TARGET',details={}){super(message);this.name='TargetParseError';this.code=code;Object.assign(this,details);}
}

function ipv4ToInt(ip){
  if(net.isIP(String(ip))!==4)throw new TargetParseError(`Invalid IPv4 address: ${ip}`);
  return String(ip).split('.').reduce((n,x)=>((n<<8)>>>0)+Number(x),0)>>>0;
}
function intToIpv4(n){const v=Number(n)>>>0;return[v>>>24,(v>>>16)&255,(v>>>8)&255,v&255].join('.');}

function expandEmbeddedIpv4(raw){
  if(!raw.includes('.'))return raw;
  const i=raw.lastIndexOf(':');if(i<0)return raw;
  const v4=raw.slice(i+1);if(net.isIP(v4)!==4)return raw;
  const n=ipv4ToInt(v4),a=((n>>>16)&0xffff).toString(16),b=(n&0xffff).toString(16);
  return raw.slice(0,i+1)+a+':'+b;
}
function ipv6ToBigInt(ip){
  let raw=String(ip||'').trim().toLowerCase().replace(/^\[|\]$/g,'');const zone=raw.indexOf('%');if(zone>=0)raw=raw.slice(0,zone);
  raw=expandEmbeddedIpv4(raw);if(net.isIP(raw)!==6)throw new TargetParseError(`Invalid IPv6 address: ${ip}`);
  const halves=raw.split('::');if(halves.length>2)throw new TargetParseError(`Invalid IPv6 address: ${ip}`);
  const left=halves[0]?halves[0].split(':').filter(Boolean):[],right=halves.length===2&&halves[1]?halves[1].split(':').filter(Boolean):[];
  const missing=8-left.length-right.length;if(halves.length===1&&missing!==0||halves.length===2&&missing<1)throw new TargetParseError(`Invalid IPv6 address: ${ip}`);
  const groups=[...left,...Array(Math.max(0,missing)).fill('0'),...right];if(groups.length!==8)throw new TargetParseError(`Invalid IPv6 address: ${ip}`);
  let out=0n;for(const g of groups){const n=Number.parseInt(g||'0',16);if(!Number.isInteger(n)||n<0||n>0xffff)throw new TargetParseError(`Invalid IPv6 group: ${g}`);out=(out<<16n)|BigInt(n);}return out;
}
function bigIntToIpv6(value){
  let n=BigInt(value),parts=Array(8);for(let i=7;i>=0;i--){parts[i]=Number(n&0xffffn).toString(16);n>>=16n;}
  let bestStart=-1,bestLen=0;for(let i=0;i<8;){if(parts[i]!=='0'){i++;continue;}let j=i;while(j<8&&parts[j]==='0')j++;if(j-i>bestLen){bestStart=i;bestLen=j-i;}i=j;}
  if(bestLen<2)return parts.join(':');
  const left=parts.slice(0,bestStart).join(':'),right=parts.slice(bestStart+bestLen).join(':');return left&&right?`${left}::${right}`:left?`${left}::`:right?`::${right}`:'::';
}
function parseOctet(part){
  const text=String(part).trim();
  if(/^\d+$/.test(text)){const n=Number(text);if(n<0||n>255)throw new TargetParseError(`IPv4 octet must be 0..255: ${text}`);return[n,n];}
  const m=/^(\d+)-(\d+)$/.exec(text);if(!m)throw new TargetParseError(`Invalid IPv4 octet/range: ${text}`);
  const a=Number(m[1]),b=Number(m[2]);if(a<0||b>255||b<a)throw new TargetParseError(`Invalid IPv4 octet range: ${text}`);return[a,b];
}
function descriptorCountBig(d){
  if(d.kind==='compact')return BigInt(d.octets.reduce((n,[a,b])=>n*(b-a+1),1));
  return BigInt(d.end)-BigInt(d.start)+1n;
}
function parseSingleTarget(input,{excludeNetworkBroadcast=true}={}){
  const raw=String(input||'').trim();if(!raw)throw new TargetParseError('Network target is required.');
  if(raw.includes('/')){
    const m=/^(.+)\/(\d{1,3})$/.exec(raw);if(!m)throw new TargetParseError(`Invalid CIDR: ${raw}`);
    const family=net.isIP(m[1]),prefix=Number(m[2]);
    if(family===4){
      if(prefix<0||prefix>32)throw new TargetParseError(`IPv4 CIDR prefix must be 0..32: ${raw}`);
      const ip=ipv4ToInt(m[1]),mask=prefix===0?0:(0xFFFFFFFF<<(32-prefix))>>>0,network=(ip&mask)>>>0,broadcast=(network|(~mask>>>0))>>>0;let start=network,end=broadcast;
      if(excludeNetworkBroadcast&&prefix<=30){start=(network+1)>>>0;end=(broadcast-1)>>>0;}
      return{kind:'cidr',family:4,raw,prefix,network:intToIpv4(network),broadcast:intToIpv4(broadcast),start,end,count:Math.max(0,end-start+1)};
    }
    if(family===6){
      if(prefix<0||prefix>128)throw new TargetParseError(`IPv6 CIDR prefix must be 0..128: ${raw}`);
      const ip=ipv6ToBigInt(m[1]),all=(1n<<128n)-1n,hostBits=BigInt(128-prefix),mask=prefix===0?0n:(all<<hostBits)&all,network=ip&mask,end=network|(~mask&all),count=1n<<hostBits;
      return{kind:'cidr6',family:6,raw,prefix,network:bigIntToIpv6(network),start:network,end,count};
    }
    throw new TargetParseError(`Invalid CIDR address: ${raw}`);
  }
  const family=net.isIP(raw);
  if(family===4){const n=ipv4ToInt(raw);return{kind:'host',family:4,raw,start:n,end:n,count:1};}
  if(family===6){const n=ipv6ToBigInt(raw);return{kind:'host6',family:6,raw,start:n,end:n,count:1n};}
  const dash=raw.indexOf('-');
  if(dash>0&&raw.includes('.',dash)){
    const left=raw.slice(0,dash),right=raw.slice(dash+1);
    if(net.isIP(left)===4&&net.isIP(right)===4){const start=ipv4ToInt(left),end=ipv4ToInt(right);if(end<start)throw new TargetParseError('Target range end must be greater than or equal to start.');return{kind:'range',family:4,raw,start,end,count:end-start+1};}
  }
  const parts=raw.split('.');
  if(parts.length===4&&parts.some(x=>x.includes('-'))){const octets=parts.map(parseOctet),count=octets.reduce((n,[a,b])=>n*(b-a+1),1);return{kind:'compact',family:4,raw,octets,count};}
  throw new TargetParseError(`Unsupported IP target format: ${raw}`);
}
function splitTargets(value){if(Array.isArray(value))return value.flatMap(splitTargets);return String(value||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);}
function *iterateDescriptor(d){
  if(d.kind==='compact'){const[[a0,b0],[a1,b1],[a2,b2],[a3,b3]]=d.octets;for(let a=a0;a<=b0;a++)for(let b=a1;b<=b1;b++)for(let c=a2;c<=b2;c++)for(let e=a3;e<=b3;e++)yield`${a}.${b}.${c}.${e}`;return;}
  if(d.family===6){for(let n=BigInt(d.start);n<=BigInt(d.end);n++){yield bigIntToIpv6(n);if(n===((1n<<128n)-1n))break;}return;}
  for(let n=d.start;n<=d.end;n++){yield intToIpv4(n>>>0);if(n===0xFFFFFFFF)break;}
}
function privateIpv4(ip){const n=ipv4ToInt(ip),a=n>>>24,b=(n>>>16)&255;return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a===127||(a===169&&b===254);}
function privateIpv6(ip){const n=ipv6ToBigInt(ip);return n===1n||(n>>121n)===0x7en||(n>>118n)===0x3fan;}
function privateIp(ip){const f=net.isIP(String(ip));return f===4?privateIpv4(ip):f===6?privateIpv6(ip):false;}
function exclusionMatcher(descriptors){
  const compact=descriptors.filter(d=>d.kind==='compact'),v4=descriptors.filter(d=>d.family===4&&d.kind!=='compact'),v6=descriptors.filter(d=>d.family===6);
  return ip=>{
    const family=net.isIP(String(ip));
    if(family===4){const n=ipv4ToInt(ip);if(v4.some(d=>n>=d.start&&n<=d.end))return true;if(!compact.length)return false;const o=ip.split('.').map(Number);return compact.some(d=>d.octets.every(([a,b],i)=>o[i]>=a&&o[i]<=b));}
    if(family===6){const n=ipv6ToBigInt(ip);return v6.some(d=>n>=BigInt(d.start)&&n<=BigInt(d.end));}
    return false;
  };
}
function parseTargets({targets,exclude=[],maxTargets=262144,hardMaxTargets=1000000,excludeNetworkBroadcast=true}={}){
  const rawTargets=splitTargets(targets);if(!rawTargets.length)throw new TargetParseError('At least one network target is required.');
  const descriptors=rawTargets.map(x=>parseSingleTarget(x,{excludeNetworkBroadcast})),exclusionDescriptors=splitTargets(exclude).map(x=>parseSingleTarget(x,{excludeNetworkBroadcast:false}));
  const theoreticalBig=descriptors.reduce((n,d)=>n+descriptorCountBig(d),0n),hard=BigInt(Math.max(1,Math.min(10000000,Number(hardMaxTargets)||1000000))),limit=BigInt(Math.max(1,Math.min(Number(hard),Number(maxTargets)||262144)));
  if(theoreticalBig>hard)throw new TargetParseError(`Target expands to ${theoreticalBig.toString()} addresses; hard safety limit is ${hard.toString()}.`,'TARGET_HARD_LIMIT',{theoretical:Number(theoreticalBig>BigInt(Number.MAX_SAFE_INTEGER)?Number.MAX_SAFE_INTEGER:theoreticalBig),hardMaxTargets:Number(hard)});
  if(theoreticalBig>limit)throw new TargetParseError(`Target expands to ${theoreticalBig.toString()} addresses; current scan limit is ${limit.toString()}.`,'TARGET_LIMIT',{theoretical:Number(theoreticalBig),maxTargets:Number(limit)});
  const excluded=exclusionMatcher(exclusionDescriptors);let count=0,publicCount=0,privateCount=0;const seen=new Set();
  for(const d of descriptors)for(const ip of iterateDescriptor(d)){if(excluded(ip)||seen.has(ip))continue;seen.add(ip);count++;if(privateIp(ip))privateCount++;else publicCount++;}
  return{version:2,descriptors,exclusions:exclusionDescriptors,count,theoreticalCount:Number(theoreticalBig),privateCount,publicCount,hasPublicTargets:publicCount>0,summary:descriptors.map(d=>({kind:d.kind,family:d.family,raw:d.raw,count:Number(descriptorCountBig(d))}))};
}
function targetContains(parsed,ip){
  const family=net.isIP(String(ip));if(!family)return false;
  const excluded=exclusionMatcher(parsed.exclusions||[]);if(excluded(ip))return false;
  if(family===4){
    const n=ipv4ToInt(ip),o=String(ip).split('.').map(Number);
    return (parsed.descriptors||[]).some(d=>d.family===4&&(d.kind==='compact'?d.octets.every(([a,b],i)=>o[i]>=a&&o[i]<=b):(n>=d.start&&n<=d.end)));
  }
  const n=ipv6ToBigInt(ip);return (parsed.descriptors||[]).some(d=>d.family===6&&n>=BigInt(d.start)&&n<=BigInt(d.end));
}
function *iterateTargets(parsed){const excluded=exclusionMatcher(parsed.exclusions||[]),seen=new Set();for(const d of parsed.descriptors||[])for(const ip of iterateDescriptor(d)){if(excluded(ip)||seen.has(ip))continue;seen.add(ip);yield ip;}}
function displayDescriptor(d){
  const out={...d,count:Number(descriptorCountBig(d))};if(d.start!=null)out.start=d.family===6?bigIntToIpv6(d.start):intToIpv4(d.start);if(d.end!=null)out.end=d.family===6?bigIntToIpv6(d.end):intToIpv4(d.end);return out;
}
function previewTargets(input={}){const parsed=parseTargets(input),samples=[];for(const ip of iterateTargets(parsed)){samples.push(ip);if(samples.length>=8)break;}return{...parsed,descriptors:parsed.descriptors.map(displayDescriptor),exclusions:parsed.exclusions.map(displayDescriptor),samples};}

module.exports={TargetParseError,ipv4ToInt,intToIpv4,ipv6ToBigInt,bigIntToIpv6,parseSingleTarget,parseTargets,iterateTargets,targetContains,previewTargets,privateIpv4,privateIpv6,privateIp};
