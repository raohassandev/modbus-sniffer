'use strict';

const FUNCTION_NAMES = Object.freeze({
  1:'Read Coils',2:'Read Discrete Inputs',3:'Read Holding Registers',4:'Read Input Registers',
  5:'Write Single Coil',6:'Write Single Register',7:'Read Exception Status',8:'Diagnostics',
  11:'Get Comm Event Counter',12:'Get Comm Event Log',15:'Write Multiple Coils',
  16:'Write Multiple Registers',17:'Report Server ID',20:'Read File Record',
  21:'Write File Record',22:'Mask Write Register',23:'Read/Write Multiple Registers',
  24:'Read FIFO Queue',43:'Encapsulated Interface / Device ID',
});

class EvidenceHub {
  constructor({maxRows=20000,idBase=1000000000}={}){
    if(!Number.isInteger(maxRows)||maxRows<100)throw new TypeError('maxRows must be >= 100');
    if(!Number.isInteger(idBase)||idBase<1)throw new TypeError('idBase must be a positive integer');
    this.maxRows=maxRows;
    this.idBase=idBase;
    this.sequence=0;
    this.rows=[];
  }

  ingest(event,{sourceType=null}={}){
    if(!event||typeof event!=='object')return null;
    const row=this._normalizeTraffic(event,{sourceType});
    if(!row)return null;
    return this._append(row);
  }

  ingestAnnotation(event,{sourceType='Test Sequence',direction='TEST'}={}){
    if(!event||typeof event!=='object'||!event.type)return null;
    const details=event.details&&typeof event.details==='object'?event.details:{};
    return this._append({
      timestamp:Number(event.timestamp||event.at||Date.now()),
      direction,
      unitId:event.unitId??null,
      slaveId:event.unitId??null,
      functionCode:event.functionCode==null?null:(Number(event.functionCode)&0x7F),
      functionName:event.functionCode==null?String(event.type):FUNCTION_NAMES[Number(event.functionCode)&0x7F]||`FC${Number(event.functionCode)&0x7F}`,
      rawHex:event.rawHex||'',
      byteLength:event.rawHex?String(event.rawHex).replace(/\s+/g,'').length/2:0,
      rttMs:details.rttMs??null,
      timeoutMs:details.timeoutMs??null,
      matched:false,
      exception:false,
      sourceType,
      source:event.source||'test-sequence',
      ownerMode:event.ownerMode||'test',
      connectionId:event.connectionId||null,
      channelId:event.channelId||event.connectionId||`active:${String(sourceType).toLowerCase().replace(/\s+/g,'-')}`,
      transport:String(details.framing||'TEST').toUpperCase(),
      eventType:event.type,
      transactionId:details.transactionId??null,
      decoded:{eventType:event.type,source:event.source||null,details:{...details}},
      request:null,
    });
  }

  list(filters={}){
    const limit=Math.max(1,Math.min(this.maxRows,Number(filters.limit)||1000));
    const unit=filters.unitId??filters.slaveId??filters.slave;
    const fc=filters.functionCode??filters.fc;
    const direction=filters.direction?String(filters.direction).toUpperCase():null;
    const channelId=filters.channelId?String(filters.channelId):null;
    const sourceType=filters.sourceType?String(filters.sourceType).toLowerCase():null;
    const q=filters.q?String(filters.q).toLowerCase():null;
    const out=[];
    for(let i=this.rows.length-1;i>=0&&out.length<limit;i--){
      const row=this.rows[i];
      if(unit!==undefined&&unit!==null&&unit!==''&&Number(row.unitId)!==Number(unit))continue;
      if(fc!==undefined&&fc!==null&&fc!==''&&Number(row.functionCode)!==Number(fc))continue;
      if(direction&&row.direction!==direction)continue;
      if(channelId&&row.channelId!==channelId)continue;
      if(sourceType&&String(row.sourceType||'').toLowerCase()!==sourceType)continue;
      if(q&&!this._searchText(row).includes(q))continue;
      out.push(row);
    }
    return out.reverse();
  }

