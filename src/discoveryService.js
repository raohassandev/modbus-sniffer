'use strict';

const { makeDeviceKey } = require('./transportIdentity');
const { FC_NAMES, DEVICE_ID_OBJECT_NAMES } = require('./modbus/decoder');

function uniq(values){return [...new Set(values.filter(v=>v!==undefined&&v!==null))];}
function numeric(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function keyOf(value){
  if(value?.deviceKey)return String(value.deviceKey);
  const channelId=value?.channelId||value?.channel?.channelId;
  const unitId=value?.unitId??value?.slaveId??value?.decoded?.unitId??value?.decoded?.slaveId;
  if(!channelId||!Number.isInteger(Number(unitId)))return null;
  try{return makeDeviceKey(channelId,Number(unitId));}catch{return null;}
}

function identificationFor(deviceKey,transactions=[]){
  const values=new Map(),segments=[];
  let conformityLevel=null,lastSeen=null,readDeviceIdCodes=new Set(),sawTerminal=false;
  for(const tx of transactions){
    if(keyOf(tx)!==deviceKey||tx.direction!=='RSP'||Number(tx.functionCode??tx.decoded?.functionCode)!==43)continue;
    const d=tx.decoded||{};
    if(Number(d.meiType)!==0x0E||!Array.isArray(d.objects))continue;
    conformityLevel=d.conformityLevel??conformityLevel;
    readDeviceIdCodes.add(Number(d.readDeviceIdCode));
    lastSeen=Math.max(lastSeen||0,Number(tx.timestamp)||0)||lastSeen;
    if(d.moreFollows===false)sawTerminal=true;
    segments.push({timestamp:tx.timestamp,readDeviceIdCode:d.readDeviceIdCode,conformityLevel:d.conformityLevel,moreFollows:Boolean(d.moreFollows),nextObjectId:d.nextObjectId,objectIds:d.objects.map(o=>o.objectId)});
    for(const obj of d.objects){
      const id=Number(obj.objectId),text=String(obj.value??'').trim();if(!values.has(id))values.set(id,new Set());if(text)values.get(id).add(text);
    }
  }
  const objects={},conflicts=[];
  for(const [id,set] of [...values.entries()].sort((a,b)=>a[0]-b[0])){
    const list=[...set];objects[id]={objectId:id,name:DEVICE_ID_OBJECT_NAMES[id]||`Object${id}`,value:list.at(-1)||'',values:list,conflict:list.length>1};
    if(list.length>1)conflicts.push({objectId:id,name:DEVICE_ID_OBJECT_NAMES[id]||`Object${id}`,values:list});
  }
  const val=id=>objects[id]?.value||null;
  return {
    available:Object.keys(objects).length>0,
    vendorName:val(0),productCode:val(1),revision:val(2),vendorUrl:val(3),productName:val(4),modelName:val(5),userApplicationName:val(6),
    conformityLevel,readDeviceIdCodes:[...readDeviceIdCodes].filter(Number.isFinite).sort((a,b)=>a-b),objects:Object.values(objects),segments,
    segmented:segments.some(s=>s.moreFollows),terminalSegmentObserved:sawTerminal,lastSeen,conflict:conflicts.length>0,conflicts
  };
}

function registerBlocksFor(deviceKey,polls=[],registers=[]){
  const blocks=[];
  for(const p of polls.filter(x=>keyOf(x)===deviceKey)){
    const start=numeric(p.startAddress),quantity=numeric(p.quantity);
    if(start==null)continue;
    blocks.push({functionCode:Number(p.functionCode),functionName:p.functionName||FC_NAMES[p.functionCode]||`Function ${p.functionCode}`,operation:p.operation||null,startAddress:start,endAddress:quantity&&quantity>0?start+quantity-1:(numeric(p.endAddress)??start),quantity:quantity??(numeric(p.endAddress)!=null?numeric(p.endAddress)-start+1:null),requests:Number(p.requests||0),responses:Number(p.responses||0),timeouts:Number(p.timeouts||0),medianIntervalMs:numeric(p.medianIntervalMs),p95IntervalMs:numeric(p.p95IntervalMs),jitterPct:numeric(p.jitterPct),avgRttMs:numeric(p.avgRttMs)});
  }
  if(blocks.length)return blocks.sort((a,b)=>a.functionCode-b.functionCode||a.startAddress-b.startAddress);

  const byFc=new Map();
  for(const r of registers.filter(x=>keyOf(x)===deviceKey)){
    const fc=Number(r.functionCode),addr=Number(r.address);if(!Number.isInteger(addr))continue;if(!byFc.has(fc))byFc.set(fc,[]);byFc.get(fc).push(addr);
  }
  for(const [fc,addresses] of byFc){
    const sorted=uniq(addresses).sort((a,b)=>a-b);let start=null,prev=null;
    const flush=()=>{if(start==null)return;blocks.push({functionCode:fc,functionName:FC_NAMES[fc]||`Function ${fc}`,operation:'observed-registers',startAddress:start,endAddress:prev,quantity:prev-start+1,requests:0,responses:0,timeouts:0,medianIntervalMs:null,p95IntervalMs:null,jitterPct:null,avgRttMs:null});};
    for(const addr of sorted){if(start==null){start=prev=addr;continue;}if(addr===prev+1){prev=addr;continue;}flush();start=prev=addr;}flush();
  }
  return blocks.sort((a,b)=>a.functionCode-b.functionCode||a.startAddress-b.startAddress);
}

function buildPassiveDiscovery(state){
  const channels=state.getChannels?.()||[],devices=state.getDevices?.()||[],polls=state.getPollGroups?.()||[],registers=state.getRegisters?.({limit:50000})||[],transactions=state.getTransactions?.({limit:50000})||[];
  const channelRows=channels.map(channel=>{
    const members=devices.filter(d=>d.channelId===channel.channelId).map(device=>{
      const deviceKey=device.deviceKey||makeDeviceKey(channel.channelId,device.unitId??device.slaveId),txs=transactions.filter(t=>keyOf(t)===deviceKey),blocks=registerBlocksFor(deviceKey,polls,registers),identity=identificationFor(deviceKey,transactions);
      const functions=uniq([...txs.map(t=>Number(t.functionCode??t.decoded?.functionCode)),...blocks.map(b=>Number(b.functionCode))]).filter(Number.isFinite).sort((a,b)=>a-b);
      const firstSeen=device.firstSeen??(txs.length?Math.min(...txs.map(t=>Number(t.timestamp)||Infinity)):null),lastSeen=device.lastSeen??(txs.length?Math.max(...txs.map(t=>Number(t.timestamp)||0)):null);
      return {
        deviceKey,transport:channel.transport,channelId:channel.channelId,endpoint:channel.endpoint??null,unitId:Number(device.unitId??device.slaveId),confirmed:Boolean(device.confirmed),status:device.status||'unknown',healthScore:device.healthScore??null,
        firstSeen:Number.isFinite(firstSeen)?firstSeen:null,lastSeen:Number.isFinite(lastSeen)?lastSeen:null,lastResponseAt:device.lastResponseAt??device.lastConfirmedAt??null,
        requests:Number(device.requests||0),responses:Number(device.responses||0),timeouts:Number(device.timeouts||0),exceptions:Number(device.exceptions||0),avgRttMs:device.avgRttMs??null,p95RttMs:device.p95RttMs??null,
        functionCodes:functions,functions:functions.map(fc=>({functionCode:fc,name:FC_NAMES[fc]||`Function ${fc}`})),registerBlocks:blocks,registerCount:Number(device.registerCount||registers.filter(r=>keyOf(r)===deviceKey).length),pollGroupCount:Number(device.pollGroupCount||blocks.length),identification:identity,
        suspectedConflict:identity.conflict,conflictReasons:identity.conflicts.map(c=>`Device ID ${c.name} changed between ${c.values.join(' / ')}`)
      };
    }).sort((a,b)=>a.unitId-b.unitId);
    return {...channel,devices:members,observedUnitCount:members.length,confirmedDeviceCount:members.filter(d=>d.confirmed).length,unconfirmedDeviceCount:members.filter(d=>!d.confirmed).length,identifiedDeviceCount:members.filter(d=>d.identification.available).length,suspectedConflictCount:members.filter(d=>d.suspectedConflict).length};
  });
  const flat=channelRows.flatMap(c=>c.devices);
  return {
    generatedAt:Date.now(),mode:'passive',transmit:false,
    summary:{channels:channelRows.length,observedUnitIds:flat.length,confirmedDevices:flat.filter(d=>d.confirmed).length,unconfirmedDevices:flat.filter(d=>!d.confirmed).length,identifiedDevices:flat.filter(d=>d.identification.available).length,suspectedConflicts:flat.filter(d=>d.suspectedConflict).length,rtuChannels:channelRows.filter(c=>c.transport==='RTU').length,tcpChannels:channelRows.filter(c=>c.transport==='TCP').length},
    channels:channelRows
  };
}

module.exports={buildPassiveDiscovery,identificationFor,registerBlocksFor,keyOf};
