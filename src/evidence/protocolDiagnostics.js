'use strict';

const protocol = require('../v8/protocol');

const EXCEPTION_NAMES = Object.freeze({
  1:'Illegal Function',
  2:'Illegal Data Address',
  3:'Illegal Data Value',
  4:'Server Device Failure',
  5:'Acknowledge',
  6:'Server Device Busy',
  8:'Memory Parity Error',
  10:'Gateway Path Unavailable',
  11:'Gateway Target Device Failed to Respond',
});

function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function percentile(values,p){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil((p/100)*sorted.length)-1));
  return sorted[index];
}
function median(values){return percentile(values,50);}
function stdDev(values){
  if(values.length<2)return 0;
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  return Math.sqrt(values.reduce((sum,v)=>sum+(v-avg)**2,0)/values.length);
}
function jsonSafe(value){
  if(Buffer.isBuffer(value))return value.toString('hex').toUpperCase();
  if(Array.isArray(value))return value.map(jsonSafe);
  if(value&&typeof value==='object'){
    const out={};
    for(const [key,val] of Object.entries(value))out[key]=jsonSafe(val);
    return out;
  }
  if(typeof value==='bigint')return value.toString();
  return value;
}
function framingOf(row){
  const transport=String(row.transport||row.channel?.transport||'').toUpperCase();
  // Explicit encapsulation metadata is authoritative. In particular, an
  // 8-byte RTU read request can accidentally resemble an MBAP header when
  // bytes 2..5 happen to be 00 00 00 02, so raw-byte heuristics must never
  // override an explicit RTU/ASCII transport label.
  if(transport.includes('ASCII'))return 'ascii';
  if(transport.includes('RTU'))return 'rtu';
  if(transport.includes('TCP')||transport.includes('TLS')||transport.includes('UDP'))return 'tcp';
  const raw=String(row.rawHex||'').replace(/\s+/g,'');
  if(raw.startsWith('3A'))return 'ascii';
  if(raw.length>=16){
    const bytes=Buffer.from(raw,'hex');
    if(bytes.length>=8&&bytes.readUInt16BE(2)===0&&bytes.readUInt16BE(4)+6===bytes.length)return 'tcp';
  }
  return 'rtu';
}
function decodeAdu(row){
  const rawHex=String(row.rawHex||'').replace(/\s+/g,'');
  if(!rawHex||rawHex.length%2)return {valid:false,framing:framingOf(row),error:{code:'INVALID_HEX_LENGTH',message:'Raw HEX is empty or has an odd number of digits'}};
  let raw;
  try{raw=Buffer.from(rawHex,'hex');}catch(error){return {valid:false,framing:framingOf(row),error:{code:'INVALID_HEX',message:error.message}};}
  const framing=framingOf(row);
  try{
    const adu=framing==='tcp'?protocol.decodeTcpAdu(raw):framing==='ascii'?protocol.decodeAsciiAdu(raw):protocol.decodeRtuAdu(raw);
    return {valid:true,framing,adu};
  }catch(error){
    return {valid:false,framing,error:{code:error?.code||'FRAME_INVALID',message:String(error?.message||error),details:jsonSafe(error?.details||{})}};
  }
}
function responseDecode(pdu){
  const raw=Buffer.from(pdu||[]);
  if(!raw.length)return null;
  if(raw[0]&0x80){
    const ex=protocol.decodeExceptionPdu(raw);
    return {...ex,exceptionName:EXCEPTION_NAMES[ex.exceptionCode]||`Exception ${ex.exceptionCode}`};
  }
  switch(raw[0]){
    case protocol.FC.READ_COILS:
    case protocol.FC.READ_DISCRETE_INPUTS:
      return protocol.decodeReadBitsResponse(raw);
    case protocol.FC.READ_HOLDING_REGISTERS:
    case protocol.FC.READ_INPUT_REGISTERS:
      return protocol.decodeReadRegistersResponse(raw);
    case protocol.FC.WRITE_SINGLE_COIL:
    case protocol.FC.WRITE_SINGLE_REGISTER:
      return protocol.decodeWriteSingleRequest(raw);
    case protocol.FC.WRITE_MULTIPLE_COILS:
    case protocol.FC.WRITE_MULTIPLE_REGISTERS:
      return protocol.decodeWriteMultipleResponse(raw);
    case protocol.FC.MASK_WRITE_REGISTER:
      return protocol.decodeMaskWriteRegisterRequest(raw);
    case protocol.FC.READ_WRITE_MULTIPLE_REGISTERS:
      return protocol.decodeReadRegistersResponse(raw);
    case protocol.FC.READ_EXCEPTION_STATUS:
      return protocol.decodeReadExceptionStatusResponse(raw);
    case protocol.FC.DIAGNOSTICS:
      return protocol.decodeDiagnosticsResponse(raw);
    case protocol.FC.GET_COMM_EVENT_COUNTER:
      return protocol.decodeCommEventCounterResponse(raw);
    case protocol.FC.GET_COMM_EVENT_LOG:
      return protocol.decodeCommEventLogResponse(raw);
    case protocol.FC.REPORT_SERVER_ID:
      return protocol.decodeReportServerIdResponse(raw);
    case protocol.FC.READ_FILE_RECORD:
      return protocol.decodeReadFileRecordResponse(raw);
    case protocol.FC.WRITE_FILE_RECORD:
      return protocol.decodeWriteFileRecordResponse(raw);
    case protocol.FC.READ_FIFO_QUEUE:
      return protocol.decodeReadFifoQueueResponse(raw);
    case protocol.FC.ENCAPSULATED_INTERFACE:
      return protocol.decodeDeviceIdResponse(raw);
    default:
      return {functionCode:raw[0],vendorOrUnsupported:true,data:raw.subarray(1)};
  }
}
function decodePdu(row,aduResult){
  if(!aduResult?.valid)return null;
  const pdu=aduResult.adu.pdu;
  try{
    if(row.direction==='REQ')return jsonSafe(protocol.decodeRequestPdu(pdu));
    if(row.direction==='RSP')return jsonSafe(responseDecode(pdu));
    return jsonSafe({functionCode:pdu[0],data:pdu.subarray(1)});
  }catch(error){
    return {decodeError:{code:error?.code||'PDU_DECODE_FAILED',message:String(error?.message||error)}};
  }
}
function requestKey(row,adu){
  const fc=(adu?.pdu?.[0]??row.functionCode??0)&0x7F;
  const unit=adu?.unitId??row.unitId??row.slaveId??'';
  const connection=row.connectionId||row.channelId||row.channel?.channelId||'';
  if(adu?.transactionId!=null)return `tcp|${connection}|${adu.transactionId}|${unit}`;
  return `serial|${connection}|${unit}|${fc}`;
}
function pairTransactions(rows, decodedById){
  const outstanding=new Map();
  const pairs=[];
  const orphanResponses=[];
  const duplicateRequests=[];
  const duplicateResponses=[];
  const seenRequestFingerprint=new Map();
  const seenResponseFingerprint=new Map();
  const lastTidResponseByConnection=new Map();
  const outOfOrderResponses=[];
  const sorted=[...rows].sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0)||Number(a.id||0)-Number(b.id||0));

  for(const row of sorted){
    const diag=decodedById.get(row.id);
    const adu=diag?.aduResult?.valid?diag.aduResult.adu:null;
    if(!adu||!['REQ','RSP','TIMEOUT'].includes(row.direction))continue;
    const key=requestKey(row,adu);

    if(row.direction==='REQ'){
      const fingerprint=`${key}|${String(row.rawHex||'')}`;
      const previous=seenRequestFingerprint.get(fingerprint);
      if(previous&&Number(row.timestamp)-Number(previous.timestamp)<=1000)duplicateRequests.push({firstId:previous.id,duplicateId:row.id,gapMs:Number(row.timestamp)-Number(previous.timestamp)});
      seenRequestFingerprint.set(fingerprint,row);
      const queue=outstanding.get(key)||[];
      queue.push(row);
      outstanding.set(key,queue);
      continue;
    }

    if(row.direction==='TIMEOUT'){
      const queue=outstanding.get(key)||[];
      if(queue.length)queue.shift();
      if(!queue.length)outstanding.delete(key);
      continue;
    }

    const fingerprint=`${key}|${String(row.rawHex||'')}`;
    const previousResponse=seenResponseFingerprint.get(fingerprint);
    if(previousResponse&&Number(row.timestamp)-Number(previousResponse.timestamp)<=1000)duplicateResponses.push({firstId:previousResponse.id,duplicateId:row.id,gapMs:Number(row.timestamp)-Number(previousResponse.timestamp)});
    seenResponseFingerprint.set(fingerprint,row);

    const queue=outstanding.get(key)||[];
    const request=queue.shift()||null;
    if(!queue.length)outstanding.delete(key); else outstanding.set(key,queue);
    if(!request){orphanResponses.push(row);continue;}

    const requestDiag=decodedById.get(request.id);
    const requestAdu=requestDiag?.aduResult?.adu;
    const requestFc=(requestAdu?.pdu?.[0]??request.functionCode??0)&0x7F;
    const responseFc=(adu.pdu?.[0]??row.functionCode??0)&0x7F;
    const mismatch=requestFc!==responseFc||(requestAdu?.unitId??request.unitId)!==(adu.unitId??row.unitId);
    const rttMs=Math.max(0,Number(row.timestamp)-Number(request.timestamp));
    pairs.push({requestId:request.id,responseId:row.id,unitId:adu.unitId,functionCode:requestFc,rttMs,mismatch,transactionId:adu.transactionId??null,connectionId:row.connectionId||row.channelId||null});

    if(adu.transactionId!=null){
      const conn=row.connectionId||row.channelId||'tcp';
      const previousTid=lastTidResponseByConnection.get(conn);
      if(previousTid!=null&&adu.transactionId<previousTid&&previousTid-adu.transactionId<0x8000){
        outOfOrderResponses.push({responseId:row.id,previousTransactionId:previousTid,transactionId:adu.transactionId,connectionId:conn});
      }
      lastTidResponseByConnection.set(conn,adu.transactionId);
    }
  }

  const unmatchedRequests=[];
  for(const queue of outstanding.values())unmatchedRequests.push(...queue);
  return {pairs,orphanResponses,unmatchedRequests,duplicateRequests,duplicateResponses,outOfOrderResponses};
}
function gapDiagnostics(rows,serialConfig={}){
  const groups=new Map();
  for(const row of rows){
    if(!row.timestamp)continue;
    const key=row.connectionId||row.channelId||'unknown';
    const arr=groups.get(key)||[];arr.push(row);groups.set(key,arr);
  }
  const summaries=[];
  for(const [connectionId,items] of groups){
    items.sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
    const gaps=[];
    for(let i=1;i<items.length;i++)gaps.push(Math.max(0,Number(items[i].timestamp)-Number(items[i-1].timestamp)));
    const avg=gaps.length?gaps.reduce((a,b)=>a+b,0)/gaps.length:null;
    const med=median(gaps);
    const jitter=avg&&gaps.length>1?(stdDev(gaps)/avg)*100:null;
    const transport=String(items[0]?.transport||'').toUpperCase();
    let silentIntervalMs=null,violations=0;
    if(transport.includes('RTU')||transport==='RTU'){
      const baud=Number(serialConfig.baudRate||serialConfig.baud||0);
      const dataBits=Number(serialConfig.dataBits||8);
      const parity=String(serialConfig.parity||'none').toLowerCase()==='none'?0:1;
      const stopBits=Number(serialConfig.stopBits||1);
      if(baud>0){
        const bitsPerChar=1+dataBits+parity+stopBits;
        silentIntervalMs=3.5*bitsPerChar*1000/baud;
        violations=gaps.filter(gap=>gap>0&&gap<silentIntervalMs).length;
      }
    }
    summaries.push({connectionId,transport,count:items.length,gaps:gaps.length,avgGapMs:avg,medianGapMs:med,p95GapMs:percentile(gaps,95),jitterPct:jitter,silentIntervalMs,silentIntervalViolations:violations});
  }
  return summaries;
}
function analyzeProtocolTraffic(rows,{serialConfig={}}={}){
  const decodedById=new Map();
  const frameIssues=[];
  const exceptions=[];
  for(const row of rows){
    if(!row.rawHex||!['REQ','RSP'].includes(row.direction))continue;
    const aduResult=decodeAdu(row);
    const pdu=decodePdu(row,aduResult);
    decodedById.set(row.id,{aduResult,pdu});
    if(!aduResult.valid){
      frameIssues.push({id:row.id,timestamp:row.timestamp,sourceType:row.sourceType||'Sniffer',transport:aduResult.framing,code:aduResult.error.code,message:aduResult.error.message});
      continue;
    }
    const rawFc=aduResult.adu.pdu?.[0];
    if(row.direction==='RSP'&&rawFc!=null&&(rawFc&0x80)){
      const ex=responseDecode(aduResult.adu.pdu);
      exceptions.push({id:row.id,timestamp:row.timestamp,unitId:aduResult.adu.unitId,functionCode:ex.originalFunctionCode,exceptionCode:ex.exceptionCode,exceptionName:ex.exceptionName,sourceType:row.sourceType||'Sniffer'});
    }
  }
  const matching=pairTransactions(rows,decodedById);
  const rtts=matching.pairs.map(pair=>pair.rttMs).filter(Number.isFinite);
  const mismatchPairs=matching.pairs.filter(pair=>pair.mismatch);
  const timeoutRows=rows.filter(row=>row.direction==='TIMEOUT');
  const gaps=gapDiagnostics(rows,serialConfig);
  const sources={};
  for(const row of rows)sources[row.sourceType||'Sniffer']=(sources[row.sourceType||'Sniffer']||0)+1;
  return Object.freeze({
    totals:Object.freeze({
      rows:rows.length,
      validFrames:decodedById.size-frameIssues.length,
      invalidFrames:frameIssues.length,
      matchedPairs:matching.pairs.length,
      unmatchedRequests:matching.unmatchedRequests.length,
      orphanResponses:matching.orphanResponses.length,
      timeouts:timeoutRows.length,
      exceptions:exceptions.length,
      duplicateRequests:matching.duplicateRequests.length,
      duplicateResponses:matching.duplicateResponses.length,
      mismatches:mismatchPairs.length,
      outOfOrderTcpResponses:matching.outOfOrderResponses.length,
    }),
    latency:Object.freeze({
      samples:rtts.length,
      minMs:rtts.length?Math.min(...rtts):null,
      avgMs:rtts.length?rtts.reduce((a,b)=>a+b,0)/rtts.length:null,
      medianMs:median(rtts),
      p95Ms:percentile(rtts,95),
      maxMs:rtts.length?Math.max(...rtts):null,
      stdDevMs:rtts.length?stdDev(rtts):null,
    }),
    sources:Object.freeze({...sources}),
    frameIssues:Object.freeze(frameIssues.slice(-500)),
    exceptions:Object.freeze(exceptions.slice(-500)),
    mismatches:Object.freeze(mismatchPairs.slice(-500)),
    duplicateRequests:Object.freeze(matching.duplicateRequests.slice(-500)),
    duplicateResponses:Object.freeze(matching.duplicateResponses.slice(-500)),
    outOfOrderTcpResponses:Object.freeze(matching.outOfOrderResponses.slice(-500)),
    unmatchedRequests:Object.freeze(matching.unmatchedRequests.slice(-500).map(row=>({id:row.id,timestamp:row.timestamp,unitId:row.unitId??row.slaveId,functionCode:row.functionCode,sourceType:row.sourceType||'Sniffer'}))),
    orphanResponses:Object.freeze(matching.orphanResponses.slice(-500).map(row=>({id:row.id,timestamp:row.timestamp,unitId:row.unitId??row.slaveId,functionCode:row.functionCode,sourceType:row.sourceType||'Sniffer'}))),
    gapAnalysis:Object.freeze(gaps),
    decoded:Object.freeze([...decodedById.entries()].slice(-2000).map(([id,value])=>Object.freeze({
      id,
      framing:value.aduResult.framing,
      valid:value.aduResult.valid,
      unitId:value.aduResult.valid?value.aduResult.adu.unitId:null,
      transactionId:value.aduResult.valid?(value.aduResult.adu.transactionId??null):null,
      pdu:value.pdu,
      frameError:value.aduResult.valid?null:value.aduResult.error,
    }))),
  });
}

module.exports={
  EXCEPTION_NAMES,
  analyzeProtocolTraffic,
  decodeAdu,
  decodePdu,
  framingOf,
  gapDiagnostics,
  pairTransactions,
  percentile,
};
