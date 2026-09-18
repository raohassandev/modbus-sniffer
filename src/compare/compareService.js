'use strict';

class CompareError extends Error{
  constructor(code,message,details={}){super(message);this.name='CompareError';this.code=code;this.details={...details};}
}
function sorted(values){return [...new Set(values)].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}));}
function mapCounts(rows,keyFn){
  const out={};for(const row of rows){const key=String(keyFn(row));out[key]=(out[key]||0)+1;}return out;
}
function registerKey(row){
  return `${row.deviceKey||row.unitId||row.slaveId||''}|${Number(row.functionCode||0)}|${Number(row.address||0)}`;
}
function registersFromCapture(capture){
  const map=new Map();
  for(const tx of capture?.transactions||[]){
    const d=tx.decoded||{};
    const deviceKey=tx.deviceKey||d.deviceKey||String(tx.unitId??tx.slaveId??d.unitId??d.slaveId??'');
    const fc=Number(tx.functionCode??d.functionCode);
    const timestamp=Number(tx.timestamp||0);
    const put=(address,value)=>{
      if(!Number.isInteger(Number(address)))return;
      const row={deviceKey,unitId:tx.unitId??tx.slaveId??d.unitId??d.slaveId,functionCode:fc,address:Number(address),value:typeof value==='boolean'?(value?1:0):Number(value),timestamp};
      const key=registerKey(row),previous=map.get(key);
      if(!previous||timestamp>=previous.timestamp)map.set(key,row);
    };
    if(Array.isArray(d.registers))for(const reg of d.registers)put(reg.address,reg.value);
    if(Array.isArray(d.points))for(const point of d.points)put(point.address,point.value);
    if([5,6].includes(fc)&&Number.isInteger(d.address))put(d.address,d.value);
    if([15,16].includes(fc)&&Number.isInteger(d.startAddress)&&Array.isArray(d.words))d.words.forEach((value,i)=>put(d.startAddress+i,value));
    if(fc===23&&Number.isInteger(d.writeStartAddress)&&Array.isArray(d.words))d.words.forEach((value,i)=>put(d.writeStartAddress+i,value));
  }
  return [...map.values()];
}
function captureSummary(capture){
  if(!capture||typeof capture!=='object'||!Array.isArray(capture.transactions))throw new CompareError('INVALID_CAPTURE','Capture must contain a transactions array');
  const tx=capture.transactions;
  const regs=registersFromCapture(capture);
  return Object.freeze({
    createdAt:capture.createdAt||null,
    transactions:tx.length,
    requests:tx.filter(x=>x.direction==='REQ').length,
    responses:tx.filter(x=>x.direction==='RSP').length,
    timeouts:tx.filter(x=>x.direction==='TIMEOUT'||x.timeout).length,
    exceptions:tx.filter(x=>x.exception||x.decoded?.exceptionCode!=null).length,
    units:sorted(tx.map(x=>x.unitId??x.slaveId??x.decoded?.unitId??x.decoded?.slaveId).filter(x=>x!=null)),
    functions:sorted(tx.map(x=>Number(x.functionCode??x.decoded?.functionCode)).filter(Number.isFinite)),
    transports:sorted(tx.map(x=>x.transport||x.channel?.transport).filter(Boolean)),
    registers:regs.length,
    byFunction:Object.freeze(mapCounts(tx,x=>Number(x.functionCode??x.decoded?.functionCode)||0)),
    byUnit:Object.freeze(mapCounts(tx,x=>x.unitId??x.slaveId??x.decoded?.unitId??x.decoded?.slaveId??'unknown')),
  });
}
function diffSets(a,b){const sa=new Set(a),sb=new Set(b);return{added:b.filter(x=>!sa.has(x)),removed:a.filter(x=>!sb.has(x)),common:a.filter(x=>sb.has(x))};}
function compareRegisterMaps(a=[],b=[]){
  if(!Array.isArray(a)||!Array.isArray(b))throw new CompareError('INVALID_REGISTER_MAP','Register maps must be arrays');
  const left=new Map(a.map(row=>[registerKey(row),row])),right=new Map(b.map(row=>[registerKey(row),row]));
  const keys=sorted([...left.keys(),...right.keys()]);
  const added=[],removed=[],changed=[],unchanged=[];
  for(const key of keys){
    const l=left.get(key),r=right.get(key);
    if(!l){added.push(r);continue;}
    if(!r){removed.push(l);continue;}
    const lv=l.value??l.lastValue,rv=r.value??r.lastValue;
    if(String(lv)!==String(rv))changed.push({key,before:l,after:r,beforeValue:lv,afterValue:rv});
    else unchanged.push({key,before:l,after:r,value:lv});
  }
  return Object.freeze({totals:Object.freeze({left:left.size,right:right.size,added:added.length,removed:removed.length,changed:changed.length,unchanged:unchanged.length}),added:Object.freeze(added),removed:Object.freeze(removed),changed:Object.freeze(changed),unchanged:Object.freeze(unchanged.slice(0,1000))});
}
function compareCaptures(leftCapture,rightCapture){
  const left=captureSummary(leftCapture),right=captureSummary(rightCapture);
  const registerDiff=compareRegisterMaps(registersFromCapture(leftCapture),registersFromCapture(rightCapture));
  return Object.freeze({
    left,right,
    units:Object.freeze(diffSets(left.units,right.units)),
    functions:Object.freeze(diffSets(left.functions,right.functions)),
    transports:Object.freeze(diffSets(left.transports,right.transports)),
    deltas:Object.freeze({
      transactions:right.transactions-left.transactions,
      requests:right.requests-left.requests,
      responses:right.responses-left.responses,
      timeouts:right.timeouts-left.timeouts,
      exceptions:right.exceptions-left.exceptions,
      registers:right.registers-left.registers,
    }),
    registerDiff,
  });
}
function indexEvidenceOccurrences(evidence=[]){
  const counts=new Map();
  return evidence.map((row,index)=>{
    const stepId=String(row?.stepId??'');
    const occurrence=(counts.get(stepId)||0)+1;
    counts.set(stepId,occurrence);
    return Object.freeze({
      key:`${stepId}#${occurrence}`,
      stepId,
      occurrence,
      index,
      row,
    });
  });
}
function compareTestRuns(left={},right={}){
  const evidenceA=Array.isArray(left.evidence)?left.evidence:[];
  const evidenceB=Array.isArray(right.evidence)?right.evidence:[];
  const indexedA=indexEvidenceOccurrences(evidenceA),indexedB=indexEvidenceOccurrences(evidenceB);
  const mapA=new Map(indexedA.map(item=>[item.key,item])),mapB=new Map(indexedB.map(item=>[item.key,item]));
  const keys=sorted([...mapA.keys(),...mapB.keys()]);
  const steps=[];
  for(const key of keys){
    const leftItem=mapA.get(key),rightItem=mapB.get(key);
    const a=leftItem?.row||null,b=rightItem?.row||null;
    const stepId=leftItem?.stepId??rightItem?.stepId??'';
    const occurrence=leftItem?.occurrence??rightItem?.occurrence??1;
    let status='unchanged';
    if(!a)status='added';else if(!b)status='removed';else if(a.result!==b.result||JSON.stringify(a.value)!==JSON.stringify(b.value)||a.error?.code!==b.error?.code)status='changed';
    steps.push({key,stepId,occurrence,status,left:a,right:b,leftIndex:leftItem?.index??null,rightIndex:rightItem?.index??null});
  }
  return Object.freeze({
    left:Object.freeze({runId:left.runId||null,recipeId:left.recipeId||null,passed:Boolean(left.passed),elapsedMs:left.elapsedMs??null,steps:evidenceA.length}),
    right:Object.freeze({runId:right.runId||null,recipeId:right.recipeId||null,passed:Boolean(right.passed),elapsedMs:right.elapsedMs??null,steps:evidenceB.length}),
    resultChanged:Boolean(left.passed)!==Boolean(right.passed),
    elapsedDeltaMs:Number.isFinite(Number(left.elapsedMs))&&Number.isFinite(Number(right.elapsedMs))?Number(right.elapsedMs)-Number(left.elapsedMs):null,
    steps:Object.freeze(steps),
  });
}
module.exports={CompareError,captureSummary,compareCaptures,compareRegisterMaps,compareTestRuns,indexEvidenceOccurrences,registersFromCapture};
