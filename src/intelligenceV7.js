'use strict';

const crypto = require('crypto');
const { identificationFor } = require('./discoveryService');

const ORDERS32 = {
  ABCD:[0,1,2,3], BADC:[1,0,3,2], CDAB:[2,3,0,1], DCBA:[3,2,1,0]
};
const ORDERS64 = {
  ABCDEFGH:[0,1,2,3,4,5,6,7], BADCFEHG:[1,0,3,2,5,4,7,6],
  CDABGHEF:[2,3,0,1,6,7,4,5], EFGHABCD:[4,5,6,7,0,1,2,3],
  GHEFCDAB:[6,7,4,5,2,3,0,1], HGFEDCBA:[7,6,5,4,3,2,1,0]
};

function avg(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;}
function percentile(a,p){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=Math.min(s.length-1,Math.max(0,Math.ceil((p/100)*s.length)-1));return s[i];}
function median(a){return percentile(a,50);}
function stddev(a){if(a.length<2)return 0;const m=avg(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length);}
function round(v,d=2){if(v==null||!Number.isFinite(Number(v)))return v;const m=10**d;return Math.round(Number(v)*m)/m;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function numeric(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function unitOf(x){return Number(x?.unitId??x?.slaveId??x?.decoded?.unitId??x?.decoded?.slaveId);}
function keyOf(x){
  if(x?.deviceKey)return String(x.deviceKey);
  const channel=x?.channelId||x?.channel?.channelId||x?.decoded?.channelId||x?.decoded?.channel?.channelId||'legacy';
  const unit=unitOf(x);return Number.isFinite(unit)?`${channel}::${unit}`:null;
}
function transportOf(x){return String(x?.transport||x?.decoded?.transport||'RTU').toUpperCase()==='TCP'?'TCP':'RTU';}
function fcOf(x){return Number(x?.functionCode??x?.decoded?.functionCode);}
function requestShape(x={}){
  const d=x.decoded||x,fc=fcOf(x),deviceKey=keyOf(x),unitId=unitOf(x);
  let operation='command',startAddress=null,quantity=null,writeStartAddress=null,writeQuantity=null;
  if([1,2,3,4].includes(fc)){operation='read';startAddress=Number.isInteger(d.startAddress)?d.startAddress:null;quantity=Number.isInteger(d.quantity)?d.quantity:null;}
  else if([5,6,15,16,22].includes(fc)){operation='write';startAddress=Number.isInteger(d.startAddress)?d.startAddress:(Number.isInteger(d.address)?d.address:null);quantity=Number.isInteger(d.quantity)?d.quantity:1;}
  else if(fc===23){operation='read/write';startAddress=Number.isInteger(d.readStartAddress)?d.readStartAddress:null;quantity=Number.isInteger(d.readQuantity)?d.readQuantity:null;writeStartAddress=Number.isInteger(d.writeStartAddress)?d.writeStartAddress:null;writeQuantity=Number.isInteger(d.writeQuantity)?d.writeQuantity:null;}
  const local=[fc,operation,startAddress??'-',quantity??'-',writeStartAddress??'-',writeQuantity??'-'].join(':');
  return {deviceKey,unitId,transport:transportOf(x),channelId:x.channelId||d.channelId||null,functionCode:fc,operation,startAddress,quantity,writeStartAddress,writeQuantity,localKey:local,key:`${deviceKey}|${local}`};
}
function jaccard(a,b){const A=new Set(a),B=new Set(b);if(!A.size&&!B.size)return 1;let i=0;for(const x of A)if(B.has(x))i++;return i/(A.size+B.size-i||1);}
function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);}

