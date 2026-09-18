'use strict';

const protocol = require('../v8/protocol');

const TYPE_WORDS = Object.freeze({
  bool:1,
  uint16:1,int16:1,
  uint32:2,int32:2,float32:2,
  uint64:4,int64:4,float64:4,
  ascii2:1,ascii4:2,ascii8:4,ascii16:8,
  utf8_2:1,utf8_4:2,utf8_8:4,utf8_16:8,
  bcd16:1,bcd32:2,bcd64:4,
  timestamp32s:2,timestamp64ms:4,
  bcdDateTime6:3,
});

const VALID_TYPES = new Set(Object.keys(TYPE_WORDS));
const ORDERS_16 = Object.freeze(['AB']);
const ORDERS_32 = Object.freeze(['ABCD','CDAB','BADC','DCBA']);
const ORDERS_64 = Object.freeze(['ABCDEFGH','GHEFCDAB','BADCFEHG','HGFEDCBA']);
const ORDERS_128 = Object.freeze([
  'ABCDEFGHIJKLMNOP',
  'OPMNKLIJGHEFCDAB',
  'BADCFEHGJILKNMPO',
  'PONMLKJIHGFEDCBA',
]);

function wordsToBuffer(words){
  if(!Array.isArray(words))throw new TypeError('words must be an array');
  const out=Buffer.alloc(words.length*2);
  words.forEach((word,index)=>{
    const value=Number(word);
    if(!Number.isInteger(value)||value<0||value>0xFFFF)throw new RangeError(`word[${index}] must be 0..65535`);
    out.writeUInt16BE(value,index*2);
  });
  return out;
}

function jsonValue(value){
  if(typeof value==='bigint')return value.toString();
  if(value instanceof Date)return value.toISOString();
  if(typeof value==='number'&&!Number.isFinite(value))return null;
  return value;
}

function ordersForWords(count){
  if(count===1)return ORDERS_16;
  if(count===2)return ORDERS_32;
  if(count===4)return ORDERS_64;
  if(count===8)return ORDERS_128;
  const length=count*2;
  return [Array.from({length},(_,i)=>String.fromCharCode(65+i)).join('')];
}

function normalizeDefinition(input={}){
  const type=String(input.type||'uint16');
  if(!VALID_TYPES.has(type))throw new Error(`Unsupported register type ${type}`);
  const words=TYPE_WORDS[type];
  const orders=ordersForWords(words);
  const requested=input.byteOrder==null||input.byteOrder===''?orders[0]:String(input.byteOrder).toUpperCase().replace(/[^A-Z]/g,'');
  const scale=Number(input.scale??1);
  const offset=Number(input.offset??0);
  const precision=Math.max(0,Math.min(12,Number.isInteger(Number(input.precision))?Number(input.precision):3));
  return Object.freeze({
    type,
    words,
    byteOrder:requested,
    scale:Number.isFinite(scale)?scale:1,
    offset:Number.isFinite(offset)?offset:0,
    precision,
    unit:String(input.unit||'').slice(0,80),
    enum:input.enum&&typeof input.enum==='object'&&!Array.isArray(input.enum)?{...input.enum}:{},
    bitfield:input.bitfield&&typeof input.bitfield==='object'&&!Array.isArray(input.bitfield)?{...input.bitfield}:{},
    limits:input.limits&&typeof input.limits==='object'?{
      min:input.limits.min==null||input.limits.min===''?null:Number(input.limits.min),
      max:input.limits.max==null||input.limits.max===''?null:Number(input.limits.max),
    }:null,
    timestampEpochMs:Number.isFinite(Number(input.timestampEpochMs))?Number(input.timestampEpochMs):0,
    bcdDateTimeOrder:String(input.bcdDateTimeOrder||'YYMMDDhhmmss'),
    century:Number.isInteger(Number(input.century))?Number(input.century):2000,
  });
}

function decodeText(bytes,type){
  if(type.startsWith('ascii'))return protocol.decodeAscii(bytes,{trimNull:true,trimSpace:false});
  if(type.startsWith('utf8_')){
    return Buffer.from(bytes).toString('utf8').replace(/\x00+$/g,'');
  }
  return null;
}

function decodeRaw(words,definition){
  const def=normalizeDefinition(definition);
  if(words.length<def.words)throw new Error(`Needs ${def.words} contiguous register word(s)`);
  if(def.type==='bool')return Boolean(Number(words[0]));
  const bytes=wordsToBuffer(words.slice(0,def.words));

  if(def.type.startsWith('uint'))return protocol.decodeInteger(bytes,{bits:def.words*16,signed:false,order:def.byteOrder});
  if(def.type.startsWith('int'))return protocol.decodeInteger(bytes,{bits:def.words*16,signed:true,order:def.byteOrder});
  if(def.type.startsWith('float'))return protocol.decodeFloat(bytes,{bits:def.words*16,order:def.byteOrder});
  if(def.type.startsWith('ascii')||def.type.startsWith('utf8_')){
    const reordered=protocol.permuteBytes(bytes,def.byteOrder);
    return decodeText(reordered,def.type);
  }
  if(def.type.startsWith('bcd')&&def.type!=='bcdDateTime6'){
    const reordered=protocol.permuteBytes(bytes,def.byteOrder);
    return protocol.decodeBcd(reordered);
  }
  if(def.type==='timestamp32s'){
    const value=protocol.decodeInteger(bytes,{bits:32,signed:false,order:def.byteOrder});
    return protocol.decodeTimestamp(value,{unit:'seconds',epochMs:def.timestampEpochMs});
  }
  if(def.type==='timestamp64ms'){
    const value=protocol.decodeInteger(bytes,{bits:64,signed:false,order:def.byteOrder});
    return protocol.decodeTimestamp(value,{unit:'milliseconds',epochMs:def.timestampEpochMs});
  }
  if(def.type==='bcdDateTime6'){
    const reordered=protocol.permuteBytes(bytes,def.byteOrder);
    return protocol.decodeBcdDateTime(reordered,{order:def.bcdDateTimeOrder,century:def.century});
  }
  throw new Error(`Unsupported register type ${def.type}`);
}