  clear(){
    const removed=this.rows.length;
    this.rows=[];
    return removed;
  }

  status(){
    const bySource={};
    for(const row of this.rows)bySource[row.sourceType]=(bySource[row.sourceType]||0)+1;
    return Object.freeze({rows:this.rows.length,maxRows:this.maxRows,bySource:Object.freeze({...bySource})});
  }

  _append(row){
    const record=Object.freeze({id:this.idBase+(++this.sequence),...row});
    this.rows.push(record);
    if(this.rows.length>this.maxRows)this.rows.splice(0,this.rows.length-this.maxRows);
    return record;
  }

  _normalizeTraffic(event,{sourceType=null}={}){
    const type=String(event.type||'');
    const owner=String(event.ownerMode||'').toLowerCase();
    const source=String(event.source||'');
    const details=event.details&&typeof event.details==='object'?event.details:{};
    let direction=null;

    if(type==='traffic.tx')direction=owner==='slave'?'RSP':'REQ';
    else if(type==='traffic.rx')direction=owner==='slave'?'REQ':'RSP';
    else if(type==='master.timeout')direction='TIMEOUT';
    else if(type==='master.receive-error'||type==='slave.malformed'||type==='slave.runtime-error')direction='UNK';
    else return null;

    const rawHex=String(event.rawHex||'').replace(/\s+/g,'').toUpperCase();
    const rawFc=event.functionCode??details.functionCode;
    const baseFc=rawFc==null?null:(Number(rawFc)&0x7F);
    const exception=Boolean(details.exception)||(rawFc!=null&&(Number(rawFc)&0x80)!==0);
    const inferredSource=sourceType||(
      owner==='master'?'Master':
      owner==='slave'?'Slave':
      source.includes('discovery')?'Discovery':'Active'
    );
    const transport=String(details.framing||details.transport||'').toUpperCase()||'ACTIVE';
    const channelId=event.channelId||event.connectionId||`active:${owner||source||'unknown'}`;
    const unitId=event.unitId??null;

    return {
      timestamp:Number(event.timestamp||Date.now()),
      direction,
      unitId,
      slaveId:unitId,
      functionCode:baseFc,
      functionName:baseFc==null?type:(FUNCTION_NAMES[baseFc]||`FC${String(baseFc).padStart(2,'0')}`),
      rawHex,
      byteLength:rawHex?rawHex.length/2:0,
      rttMs:details.rttMs??null,
      timeoutMs:details.timeoutMs??null,
      matched:direction==='RSP',
      exception,
      exceptionCode:details.exceptionCode??null,
      exceptionName:details.exceptionName??null,
      sourceType:inferredSource,
      source,
      ownerMode:owner||null,
      connectionId:event.connectionId||null,
      channelId,
      channel:{channelId,name:`${inferredSource} · ${event.connectionId||transport}`,transport},
      transport,
      eventType:type,
      transactionId:details.transactionId??null,
      decoded:{eventType:type,source,ownerMode:owner||null,details:{...details}},
      request:direction==='TIMEOUT'?{unitId,functionCode:baseFc,transactionId:details.transactionId??null}:null,
    };
  }

  _searchText(row){
    return `${row.rawHex||''} ${row.functionName||''} ${row.sourceType||''} ${row.source||''} ${row.connectionId||''} ${row.channelId||''} ${row.unitId??''} ${row.functionCode??''} ${row.direction||''} ${JSON.stringify(row.decoded||{})}`.toLowerCase();
  }
}

function mergeEvidence(passive=[],active=[],{limit=3000}={}){
  const max=Math.max(1,Number(limit)||3000);
  return [...passive,...active]
    .sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0)||Number(a.id||0)-Number(b.id||0))
    .slice(-max);
}

module.exports={EvidenceHub,FUNCTION_NAMES,mergeEvidence};
