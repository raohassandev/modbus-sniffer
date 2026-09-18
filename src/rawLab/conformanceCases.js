'use strict';

const {protocol}=require('../modbusCore');

function adu(framing,unitId,pdu,transactionId=1){
  if(framing==='rtu')return protocol.encodeRtuAdu(unitId,pdu);
  if(framing==='ascii')return protocol.encodeAsciiAdu(unitId,pdu);
  if(framing==='tcp')return protocol.encodeTcpAdu({transactionId,unitId,pdu});
  throw new Error('framing must be rtu, ascii or tcp');
}
function hex(buffer){return Buffer.from(buffer).toString('hex').toUpperCase();}
function exceptionAdu(framing,unitId,functionCode,exceptionCode,transactionId){
  return adu(framing,unitId,Buffer.from([(functionCode&0x7F)|0x80,exceptionCode]),transactionId);
}
function item({id,name,description,framing,unitId,pdu,transactionId=1,expectedPdu=null,labRequired=false,category='read',timeoutMs=1000}){
  const raw=adu(framing,unitId,pdu,transactionId);
  return Object.freeze({
    id,name,description,category,labRequired,framing,unitId,
    hex:hex(raw),autoChecksum:false,expectResponse:true,timeoutMs,
    expectedHex:expectedPdu?hex(adu(framing,unitId,expectedPdu,transactionId)):null,
    expectedMaskHex:null,
  });
}
function buildConformanceCases({framing='rtu',unitId=1,transactionIdStart=1,timeoutMs=1000}={}){
  const maxUnit=framing==='tcp'?255:247;
  if(!Number.isInteger(Number(unitId))||Number(unitId)<1||Number(unitId)>maxUnit)throw new RangeError(`unitId must be 1..${maxUnit}`);
  let tid=Number(transactionIdStart)||1;
  const next=()=>{const n=tid&0xFFFF;tid=(tid+1)&0xFFFF;return n;};
  const rows=[];
  const read=(id,name,fc,address,quantity,description)=>rows.push(item({id,name,description,framing,unitId:Number(unitId),pdu:protocol.encodeReadRequest({functionCode:fc,address,quantity}),transactionId:next(),timeoutMs}));
  read('fc01-min','FC01 minimum quantity',1,0,1,'Read 1 coil: lower valid quantity boundary.');
  read('fc01-max','FC01 maximum quantity',1,0,2000,'Read 2000 coils: Modbus maximum request quantity.');
  read('fc02-max','FC02 maximum quantity',2,0,2000,'Read 2000 discrete inputs: Modbus maximum request quantity.');
  read('fc03-min','FC03 minimum quantity',3,0,1,'Read 1 holding register: lower valid quantity boundary.');
  read('fc03-max','FC03 maximum quantity',3,0,125,'Read 125 holding registers: Modbus maximum request quantity.');
  read('fc04-max','FC04 maximum quantity',4,0,125,'Read 125 input registers: Modbus maximum request quantity.');

  {
    const fc=0x41,t=next(),pdu=Buffer.from([fc]);
    rows.push(Object.freeze({id:'illegal-function',name:'Illegal function exception',description:'Send unsupported FC65 and expect exception 01 (Illegal Function).',category:'exception',labRequired:true,framing,unitId:Number(unitId),hex:hex(adu(framing,Number(unitId),pdu,t)),autoChecksum:false,expectResponse:true,timeoutMs,expectedHex:hex(exceptionAdu(framing,Number(unitId),fc,1,t)),expectedMaskHex:null}));
  }
  {
    const fc=3,t=next(),pdu=Buffer.from([fc,0xFF,0xFF,0x00,0x02]);
    rows.push(Object.freeze({id:'illegal-address',name:'Illegal address exception',description:'Read two registers starting at 65535 and expect exception 02 when the server enforces the address boundary.',category:'exception',labRequired:true,framing,unitId:Number(unitId),hex:hex(adu(framing,Number(unitId),pdu,t)),autoChecksum:false,expectResponse:true,timeoutMs,expectedHex:hex(exceptionAdu(framing,Number(unitId),fc,2,t)),expectedMaskHex:null}));
  }
  {
    const fc=3,t=next(),pdu=Buffer.from([fc,0x00,0x00,0x00,0x00]);
    rows.push(Object.freeze({id:'illegal-value',name:'Illegal quantity exception',description:'FC03 quantity 0 is invalid and should return exception 03 (Illegal Data Value).',category:'exception',labRequired:true,framing,unitId:Number(unitId),hex:hex(adu(framing,Number(unitId),pdu,t)),autoChecksum:false,expectResponse:true,timeoutMs,expectedHex:hex(exceptionAdu(framing,Number(unitId),fc,3,t)),expectedMaskHex:null}));
  }
  return Object.freeze(rows);
}
module.exports={adu,buildConformanceCases,exceptionAdu};