function wordsToBytes(words){const out=[];for(const w0 of words){const w=Number(w0)&0xFFFF;out.push((w>>8)&255,w&255);}return out;}
function reorder(bytes,map){return Buffer.from(map.map(i=>bytes[i]));}
function decodeCandidate(words,type,order){
  try{
    if(type==='uint16')return Number(words[0])&0xFFFF;
    if(type==='int16'){const w=Number(words[0])&0xFFFF;return w&0x8000?w-0x10000:w;}
    const bytes=wordsToBytes(words);
    if(['uint32','int32','float32'].includes(type)){
      const b=reorder(bytes,ORDERS32[order]||ORDERS32.ABCD);
      if(type==='uint32')return b.readUInt32BE(0);if(type==='int32')return b.readInt32BE(0);return b.readFloatBE(0);
    }
    if(['uint64','int64','float64'].includes(type)){
      const b=reorder(bytes,ORDERS64[order]||ORDERS64.ABCDEFGH);
      if(type==='uint64')return b.readBigUInt64BE(0);if(type==='int64')return b.readBigInt64BE(0);return b.readDoubleBE(0);
    }
  }catch{}
  return null;
}
function safeNumericValue(v){if(typeof v==='bigint'){const n=Number(v);return Number.isSafeInteger(n)?n:null;}return Number.isFinite(Number(v))?Number(v):null;}
function candidateDefs(width){
  if(width===1)return[{type:'uint16',order:'AB'},{type:'int16',order:'AB'}];
  if(width===2)return Object.keys(ORDERS32).flatMap(order=>['uint32','int32','float32'].map(type=>({type,order})));
  if(width===4)return Object.keys(ORDERS64).flatMap(order=>['uint64','int64','float64'].map(type=>({type,order})));
  return[];
}
function scoreSeries(def,values,wordSamples){
  const usable=values.map(safeNumericValue).filter(Number.isFinite);if(!usable.length)return 0;
  let score=45;
  const finiteRatio=usable.length/values.length;score+=finiteRatio*20;
  const abs=usable.map(Math.abs),max=Math.max(...abs),med=Math.abs(median(usable)||0);
  if(def.type.includes('float')){
    if(max<=1e12&&usable.every(v=>Math.abs(v)>=1e-30||v===0))score+=18;else score-=25;
    const ints=usable.filter(Number.isInteger).length/usable.length;if(ints>0.95&&usable.length>=4)score-=7;
  }else{
    if(max<=1e12)score+=10;if(max<=65535&&def.type.includes('32'))score-=8;if(max<=65535&&def.type.includes('64'))score-=14;
  }
  if(usable.length>=3){const changes=usable.slice(1).filter((v,i)=>v!==usable[i]).length/(usable.length-1);if(changes>0&&changes<0.95)score+=5;if(changes===0)score-=2;}
  if(wordSamples.length>=4&&wordSamples[0].length>1){
    const upperZero=wordSamples.filter(w=>w.slice(0,-1).every(x=>(Number(x)&0xFFFF)===0)).length/wordSamples.length;if(upperZero>0.9&&!def.type.includes('16'))score-=10;
  }
  if(med>0&&max/med>1e12)score-=10;
  return clamp(Math.round(score),0,99);
}
function printableAscii(words){const bytes=wordsToBytes(words),chars=bytes.filter(b=>b===0||b===9||b===10||b===13||(b>=32&&b<=126));const text=Buffer.from(bytes).toString('latin1').replace(/\0+$/,'');return{ratio:bytes.length?chars.length/bytes.length:0,text};}
function monotonicStats(values){const v=values.map(numeric).filter(Number.isFinite);if(v.length<4)return null;let up=0,down=0,same=0;for(let i=1;i<v.length;i++){if(v[i]>v[i-1])up++;else if(v[i]<v[i-1])down++;else same++;}const steps=v.length-1;return{up:up/steps,down:down/steps,same:same/steps,resets:down,changes:(up+down)/steps};}
function plausibleEpoch(n){if(!Number.isFinite(n))return null;for(const unit of ['seconds','milliseconds']){const ms=unit==='seconds'?n*1000:n;const y=new Date(ms).getUTCFullYear();if(y>=2010&&y<=2040)return{unit,iso:new Date(ms).toISOString()};}return null;}

function buildSnapshotIndex(state){
  const map=new Map();
  for(const t of state.transactions||[]){
    if(t.direction!=='RSP')continue;const regs=t.decoded?.registers;if(!Array.isArray(regs)||!regs.length)continue;
    const dk=keyOf(t),fc=fcOf(t);if(!dk||!Number.isFinite(fc))continue;const k=`${dk}|${fc}`;if(!map.has(k))map.set(k,[]);
    const values=new Map();for(const r of regs)if(Number.isInteger(Number(r.address)))values.set(Number(r.address),Number(r.value)&0xFFFF);
    map.get(k).push({timestamp:Number(t.timestamp)||0,values});
  }
  for(const list of map.values())if(list.length>80)list.splice(0,list.length-80);
  return map;
}
function getWindowSamples(index,deviceKey,fc,start,width){const list=index.get(`${deviceKey}|${fc}`)||[],out=[];for(const snap of list){const words=[];let ok=true;for(let i=0;i<width;i++){if(!snap.values.has(start+i)){ok=false;break;}words.push(snap.values.get(start+i));}if(ok)out.push({timestamp:snap.timestamp,words});}return out;}

