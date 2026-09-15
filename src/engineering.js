'use strict';

const SUPPORTED_TYPES=new Set(['uint16','int16','uint32','int32','float32','uint64','int64','float64','ascii','bits']);
function wordsForType(type){type=String(type||'uint16').toLowerCase();return ['uint32','int32','float32'].includes(type)?2:['uint64','int64','float64'].includes(type)?4:type==='ascii'?2:1;}
function canonicalOrder(type){return 'ABCDEFGH'.slice(0,wordsForType(type)*2);}
function normalizeByteOrder(type,order){
  type=String(type||'uint16').toLowerCase();const expected=canonicalOrder(type),raw=String(order||expected).toUpperCase();
  // v6.1 stored ABCD for one-word values even though the decoder ignored the extra bytes.
  if(wordsForType(type)===1&&raw==='ABCD')return'AB';
  if(raw.length!==expected.length||new Set(raw).size!==expected.length||[...raw].some(c=>!expected.includes(c))){const e=new Error(`Byte order for ${type} must be a permutation of ${expected}.`);e.code='INVALID_BYTE_ORDER';throw e;}
  return raw;
}
function validateMappingDefinition(input={}){
  const type=String(input.type||'uint16').toLowerCase();if(!SUPPORTED_TYPES.has(type)){const e=new Error('Unsupported data type.');e.code='UNSUPPORTED_DATA_TYPE';throw e;}
  const address=Number(input.address);if(!Number.isInteger(address)||address<0||address>65535){const e=new Error('Invalid register address.');e.code='INVALID_REGISTER_ADDRESS';throw e;}
  const wordCount=wordsForType(type);if(address+wordCount-1>65535){const e=new Error(`${type} at address ${address} needs ${wordCount} word(s) and exceeds Modbus address 65535.`);e.code='MAPPING_ADDRESS_OVERFLOW';throw e;}
  const byteOrder=normalizeByteOrder(type,input.byteOrder);
  return{type,address,wordCount,byteOrder,endAddress:address+wordCount-1};
}
function mappingSpan(mapping={}){const v=validateMappingDefinition(mapping);return{start:v.address,end:v.endAddress,words:v.wordCount};}

function orderBytes(words, order) {
  const src=[]; for(const w of words){src.push((Number(w)>>8)&255,Number(w)&255);} const letters='ABCDEFGH'.slice(0,src.length); const ord=normalizeByteOrder(src.length===2?'uint16':src.length===4?'uint32':'uint64',order||letters);
  return Buffer.from([...ord].map(c=>src[letters.indexOf(c)]));
}
function readLookup(lookup,mapping,address){
  if(mapping.deviceKey||lookup.length>=4)return lookup(mapping.deviceKey||null,mapping.slaveId,mapping.functionCode,address);
  return lookup(mapping.slaveId,mapping.functionCode,address);
}
function decimalFraction(value){
  const s=String(value??0).trim();const m=s.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);if(!m)return null;
  const sign=m[1]==='-'?-1n:1n,frac=m[3]||'',exp=Number(m[4]||0),digits=BigInt((m[2]+frac)||'0')*sign;let power=frac.length-exp;
  if(power<0)return{num:digits*(10n**BigInt(-power)),den:1n,power:0};
  return{num:digits,den:10n**BigInt(power),power};
}
function formatDecimal(num,den){
  if(den===1n)return num.toString();const negative=num<0n,n=negative?-num:num;let power=0,d=den;while(d>1n&&d%10n===0n){power++;d/=10n;}if(d!==1n)return`${num}/${den}`;
  let digits=n.toString().padStart(power+1,'0'),whole=digits.slice(0,-power)||'0',frac=digits.slice(-power).replace(/0+$/,'');return`${negative?'-':''}${whole}${frac?`.${frac}`:''}`;
}
function scaleBigIntExact(raw,scale=1,offset=0){
  const sf=decimalFraction(scale),of=decimalFraction(offset);if(!sf||!of)return raw.toString();const den=sf.den>of.den?sf.den:of.den;const num=raw*sf.num*(den/sf.den)+of.num*(den/of.den);return formatDecimal(num,den);
}

function decodeMapped(mapping, lookup) {
  const type=String(mapping.type||'uint16').toLowerCase(); let validated;
  try{validated=validateMappingDefinition({...mapping,type});}catch{return{available:false,rawWords:[],value:null,engineeringValue:null,validationError:true};}
  const n=validated.wordCount,words=[];
  for(let i=0;i<n;i++){
    const v=readLookup(lookup,mapping,mapping.address+i);
    if(v==null)return{available:false,rawWords:words,value:null,engineeringValue:null};
    words.push(Number(v)&0xFFFF);
  }
  let value; const b=orderBytes(words,validated.byteOrder);
  try{
    if(type==='uint16')value=b.readUInt16BE(0); else if(type==='int16')value=b.readInt16BE(0); else if(type==='uint32')value=b.readUInt32BE(0); else if(type==='int32')value=b.readInt32BE(0); else if(type==='float32')value=b.readFloatBE(0); else if(type==='uint64')value=b.readBigUInt64BE(0).toString(); else if(type==='int64')value=b.readBigInt64BE(0).toString(); else if(type==='float64')value=b.readDoubleBE(0); else if(type==='ascii')value=b.toString('ascii').replace(/\0+$/,''); else if(type==='bits')value=Array.from({length:16},(_,i)=>Boolean(b.readUInt16BE(0)&(1<<i))); else value=b.readUInt16BE(0);
  }catch{return{available:false,rawWords:words,value:null,engineeringValue:null};}
  const scale=Number.isFinite(Number(mapping.scale))?Number(mapping.scale):1, offset=Number.isFinite(Number(mapping.offset))?Number(mapping.offset):0; let engineeringValue=value;
  if(typeof value==='number'&&Number.isFinite(value))engineeringValue=value*scale+offset;
  else if(typeof value==='string'&&/^-?\d+$/.test(value))engineeringValue=scaleBigIntExact(BigInt(value),mapping.scale??1,mapping.offset??0);
  return{available:true,rawWords:words,value,engineeringValue,unit:mapping.unit||'',type,byteOrder:validated.byteOrder};
}
function enrichMappings(mappings,runtimeRegisters){
  const byDevice=new Map(runtimeRegisters.filter(r=>r.deviceKey).map(r=>[`${r.deviceKey}:${r.functionCode}:${r.address}`,r.lastValue]));
  const legacy=new Map(runtimeRegisters.map(r=>[`${r.slaveId}:${r.functionCode}:${r.address}`,r.lastValue]));
  return mappings.map(m=>({...m,...decodeMapped(m,(deviceKey,s,f,a)=>deviceKey?byDevice.get(`${deviceKey}:${f}:${a}`):legacy.get(`${s}:${f}:${a}`))}));
}
module.exports={decodeMapped,enrichMappings,wordsForType,orderBytes,normalizeByteOrder,validateMappingDefinition,mappingSpan,scaleBigIntExact,SUPPORTED_TYPES};
