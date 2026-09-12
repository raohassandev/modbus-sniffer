'use strict';

const { EventEmitter } = require('events');
const { decodeFrame } = require('./decoder');

function decodeTcpAdu(raw){
  if(!Buffer.isBuffer(raw)||raw.length<8)throw new Error('Invalid Modbus TCP ADU.'); const transactionId=raw.readUInt16BE(0),protocolId=raw.readUInt16BE(2),length=raw.readUInt16BE(4),unitId=raw[6]; if(protocolId!==0)throw new Error('Not Modbus TCP (protocol ID is not 0).'); if(raw.length!==6+length)throw new Error('Invalid MBAP length.');
  const pdu=raw.subarray(7); const synthetic=Buffer.concat([Buffer.from([unitId]),pdu,Buffer.alloc(2)]); const decoded=decodeFrame(synthetic); delete decoded.raw; decoded.transactionId=transactionId; decoded.protocolId=protocolId; decoded.transport='TCP'; return{transactionId,protocolId,length,unitId,functionCode:pdu[0]&0x7F,raw,pdu,decoded};
}

class ModbusTcpStreamParser extends EventEmitter{
  constructor(){super();this.buffer=Buffer.alloc(0);}
  push(chunk,timestamp=Date.now()){
    if(!chunk?.length)return;this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=7){const protocolId=this.buffer.readUInt16BE(2),length=this.buffer.readUInt16BE(4),total=6+length;if(protocolId!==0||length<2||length>254){this.emit('noise',this.buffer.subarray(0,1));this.buffer=this.buffer.subarray(1);continue;}if(this.buffer.length<total)break;const raw=Buffer.from(this.buffer.subarray(0,total));this.buffer=this.buffer.subarray(total);try{this.emit('frame',decodeTcpAdu(raw),timestamp);}catch(err){this.emit('error-frame',err,raw);}}
  }
  clear(){this.buffer=Buffer.alloc(0);}
}
module.exports={ModbusTcpStreamParser,decodeTcpAdu};
