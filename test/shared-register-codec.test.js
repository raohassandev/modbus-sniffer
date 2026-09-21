'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const codec=require('../src/register/registerCodec');

test('shared register codec handles numeric, BCD, UTF-8 and engineering metadata',()=>{
  const numeric=codec.decodeDefinition([0x42F6,0xE979],{type:'float32',byteOrder:'ABCD',scale:1,offset:0,precision:2,unit:'V'});
  assert.equal(numeric.available,true);
  assert.equal(numeric.unit,'V');
  assert.equal(numeric.display,'123.46');

  const bcd=codec.decodeDefinition([0x1234,0x5678],{type:'bcd32',byteOrder:'ABCD'});
  assert.equal(bcd.available,true);
  assert.equal(bcd.rawDecoded,'12345678');

  const utf=codec.decodeDefinition([0x4865,0x6C6C,0x6F00,0x0000],{type:'utf8_8',byteOrder:'ABCDEFGH'});
  assert.equal(utf.available,true);
  assert.equal(utf.rawDecoded,'Hello');

  const flags=codec.decodeDefinition([0b1011],{
    type:'uint16',bitfield:{0:'Ready',1:'Alarm',3:'Remote'},
    enum:{'11':'State 11'},limits:{min:0,max:10}
  });
  assert.deepEqual(flags.activeBits,['Ready','Alarm','Remote']);
  assert.equal(flags.enumLabel,'State 11');
  assert.equal(flags.outOfLimits,true);
});

test('shared register codec handles timestamp and BCD datetime types',()=>{
  const ts=codec.decodeDefinition([0x0000,0x0001],{type:'timestamp32s',byteOrder:'ABCD'});
  assert.equal(ts.available,true);
  assert.equal(ts.rawDecoded,'1970-01-01T00:00:01.000Z');

  const bcd=codec.decodeDefinition([0x2609,0x1810,0x2830],{type:'bcdDateTime6',byteOrder:'ABCDEF',century:2000});
  assert.equal(bcd.available,true);
  assert.equal(bcd.rawDecoded,'2026-09-18T10:28:30.000Z');
});

test('interpretation matrix includes BCD, text and time candidates when enough words exist',()=>{
  const matrix=codec.interpretationMatrix([0x1234,0x5678,0x2609,0x1810,0x2830,0,0,0]);
  const types=new Set(matrix.map(x=>x.type));
  assert.ok(types.has('uint16'));
  assert.ok(types.has('float32'));
  assert.ok(types.has('ascii8'));
  assert.ok(types.has('utf8_8'));
  assert.ok(types.has('bcd32'));
  assert.ok(types.has('timestamp32s'));
});
