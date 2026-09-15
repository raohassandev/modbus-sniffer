'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FrameExtractor } = require('../src/modbus/frameExtractor');
const { ModbusTcpStreamParser } = require('../src/modbus/tcpParser');

function rng(seed=0x6d6f6462){
  let x=seed>>>0;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/0x100000000;};
}
function randomBuffer(next,max=32){
  const n=1+Math.floor(next()*max),b=Buffer.alloc(n);
  for(let i=0;i<n;i++)b[i]=Math.floor(next()*256);
  return b;
}

test('RTU frame extractor survives deterministic random bytes with bounded buffer',()=>{
  const next=rng(),x=new FrameExtractor({baudRate:115200});
  let frames=0,noise=0;
  x.on('frame',()=>frames++);x.on('noise',b=>noise+=b.length);
  assert.doesNotThrow(()=>{
    for(let i=0;i<2500;i++){
      x.push(randomBuffer(next,24),1000+i/10);
      assert.ok(x.buffer.length<=x.maxBuffer,`RTU buffer exceeded ${x.maxBuffer}`);
    }
    x.flush();
  });
  assert.equal(x.buffer.length,0);
  assert.ok(frames>=0&&noise>=0);
});

test('TCP MBAP stream parser survives random fragmentation/corruption without unbounded buffering',()=>{
  const next=rng(0x74637037),p=new ModbusTcpStreamParser();
  let errors=0,frames=0;
  p.on('error-frame',()=>errors++);p.on('noise',()=>{});p.on('frame',()=>frames++);
  assert.doesNotThrow(()=>{
    for(let i=0;i<5000;i++){
      p.push(randomBuffer(next,19),2000+i);
      assert.ok(p.buffer.length<=1024,`TCP parser retained ${p.buffer.length} bytes`);
    }
    p.finish();
  });
  assert.equal(p.buffer.length,0);
  assert.ok(errors>0);
  assert.ok(frames>=0);
});

test('malformed oversized MBAP length cannot force payload-sized allocation or process crash',()=>{
  const p=new ModbusTcpStreamParser();let errors=0;p.on('error-frame',()=>errors++);p.on('noise',()=>{});
  const malicious=Buffer.from([0,1,0,0,0xFF,0xFF,1,3,0,0,0,1]);
  for(let i=0;i<1000;i++)p.push(malicious,3000+i);
  p.finish();
  assert.ok(errors>=1000);
  assert.equal(p.buffer.length,0);
});
