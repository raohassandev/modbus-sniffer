'use strict';

function wordsForType(type){return ['uint32','int32','float32'].includes(type)?2:['uint64','int64','float64'].includes(type)?4:type==='ascii'?2:1;}
function orderBytes(words, order) {
  const src=[]; for(const w of words){src.push((Number(w)>>8)&255,Number(w)&255);} const letters='ABCDEFGH'.slice(0,src.length); const ord=String(order||letters).toUpperCase();
  if(ord.length!==src.length||[...ord].some(c=>!letters.includes(c)))return Buffer.from(src); return Buffer.from([...ord].map(c=>src[letters.indexOf(c)]));
}
function decodeMapped(mapping, lookup) {
  const type=String(mapping.type||'uint16').toLowerCase(); const n=wordsForType(type); const words=[];
  for(let i=0;i<n;i++){const v=lookup(mapping.slaveId,mapping.functionCode,mapping.address+i);if(v==null)return{available:false,rawWords:words,value:null,engineeringValue:null};words.push(Number(v)&0xFFFF);}
  let value; const b=orderBytes(words,mapping.byteOrder);
  try{
    if(type==='uint16')value=words[0]; else if(type==='int16')value=words[0]&0x8000?words[0]-65536:words[0]; else if(type==='uint32')value=b.readUInt32BE(0); else if(type==='int32')value=b.readInt32BE(0); else if(type==='float32')value=b.readFloatBE(0); else if(type==='uint64')value=b.readBigUInt64BE(0).toString(); else if(type==='int64')value=b.readBigInt64BE(0).toString(); else if(type==='float64')value=b.readDoubleBE(0); else if(type==='ascii')value=b.toString('ascii').replace(/\0+$/,''); else if(type==='bits')value=Array.from({length:16},(_,i)=>Boolean(words[0]&(1<<i))); else value=words[0];
  }catch{return{available:false,rawWords:words,value:null,engineeringValue:null};}
  const scale=Number.isFinite(Number(mapping.scale))?Number(mapping.scale):1, offset=Number.isFinite(Number(mapping.offset))?Number(mapping.offset):0; let engineeringValue=value;
  if(typeof value==='number'&&Number.isFinite(value))engineeringValue=value*scale+offset; else if(typeof value==='string'&&/^-?\d+$/.test(value)&&scale===1&&offset===0)engineeringValue=value;
  return{available:true,rawWords:words,value,engineeringValue,unit:mapping.unit||'',type,byteOrder:mapping.byteOrder};
}
function enrichMappings(mappings, runtimeRegisters){const map=new Map(runtimeRegisters.map(r=>[`${r.slaveId}:${r.functionCode}:${r.address}`,r.lastValue]));return mappings.map(m=>({...m,...decodeMapped(m,(s,f,a)=>map.get(`${s}:${f}:${a}`))}));}
module.exports={decodeMapped,enrichMappings,wordsForType,orderBytes};
