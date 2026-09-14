'use strict';

const { EventEmitter } = require('events');
const { decodeFrame } = require('./decoder');

function mbapError(code,message){const e=new Error(message);e.code=code;return e;}

function decodeTcpAdu(raw){
  if(!Buffer.isBuffer(raw)||raw.length<8)throw mbapError('MBAP_TRUNCATED','Truncated Modbus TCP ADU.');
  const transactionId=raw.readUInt16BE(0),protocolId=raw.readUInt16BE(2),length=raw.readUInt16BE(4),unitId=raw[6];
  if(protocolId!==0)throw mbapError('MBAP_PROTOCOL_ID','Modbus TCP Protocol ID must be 0.');
  if(length<2)throw mbapError('MBAP_INVALID_LENGTH','MBAP length must include Unit ID and at least one PDU byte.');
  if(length>254)throw mbapError('MBAP_OVERSIZED','MBAP length exceeds the Modbus TCP ADU limit.');
  if(raw.length!==6+length)throw mbapError('MBAP_INVALID_LENGTH','MBAP length does not match the received ADU size.');
  const pdu=raw.subarray(7);
  const synthetic=Buffer.concat([Buffer.from([unitId]),pdu,Buffer.alloc(2)]);
  const decoded=decodeFrame(synthetic);
  delete decoded.raw;
  decoded.transactionId=transactionId;
  decoded.protocolId=protocolId;
  decoded.transport='TCP';
  decoded.unitId=unitId;
  decoded.slaveId=unitId; // compatibility alias for existing UI/API consumers
  return{transactionId,protocolId,length,unitId,functionCode:pdu[0]&0x7F,raw,pdu,decoded};
}

class ModbusTcpStreamParser extends EventEmitter{
  constructor(){super();this.buffer=Buffer.alloc(0);}

  _rejectPrefix(error,timestamp){
    const raw=Buffer.from(this.buffer.subarray(0,Math.min(this.buffer.length,7)));
    this.emit('error-frame',error,raw,timestamp);
    this.emit('noise',this.buffer.subarray(0,1));
    this.buffer=this.buffer.subarray(1);
  }

  push(chunk,timestamp=Date.now()){
    if(!chunk?.length)return;
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=7){
      const protocolId=this.buffer.readUInt16BE(2),length=this.buffer.readUInt16BE(4);
      if(protocolId!==0){this._rejectPrefix(mbapError('MBAP_PROTOCOL_ID',`Invalid Protocol ID ${protocolId}; expected 0.`),timestamp);continue;}
      if(length<2){this._rejectPrefix(mbapError('MBAP_INVALID_LENGTH',`Invalid MBAP length ${length}.`),timestamp);continue;}
      if(length>254){this._rejectPrefix(mbapError('MBAP_OVERSIZED',`Oversized MBAP length ${length}.`),timestamp);continue;}
      const total=6+length;
      if(this.buffer.length<total)break;
      const raw=Buffer.from(this.buffer.subarray(0,total));this.buffer=this.buffer.subarray(total);
      try{this.emit('frame',decodeTcpAdu(raw),timestamp);}catch(err){this.emit('error-frame',err,raw,timestamp);}
    }
  }

  finish(timestamp=Date.now()){
    if(this.buffer.length){
      const raw=Buffer.from(this.buffer);
      this.emit('error-frame',mbapError('MBAP_TRUNCATED',`Connection ended with ${raw.length} unconsumed Modbus TCP byte(s).`),raw,timestamp);
      this.buffer=Buffer.alloc(0);
      return raw.length;
    }
    return 0;
  }

  clear(){this.buffer=Buffer.alloc(0);}
}

module.exports={ModbusTcpStreamParser,decodeTcpAdu,mbapError};