function analyzeRegisterIntelligence(state,filters={}){
  const maxRows=Math.max(1,Math.min(2000,Number(filters.limit)||400)),deviceFilter=filters.deviceKey?String(filters.deviceKey):null,fcFilter=filters.fc==null||filters.fc===''?null:Number(filters.fc),channelFilter=filters.channelId?String(filters.channelId):null;
  const regs=[...(state.registers?.values?.()||[])].filter(r=>!deviceFilter||r.deviceKey===deviceFilter).filter(r=>!channelFilter||r.channelId===channelFilter).filter(r=>!Number.isFinite(fcFilter)||Number(r.functionCode)===fcFilter);
  const groups=new Map();for(const r of regs){const k=`${r.deviceKey}|${r.functionCode}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}for(const g of groups.values())g.sort((a,b)=>a.address-b.address);
  const snapshots=buildSnapshotIndex(state),rows=[];
  for(const g of groups.values()){
    const byAddr=new Map(g.map(r=>[Number(r.address),r]));
    for(const r of g){
      const start=Number(r.address),candidates=[],behaviors=[];
      for(const width of [1,2,4]){
        const contiguous=Array.from({length:width},(_,i)=>byAddr.get(start+i));if(contiguous.some(x=>!x))continue;
        let samples=getWindowSamples(snapshots,r.deviceKey,Number(r.functionCode),start,width);if(!samples.length)samples=[{timestamp:r.lastSeen||Date.now(),words:contiguous.map(x=>Number(x.lastValue)&0xFFFF)}];
        const wordSamples=samples.map(s=>s.words);
        for(const def of candidateDefs(width)){
          const decoded=wordSamples.map(w=>decodeCandidate(w,def.type,def.order));const confidence=scoreSeries(def,decoded,wordSamples),latest=decoded.at(-1);
          candidates.push({type:def.type,byteOrder:def.order,widthWords:width,value:typeof latest==='bigint'?latest.toString():latest,confidence,samples:decoded.length});
        }
        if(width>=2){const ascii=printableAscii(wordSamples.at(-1));if(ascii.ratio>=0.85&&/[A-Za-z0-9]/.test(ascii.text))candidates.push({type:'ascii',byteOrder:'AB',widthWords:width,value:ascii.text,confidence:clamp(Math.round(60+ascii.ratio*35),0,98),samples:wordSamples.length});}
      }
      const hist=(r.history||[]).map(x=>Number(x.value)).filter(Number.isFinite),mono=monotonicStats(hist);
      if(mono&&mono.changes>0){if(mono.up>=0.9)behaviors.push({kind:'counter',confidence:clamp(Math.round(70+mono.up*25),0,98),detail:'Value is predominantly monotonic increasing.'});if(mono.up>=0.7&&mono.resets>0)behaviors.push({kind:'resetting-counter',confidence:80,detail:`Mostly increasing with ${mono.resets} downward reset(s).`});}
      if(hist.length>=4){const distinct=new Set(hist).size,max=Math.max(...hist.map(Math.abs));if(distinct<=16&&max<=65535)behaviors.push({kind:'status/bitfield',confidence:clamp(82-distinct,55,82),detail:`Only ${distinct} distinct raw value(s) observed.`});}
      for(const c of candidates.slice().sort((a,b)=>b.confidence-a.confidence).slice(0,8)){const ep=plausibleEpoch(safeNumericValue(c.value));if(ep){behaviors.push({kind:'timestamp',confidence:92,detail:`${c.type} ${c.byteOrder} decodes to ${ep.iso} (${ep.unit}).`,candidate:{type:c.type,byteOrder:c.byteOrder,widthWords:c.widthWords}});break;}}
      candidates.sort((a,b)=>b.confidence-a.confidence||a.widthWords-b.widthWords||a.type.localeCompare(b.type));
      const top=candidates[0]||null;rows.push({deviceKey:r.deviceKey,channelId:r.channelId,transport:r.transport,unitId:r.unitId??r.slaveId,functionCode:Number(r.functionCode),address:start,lastValue:r.lastValue,lastHex:r.lastHex,sampleCount:Math.max(hist.length,top?.samples||0),topCandidate:top,candidates:candidates.slice(0,6),behaviors:behaviors.sort((a,b)=>b.confidence-a.confidence)});
      if(rows.length>=maxRows)break;
    }
    if(rows.length>=maxRows)break;
  }
  const highConfidence=rows.filter(r=>Number(r.topCandidate?.confidence)>=85).length,semantic=rows.filter(r=>r.behaviors.length).length;
  return{generatedAt:Date.now(),rows,summary:{rows:rows.length,highConfidence,semantic,devices:new Set(rows.map(r=>r.deviceKey)).size}};
}

function detectPeriod(sequence){
  const n=sequence.length;if(n<6)return null;const max=Math.min(160,Math.floor(n/3));let best=null;
  for(let p=1;p<=max;p++){
    const span=Math.min(n-p,p*4),start=n-p-span;let same=0,total=0;
    for(let i=Math.max(0,start);i<n-p;i++){total++;if(sequence[i]===sequence[i+p])same++;}
    if(total<Math.min(6,p*2))continue;const ratio=same/total,distinct=new Set(sequence.slice(Math.max(0,n-p),n)).size;
    if(ratio<0.72)continue;const score=ratio*100+Math.min(10,distinct*1.5)-Math.log2(p+1);
    if(!best||score>best.score||(Math.abs(score-best.score)<0.5&&p<best.period))best={period:p,matchRatio:ratio,score,distinct};
  }
  return best;
}
function reconstructPollingCycle(state,filters={}){
  const all=(state.transactions||[]).filter(t=>t.direction==='REQ'),channelFilter=filters.channelId?String(filters.channelId):null,deviceFilter=filters.deviceKey?String(filters.deviceKey):null;
  const byChannel=new Map();
  for(const t of all){if(channelFilter&&t.channelId!==channelFilter)continue;if(deviceFilter&&keyOf(t)!==deviceFilter)continue;const c=String(t.channelId||'legacy');if(!byChannel.has(c))byChannel.set(c,[]);byChannel.get(c).push(t);}
  const cycles=[];
  for(const [channelId,list0] of byChannel){const list=[...list0].sort((a,b)=>a.timestamp-b.timestamp).slice(-4000);if(list.length<2)continue;const shapes=list.map(requestShape),seq=shapes.map(s=>s.key),det=detectPeriod(seq);let period=det?.period||null,confidence=det?round(det.matchRatio*100,1):null;
    if(!period){const counts=new Map();for(const k of seq)counts.set(k,(counts.get(k)||0)+1);const anchor=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0],idx=[];seq.forEach((k,i)=>{if(k===anchor)idx.push(i);});if(idx.length>=3){const spans=idx.slice(1).map((v,i)=>v-idx[i]).filter(v=>v>0);period=Math.round(median(spans));confidence=50;}}
    const sequence=[],cycleTimes=[];let mismatchSlots=0,observations=0;
    if(period&&period>0&&list.length>=period*2){const complete=Math.min(8,Math.floor(list.length/period)),baseStart=list.length-period,base=shapes.slice(baseStart);for(let pos=0;pos<period;pos++){const observed=[],gaps=[];for(let c=0;c<complete;c++){const i=list.length-period*(c+1)+pos;if(i<0)continue;observed.push(shapes[i]?.key);if(pos>0){const prev=i-1;if(prev>=0)gaps.push(Number(list[i].timestamp)-Number(list[prev].timestamp));}}const counts=new Map();for(const k of observed)counts.set(k,(counts.get(k)||0)+1);const [modeKey,modeCount]=[...counts].sort((a,b)=>b[1]-a[1])[0]||[base[pos]?.key,0];observations+=observed.length;mismatchSlots+=observed.length-modeCount;const s=base[pos]||shapes.find(x=>x.key===modeKey);sequence.push({position:pos+1,deviceKey:s?.deviceKey,unitId:s?.unitId,functionCode:s?.functionCode,operation:s?.operation,startAddress:s?.startAddress,quantity:s?.quantity,signature:s?.localKey,slotConfidence:observed.length?round(modeCount/observed.length*100,1):null,medianGapFromPreviousMs:pos?round(median(gaps)):0});}
      for(let c=complete-1;c>0;c--){const a=list.length-period*(c+1),b=a+period;if(a>=0&&b<list.length)cycleTimes.push(Number(list[b].timestamp)-Number(list[a].timestamp));}
    }
    const devices=new Set(sequence.map(x=>x.deviceKey).filter(Boolean));cycles.push({channelId,transport:list[0]?.transport||'RTU',requestCount:list.length,detected:Boolean(period),requestsPerCycle:period,deviceCount:devices.size,confidence,sequenceConfidence:observations?round((1-mismatchSlots/observations)*100,1):confidence,medianCycleMs:round(median(cycleTimes)),p95CycleMs:round(percentile(cycleTimes,95)),jitterMs:round(stddev(cycleTimes)),cycleSamples:cycleTimes.length,sequence});}
  return{generatedAt:Date.now(),channels:cycles,summary:{channels:cycles.length,detected:cycles.filter(c=>c.detected).length,requestsPerCycle:cycles.reduce((s,c)=>s+(c.requestsPerCycle||0),0)}};
}

function blockFeature(b){return`${Number(b.functionCode)}:${b.operation||'-'}:${b.startAddress??'-'}:${b.endAddress??'-'}:${b.quantity??'-'}`;}
function pollFeature(p){return`${Number(p.functionCode)}:${p.operation||'-'}:${p.startAddress??'-'}:${p.quantity??'-'}:${p.writeStartAddress??'-'}:${p.writeQuantity??'-'}`;}
function buildDeviceFingerprints(state,filters={}){
  const devices=(state.getDevices?.(filters)||[]),polls=state.getPollGroups?.(filters)||[],regs=state.getRegisters?.({...filters,limit:50000})||[],txs=state.getTransactions?.({limit:50000})||state.transactions||[],rows=[];
  for(const d of devices){const dk=d.deviceKey,dp=polls.filter(p=>p.deviceKey===dk),dr=regs.filter(r=>r.deviceKey===dk),identity=identificationFor(dk,txs),ranges=[];const byFc=new Map();for(const r of dr){const fc=Number(r.functionCode);if(!byFc.has(fc))byFc.set(fc,[]);byFc.get(fc).push(Number(r.address));}for(const [fc,a0] of byFc){const a=[...new Set(a0)].sort((x,y)=>x-y);let st=null,pr=null;for(const x of a){if(st==null){st=pr=x;continue;}if(x===pr+1){pr=x;continue;}ranges.push({functionCode:fc,startAddress:st,endAddress:pr,quantity:pr-st+1,operation:'observed'});st=pr=x;}if(st!=null)ranges.push({functionCode:fc,startAddress:st,endAddress:pr,quantity:pr-st+1,operation:'observed'});}
    const features={functions:[...new Set([...(d.functions||[]),...dp.map(p=>Number(p.functionCode))])].sort((a,b)=>a-b),polls:[...new Set(dp.map(pollFeature))].sort(),blocks:[...new Set((dp.length?dp:ranges).map(blockFeature))].sort(),identity:{vendor:String(identity.vendorName||'').trim().toLowerCase(),product:String(identity.productCode||identity.productName||'').trim().toLowerCase(),model:String(identity.modelName||'').trim().toLowerCase(),revision:String(identity.revision||'').trim().toLowerCase()}};
    const fingerprint=hash(features);rows.push({deviceKey:dk,channelId:d.channelId,transport:d.transport,unitId:d.unitId??d.slaveId,fingerprint,features,identity,matches:[]});}
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j],ia=a.features.identity,ib=b.features.identity;let score=jaccard(a.features.blocks,b.features.blocks)*0.42+jaccard(a.features.polls,b.features.polls)*0.28+jaccard(a.features.functions,b.features.functions)*0.15;let idScore=0;if(ia.vendor&&ia.vendor===ib.vendor)idScore+=0.05;if(ia.product&&ia.product===ib.product)idScore+=0.06;if(ia.model&&ia.model===ib.model)idScore+=0.06;if(ia.revision&&ia.revision===ib.revision)idScore+=0.03;score=clamp(score+idScore,0,1);const pct=Math.round(score*100);if(pct>=55){a.matches.push({deviceKey:b.deviceKey,unitId:b.unitId,score:pct,sameProfileSuggested:pct>=82});b.matches.push({deviceKey:a.deviceKey,unitId:a.unitId,score:pct,sameProfileSuggested:pct>=82});}}
  for(const r of rows)r.matches.sort((a,b)=>b.score-a.score);
  const clusters=[],used=new Set();for(const r of rows){if(used.has(r.deviceKey))continue;const members=[r.deviceKey,...r.matches.filter(m=>m.score>=82).map(m=>m.deviceKey)].filter((v,i,a)=>a.indexOf(v)===i);members.forEach(x=>used.add(x));if(members.length>1)clusters.push({clusterId:hash(members.sort()),members,confidence:Math.min(...members.slice(1).map(x=>r.matches.find(m=>m.deviceKey===x)?.score||82))});}
  return{generatedAt:Date.now(),devices:rows,clusters,summary:{devices:rows.length,clusters:clusters.length,profileSuggestions:rows.reduce((s,r)=>s+r.matches.filter(m=>m.sameProfileSuggested).length,0)/2}};
}

function pearson(a,b){const n=Math.min(a.length,b.length);if(n<4)return null;const A=a.slice(0,n),B=b.slice(0,n),ma=avg(A),mb=avg(B);let num=0,da=0,db=0;for(let i=0;i<n;i++){const x=A[i]-ma,y=B[i]-mb;num+=x*y;da+=x*x;db+=y*y;}return da&&db?num/Math.sqrt(da*db):null;}
function alignedSeries(snapshots,address){const out=[];for(const s of snapshots)if(s.values.has(address))out.push({timestamp:s.timestamp,value:Number(s.values.get(address))});return out;}
function commonValues(snapshots,addresses){const out=[];for(const s of snapshots){const row=[];let ok=true;for(const a of addresses){if(!s.values.has(a)){ok=false;break;}row.push(Number(s.values.get(a)));}if(ok)out.push(row);}return out;}
function analyzeRelationships(state,filters={}){
  const index=buildSnapshotIndex(state),out=[],deviceFilter=filters.deviceKey?String(filters.deviceKey):null,max=Math.max(10,Math.min(500,Number(filters.limit)||150));
  for(const [groupKey,snaps0] of index){const sep=groupKey.lastIndexOf('|'),dk=groupKey.slice(0,sep),fc=Number(groupKey.slice(sep+1));if(deviceFilter&&dk!==deviceFilter)continue;const snaps=snaps0.slice(-60);if(snaps.length<4)continue;const addresses=[...new Set(snaps.flatMap(s=>[...s.values.keys()]))].sort((a,b)=>a-b).slice(0,80),series=new Map(addresses.map(a=>[a,alignedSeries(snaps,a).map(x=>x.value)]));
    for(let i=0;i<addresses.length&&out.length<max;i++)for(let j=i+1;j<Math.min(addresses.length,i+16)&&out.length<max;j++){const a=addresses[i],b=addresses[j],pairs=commonValues(snaps,[a,b]);if(pairs.length<6)continue;const A=pairs.map(x=>x[0]),B=pairs.map(x=>x[1]);const exact=pairs.filter(x=>x[0]===x[1]).length/pairs.length;if(exact>=0.95&&new Set(A).size>1){out.push({kind:'duplicate',confidence:Math.round(exact*100),deviceKey:dk,functionCode:fc,addresses:[a,b],detail:`Registers ${a} and ${b} match in ${Math.round(exact*100)}% of aligned samples.`});continue;}const r=pearson(A,B);if(r!=null&&Math.abs(r)>=0.985&&new Set(A).size>3&&new Set(B).size>3)out.push({kind:'correlation',confidence:Math.round(Math.abs(r)*100),deviceKey:dk,functionCode:fc,addresses:[a,b],coefficient:round(r,4),detail:`Strong ${r>0?'positive':'inverse'} correlation (r=${round(r,3)}).`});}
    for(let i=0;i+2<addresses.length&&out.length<max;i++){const a=addresses[i],b=addresses[i+1],c=addresses[i+2];if(b!==a+1||c!==b+1)continue;const rows=commonValues(snaps,[a,b,c]).filter(x=>x[0]!==0&&x[1]!==0);if(rows.length<6)continue;const k=rows.map(x=>x[2]/(x[0]*x[1])).filter(Number.isFinite);const km=median(k),cv=km?Math.abs(stddev(k)/km):Infinity;if(k.length>=6&&cv<0.05)out.push({kind:'multiplicative',confidence:clamp(Math.round(98-cv*300),70,98),deviceKey:dk,functionCode:fc,addresses:[a,b,c],scaleFactor:round(km,8),detail:`Register ${c} ≈ ${a} × ${b} × ${round(km,6)}.`});}
    for(let i=0;i+3<addresses.length&&out.length<max;i++){const block=addresses.slice(i,i+4);if(!block.every((x,j)=>j===0||x===block[j-1]+1))continue;const rows=commonValues(snaps,block);if(rows.length<6)continue;for(let target=0;target<4;target++){const errs=[];for(const row of rows){const total=row[target],sum=row.reduce((s,v,j)=>j===target?s:s+v,0),den=Math.max(1,Math.abs(total),Math.abs(sum));errs.push(Math.abs(total-sum)/den);}const err=median(errs);if(err<0.04){out.push({kind:'sum-total',confidence:clamp(Math.round(98-err*400),75,98),deviceKey:dk,functionCode:fc,addresses:block,totalAddress:block[target],componentAddresses:block.filter((_,j)=>j!==target),medianErrorPct:round(err*100,2),detail:`Register ${block[target]} closely tracks the sum of ${block.filter((_,j)=>j!==target).join(', ')}.`});break;}}}
    for(const a of addresses){const vals=series.get(a)||[],m=monotonicStats(vals);if(m&&m.changes>0&&m.up>=0.9)out.push({kind:'counter',confidence:clamp(Math.round(70+m.up*25),0,98),deviceKey:dk,functionCode:fc,addresses:[a],detail:`Register ${a} is predominantly monotonic increasing.`});else if(m&&m.up>=0.65&&m.resets>0)out.push({kind:'resetting-counter',confidence:78,deviceKey:dk,functionCode:fc,addresses:[a],detail:`Register ${a} behaves like a counter with ${m.resets} reset/drop event(s).`});if(out.length>=max)break;}
  }
  const rank={duplicate:5,'sum-total':5,multiplicative:4,counter:3,'resetting-counter':3,correlation:2};out.sort((a,b)=>b.confidence-a.confidence||(rank[b.kind]||0)-(rank[a.kind]||0));return{generatedAt:Date.now(),relationships:out.slice(0,max),summary:{count:Math.min(out.length,max),devices:new Set(out.map(x=>x.deviceKey)).size,kinds:Object.fromEntries([...new Set(out.map(x=>x.kind))].map(k=>[k,out.filter(x=>x.kind===k).length]))}};
}

function detectAnomalies(state,filters={}){
  const now=Date.now(),events=[],devices=state.getDevices?.(filters)||[],polls=state.getPollGroups?.(filters)||[],txs=(state.transactions||[]).slice(-10000),severityRank={critical:4,bad:3,warn:2,info:1};
  for(const d of devices){if(d.status==='offline'||d.status==='silent')events.push({key:`device-${d.status}-${d.deviceKey}`,type:'device-status',severity:d.status==='offline'?'bad':'warn',timestamp:d.lastResponseAt||d.lastSeen,title:`${d.transport==='TCP'?'Unit':'Slave'} ${d.unitId??d.slaveId} ${d.status}`,detail:`Last confirmed response ${d.lastResponseAt?Math.round((now-d.lastResponseAt)/1000)+' s ago':'not observed'}.`,deviceKey:d.deviceKey});if(Number(d.timeoutRate)>2)events.push({key:`timeout-${d.deviceKey}`,type:'missing-response',severity:Number(d.timeoutRate)>10?'bad':'warn',timestamp:d.lastTimeoutAt||d.lastSeen,title:'Missing responses',detail:`${d.timeouts} timeout(s), ${d.timeoutRate}% of requests.`,deviceKey:d.deviceKey});}
  for(const p of polls){if(Number(p.jitterPct)>35&&Number(p.requests)>=6)events.push({key:`jitter-${p.key}`,type:'poll-jitter',severity:Number(p.jitterPct)>75?'bad':'warn',timestamp:p.lastRequestAt,title:'Polling jitter',detail:`FC${p.functionCode} ${p.startAddress??'-'} jitter is ${p.jitterPct}% (median ${p.medianIntervalMs} ms).`,deviceKey:p.deviceKey,pollKey:p.key});const raw=state.pollPatterns?.get?.(p.key);const ints=raw?.intervals||[];if(ints.length>=10){const half=Math.floor(ints.length/2),old=median(ints.slice(0,half)),recent=median(ints.slice(-Math.min(half,10)));if(old&&recent&&Math.abs(recent-old)/old>0.25)events.push({key:`poll-drift-${p.key}`,type:'poll-interval-change',severity:'warn',timestamp:p.lastRequestAt,title:'Poll interval changed',detail:`FC${p.functionCode} ${p.startAddress??'-'} changed from about ${round(old)} ms to ${round(recent)} ms.`,deviceKey:p.deviceKey,pollKey:p.key});}}
  const writes=txs.filter(t=>t.direction==='REQ'&&([5,6,15,16,22,23].includes(fcOf(t))));for(const t of writes.slice(-20))events.push({key:`write-${t.id}`,type:'write-observed',severity:'info',timestamp:t.timestamp,title:'Write traffic observed',detail:`FC${fcOf(t)} write/command to Unit ${unitOf(t)}${t.decoded?.startAddress!=null?` at ${t.decoded.startAddress}`:t.decoded?.address!=null?` at ${t.decoded.address}`:''}.`,deviceKey:keyOf(t),transactionId:t.id});
  const byDevice=new Map();for(const t of txs)if(t.direction==='RSP'&&Number.isFinite(Number(t.rttMs))){const k=keyOf(t);if(!byDevice.has(k))byDevice.set(k,[]);byDevice.get(k).push({ts:t.timestamp,rtt:Number(t.rttMs),unitId:unitOf(t)});}for(const [dk,list] of byDevice){if(list.length<12)continue;const recent=list.slice(-5).map(x=>x.rtt),base=list.slice(0,-5).slice(-20).map(x=>x.rtt),a=median(base),b=median(recent);if(a!=null&&b!=null&&b>a*1.6&&b-a>20)events.push({key:`rtt-shift-${dk}`,type:'rtt-shift',severity:b>500?'bad':'warn',timestamp:list.at(-1).ts,title:'Response time increased',detail:`Median RTT shifted from ${round(a)} ms to ${round(b)} ms.`,deviceKey:dk});}
  const buckets=[...(state.timeline?.values?.()||[])].sort((a,b)=>a.timestamp-b.timestamp);if(buckets.length>=20){const recent=buckets.slice(-10),prior=buckets.slice(-20,-10),r=recent.reduce((s,x)=>s+Number(x.noiseBytes||0),0),p=prior.reduce((s,x)=>s+Number(x.noiseBytes||0),0);if(r>=20&&r>Math.max(10,p*2))events.push({key:'noise-rise',type:'line-noise-rise',severity:r>100?'bad':'warn',timestamp:recent.at(-1).timestamp,title:'Line noise increased',detail:`Recent undecodable bytes ${r}, previous window ${p}.`});}
  for(const d of devices)events.push({key:`discover-${d.deviceKey}`,type:'device-discovered',severity:'info',timestamp:d.firstSeen,title:`Device discovered: ${d.transport==='TCP'?'Unit':'Slave'} ${d.unitId??d.slaveId}`,detail:`First observed on ${d.channelName||d.channelId||'channel'}.`,deviceKey:d.deviceKey});
  events.sort((a,b)=>(severityRank[b.severity]||0)-(severityRank[a.severity]||0)||Number(b.timestamp||0)-Number(a.timestamp||0));const limit=Math.max(1,Math.min(500,Number(filters.limit)||120));return{generatedAt:now,events:events.slice(0,limit),summary:{total:events.length,critical:events.filter(e=>e.severity==='critical').length,bad:events.filter(e=>e.severity==='bad').length,warn:events.filter(e=>e.severity==='warn').length,info:events.filter(e=>e.severity==='info').length}};
}

function captureSummary(capture={}){
  const devices=new Map(),polls=new Map(),registers=new Map();
  for(const t of capture.transactions||[]){const dk=keyOf(t)||`${transportOf(t)}:${unitOf(t)}`,fc=fcOf(t);if(!dk||!Number.isFinite(fc))continue;if(!devices.has(dk))devices.set(dk,{deviceKey:dk,transport:transportOf(t),unitId:unitOf(t),requests:0,responses:0,timeouts:0,exceptions:0,rtts:[],functions:new Set(),polls:new Map(),registers:new Set()});const d=devices.get(dk);d.functions.add(fc);if(t.direction==='REQ'){d.requests++;const s=requestShape(t),k=s.localKey,p=d.polls.get(k)||{...s,count:0,lastAt:null,intervals:[]};if(p.lastAt!=null&&Number(t.timestamp)>p.lastAt)p.intervals.push(Number(t.timestamp)-p.lastAt);p.count++;p.lastAt=Number(t.timestamp);d.polls.set(k,p);polls.set(`${dk}|${k}`,p);}else if(t.direction==='RSP'){d.responses++;if(t.exception)d.exceptions++;if(Number.isFinite(Number(t.rttMs)))d.rtts.push(Number(t.rttMs));const rr=t.decoded?.registers||[];for(const r of rr){const rk=`${fc}:${Number(r.address)}`;d.registers.add(rk);registers.set(`${dk}|${rk}`,true);}}else if(t.direction==='TIMEOUT'||t.timeout)d.timeouts++;}
  const rows=[...devices.values()].map(d=>({deviceKey:d.deviceKey,transport:d.transport,unitId:d.unitId,requests:d.requests,responses:d.responses,timeouts:d.timeouts,exceptions:d.exceptions,avgRttMs:round(avg(d.rtts)),p95RttMs:round(percentile(d.rtts,95)),functions:[...d.functions].sort((a,b)=>a-b),polls:[...d.polls.values()].map(p=>({key:p.localKey,functionCode:p.functionCode,startAddress:p.startAddress,quantity:p.quantity,medianIntervalMs:round(median(p.intervals)),count:p.count})),registers:[...d.registers].sort()}));return{devices:rows,deviceMap:new Map(rows.map(d=>[d.deviceKey,d]))};
}
function compareCaptures(before,after,options={}){
  const A=captureSummary(before),B=captureSummary(after),keysA=new Set(A.devices.map(d=>d.deviceKey)),keysB=new Set(B.devices.map(d=>d.deviceKey)),added=[...keysB].filter(k=>!keysA.has(k)),removed=[...keysA].filter(k=>!keysB.has(k)),changed=[],findings=[];
  for(const k of added)findings.push({severity:'info',type:'device-added',deviceKey:k,title:'Device added',detail:`${k} appears only in the second capture.`});for(const k of removed)findings.push({severity:'warn',type:'device-removed',deviceKey:k,title:'Device removed',detail:`${k} is missing from the second capture.`});
  for(const k of [...keysA].filter(x=>keysB.has(x))){const a=A.deviceMap.get(k),b=B.deviceMap.get(k),row={deviceKey:k,unitId:b.unitId,changes:[]};const ra=new Set(a.registers),rb=new Set(b.registers),regAdded=[...rb].filter(x=>!ra.has(x)),regRemoved=[...ra].filter(x=>!rb.has(x));if(regAdded.length||regRemoved.length)row.changes.push({kind:'register-map',added:regAdded,removed:regRemoved});const pa=new Map(a.polls.map(p=>[p.key,p])),pb=new Map(b.polls.map(p=>[p.key,p]));for(const [pk,q] of pb){const p=pa.get(pk);if(!p){row.changes.push({kind:'poll-added',poll:q});continue;}if(p.medianIntervalMs&&q.medianIntervalMs){const delta=(q.medianIntervalMs-p.medianIntervalMs)/p.medianIntervalMs*100;if(Math.abs(delta)>=15)row.changes.push({kind:'poll-interval',pollKey:pk,beforeMs:p.medianIntervalMs,afterMs:q.medianIntervalMs,deltaPct:round(delta,1)});}}for(const [pk,p] of pa)if(!pb.has(pk))row.changes.push({kind:'poll-removed',poll:p});if(a.p95RttMs&&b.p95RttMs){const delta=b.p95RttMs-a.p95RttMs;if(Math.abs(delta)>=20)row.changes.push({kind:'rtt',beforeP95Ms:a.p95RttMs,afterP95Ms:b.p95RttMs,deltaMs:round(delta)});}if(b.timeouts>a.timeouts)row.changes.push({kind:'timeouts',before:a.timeouts,after:b.timeouts,delta:b.timeouts-a.timeouts});if(b.exceptions>a.exceptions)row.changes.push({kind:'exceptions',before:a.exceptions,after:b.exceptions,delta:b.exceptions-a.exceptions});if(row.changes.length){changed.push(row);for(const c of row.changes){if(c.kind==='poll-interval')findings.push({severity:Math.abs(c.deltaPct)>50?'warn':'info',type:'poll-interval-change',deviceKey:k,title:'Polling interval changed',detail:`${c.pollKey}: ${c.beforeMs} → ${c.afterMs} ms (${c.deltaPct}%).`});if(c.kind==='rtt'&&c.deltaMs>0)findings.push({severity:c.deltaMs>200?'warn':'info',type:'rtt-change',deviceKey:k,title:'P95 RTT increased',detail:`${c.beforeP95Ms} → ${c.afterP95Ms} ms.`});if(c.kind==='timeouts')findings.push({severity:'warn',type:'timeouts-increased',deviceKey:k,title:'Timeouts increased',detail:`${c.before} → ${c.after}.`});}}
  }
  const rank={warn:2,info:1};findings.sort((a,b)=>(rank[b.severity]||0)-(rank[a.severity]||0));return{generatedAt:Date.now(),summary:{beforeDevices:A.devices.length,afterDevices:B.devices.length,addedDevices:added.length,removedDevices:removed.length,changedDevices:changed.length,findings:findings.length},addedDevices:added,removedDevices:removed,changedDevices:changed,findings};
}

function buildIntelligenceSummary(state,filters={}){
  const cycles=reconstructPollingCycle(state,filters),fingerprints=buildDeviceFingerprints(state,filters),relationships=analyzeRelationships(state,{...filters,limit:80}),anomalies=detectAnomalies(state,{...filters,limit:80}),registers=analyzeRegisterIntelligence(state,{...filters,limit:Math.min(250,Number(filters.limit)||250)});
  return{version:'7.0.0',generatedAt:Date.now(),registerIntelligence:registers,pollingCycles:cycles,fingerprints,relationships,anomalies,summary:{highConfidenceRegisters:registers.summary.highConfidence,cyclesDetected:cycles.summary.detected,profileClusters:fingerprints.summary.clusters,relationships:relationships.summary.count,activeWarnings:anomalies.summary.bad+anomalies.summary.warn}};
}

module.exports={analyzeRegisterIntelligence,reconstructPollingCycle,buildDeviceFingerprints,analyzeRelationships,detectAnomalies,compareCaptures,buildIntelligenceSummary,requestShape,captureSummary,detectPeriod};