function activeBits(decoded,bitfield){
  if(!bitfield||typeof bitfield!=='object')return [];
  let exact;
  try{
    if(typeof decoded==='bigint')exact=decoded;
    else if(typeof decoded==='number'&&Number.isInteger(decoded))exact=BigInt(decoded);
    else if(typeof decoded==='string'&&/^-?\d+$/.test(decoded))exact=BigInt(decoded);
    else return [];
  }catch{return [];}
  const out=[];
  for(const [bit,label] of Object.entries(bitfield)){
    const index=Number(bit);
    if(Number.isInteger(index)&&index>=0&&index<128&&(exact&(1n<<BigInt(index)))!==0n)out.push(String(label));
  }
  return out;
}

function applyEngineering(decoded,definition){
  const def=normalizeDefinition(definition);
  let value=decoded;
  if(typeof decoded==='number')value=decoded*def.scale+def.offset;
  else if(typeof decoded==='bigint'&&def.scale===1&&def.offset===0)value=decoded;
  const rawKey=String(jsonValue(decoded));
  const valueKey=String(jsonValue(value));
  const enumLabel=def.enum[rawKey]??def.enum[valueKey]??null;
  const bits=activeBits(decoded,def.bitfield);
  const numeric=typeof value==='number'&&Number.isFinite(value)?value:null;
  const outOfLimits=numeric!=null&&def.limits
    ? (Number.isFinite(def.limits.min)&&numeric<def.limits.min)||(Number.isFinite(def.limits.max)&&numeric>def.limits.max)
    : false;
  let display;
  if(enumLabel!=null)display=String(enumLabel);
  else if(value instanceof Date)display=value.toISOString();
  else if(typeof value==='number')display=Number.isFinite(value)?value.toFixed(def.precision):String(value);
  else display=String(jsonValue(value));
  return Object.freeze({
    rawDecoded:jsonValue(decoded),
    value:jsonValue(value),
    display,
    enumLabel,
    activeBits:Object.freeze(bits),
    unit:def.unit,
    outOfLimits,
  });
}

function decodeDefinition(words,definition){
  const def=normalizeDefinition(definition);
  if(!Array.isArray(words)||words.length<def.words)return Object.freeze({available:false,reason:`Needs ${def.words} contiguous register word(s)`});
  try{
    const decoded=decodeRaw(words,def);
    return Object.freeze({available:true,type:def.type,words:def.words,byteOrder:def.byteOrder,...applyEngineering(decoded,def)});
  }catch(error){
    return Object.freeze({available:false,type:def.type,words:def.words,byteOrder:def.byteOrder,reason:String(error?.message||error)});
  }
}

function interpretationMatrix(words,{includeText=true,includeBcd=true,includeTime=true}={}){
  if(!Array.isArray(words)||!words.length)return Object.freeze([]);
  const candidates=[];
  const add=(type,orders=null,extra={})=>{
    const width=TYPE_WORDS[type];
    if(!width||words.length<width)return;
    for(const byteOrder of orders||ordersForWords(width)){
      const result=decodeDefinition(words,{type,byteOrder,precision:6,...extra});
      if(result.available)candidates.push(Object.freeze(result));
    }
  };
  add('uint16');add('int16');
  add('uint32');add('int32');add('float32');
  if(words.length>=4){add('uint64');add('int64');add('float64');}
  if(includeText){
    add('ascii2');if(words.length>=2)add('ascii4');if(words.length>=4)add('ascii8');
    add('utf8_2');if(words.length>=2)add('utf8_4');if(words.length>=4)add('utf8_8');
  }
  if(includeBcd){
    add('bcd16');if(words.length>=2)add('bcd32');if(words.length>=4)add('bcd64');
    if(words.length>=3)add('bcdDateTime6');
  }
  if(includeTime){
    add('timestamp32s');if(words.length>=4)add('timestamp64ms');
  }
  return Object.freeze(candidates);
}

module.exports={
  TYPE_WORDS,
  VALID_TYPES,
  ORDERS_16,
  ORDERS_32,
  ORDERS_64,
  ORDERS_128,
  activeBits,
  applyEngineering,
  decodeDefinition,
  decodeRaw,
  interpretationMatrix,
  jsonValue,
  normalizeDefinition,
  ordersForWords,
  wordsToBuffer,
};
