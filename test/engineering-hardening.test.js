'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeByteOrder,validateMappingDefinition,mappingSpan,scaleBigIntExact,decodeMapped}=require('../src/engineering');
const {MeterMap}=require('../src/meterMap');

test('byte order is validated against datatype width and legacy one-word ABCD normalizes safely',()=>{
  assert.equal(normalizeByteOrder('uint16','ABCD'),'AB');
  assert.equal(normalizeByteOrder('uint16','BA'),'BA');
  assert.equal(normalizeByteOrder('float32','CDAB'),'CDAB');
  assert.equal(normalizeByteOrder('uint64','HGFEDCBA'),'HGFEDCBA');
  assert.throws(()=>normalizeByteOrder('float32','ABCDEFGH'),e=>e.code==='INVALID_BYTE_ORDER');
  assert.throws(()=>normalizeByteOrder('uint64','ABCDEFGG'),e=>e.code==='INVALID_BYTE_ORDER');
});

test('mapping validator enforces required word count at Modbus address boundary',()=>{
  assert.deepEqual(mappingSpan({address:65534,type:'uint32',byteOrder:'ABCD'}),{start:65534,end:65535,words:2});
  assert.throws(()=>validateMappingDefinition({address:65535,type:'uint32',byteOrder:'ABCD'}),e=>e.code==='MAPPING_ADDRESS_OVERFLOW');
});

test('64-bit engineering scaling remains exact beyond JavaScript safe integer range',()=>{
  const raw=18446744073709551615n;
  assert.equal(scaleBigIntExact(raw,'0.01','0'),'184467440737095516.15');
  assert.equal(scaleBigIntExact(9007199254740993n,'2','1'),'18014398509481987');
  const words=[0xffff,0xffff,0xffff,0xffff],map={slaveId:1,functionCode:3,address:0,type:'uint64',byteOrder:'ABCDEFGH',scale:'0.01',offset:'0'};
  const out=decodeMapped(map,(_s,_f,a)=>words[a]);
  assert.equal(out.value,'18446744073709551615');assert.equal(out.engineeringValue,'184467440737095516.15');
});

test('legacy MeterMap never coerces a uint64 through Number when scaling',()=>{
  const mm=new MeterMap([{slaveId:1,function:3,address:100,type:'uint64',byteOrder:'ABCDEFGH',scale:'0.01',offset:'0'}]);
  const out=mm.resolve({direction:'RSP',request:{startAddress:100},decoded:{slaveId:1,functionCode:3,words:[0xffff,0xffff,0xffff,0xffff]}});
  assert.equal(out.length,1);assert.equal(out[0].raw,18446744073709551615n);assert.equal(out[0].value,'184467440737095516.15');
});
