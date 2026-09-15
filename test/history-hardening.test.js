'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {HistoryStore}=require('../src/historyStore');

function temp(){return fs.mkdtempSync(path.join(os.tmpdir(),'mbhist-hard-'));}

test('history query reads newest records across rotated segments in chronological order',()=>{
  const dir=temp(),h=new HistoryStore({dataDir:dir,maxFileBytes:1024,maxTotalBytes:1024*20,maxSegments:4,retentionMs:0,readChunkBytes:4096});
  for(let i=1;i<=80;i++)h.append('p',{recordedAt:i,value:i,pad:'x'.repeat(40)});
  const rows=h.query('p',{limit:15});
  assert.deepEqual(rows.map(x=>x.value),Array.from({length:15},(_,i)=>66+i));
  assert.ok(fs.readdirSync(dir).some(x=>x==='p.jsonl.1'));
});

test('history channel and device filters survive chunked reads',()=>{
  const dir=temp(),h=new HistoryStore({dataDir:dir,readChunkBytes:4096});
  h.append('p',{recordedAt:1,channels:[{channelId:'a'}],devices:[{deviceKey:'a|1',channelId:'a'}]});
  h.append('p',{recordedAt:2,channels:[{channelId:'b'}],devices:[{deviceKey:'b|1',channelId:'b'}]});
  assert.deepEqual(h.query('p',{deviceKey:'a|1'}).map(x=>x.recordedAt),[1]);
  const b=h.query('p',{channelId:'b'});assert.equal(b.length,1);assert.equal(b[0].historyFilter.channelId,'b');
});

test('partial final JSON record is preserved and truncated without losing prior history',()=>{
  const dir=temp(),h=new HistoryStore({dataDir:dir,readChunkBytes:4096}),file=path.join(dir,'p.jsonl');
  fs.writeFileSync(file,'{"recordedAt":1,"value":"ok"}\n{"recordedAt":2,"value":"broken"');
  const rows=h.query('p',{limit:10});
  assert.equal(rows.length,1);assert.equal(rows[0].value,'ok');
  assert.equal(fs.readFileSync(file,'utf8'),'\u007b"recordedAt":1,"value":"ok"\u007d\n');
  const partial=fs.readdirSync(dir).filter(x=>x.startsWith('p.jsonl.partial-'));
  assert.equal(partial.length,1);assert.match(fs.readFileSync(path.join(dir,partial[0]),'utf8'),/broken/);
});

test('valid final record without newline is repaired by appending newline',()=>{
  const dir=temp(),h=new HistoryStore({dataDir:dir}),file=path.join(dir,'p.jsonl');
  fs.writeFileSync(file,'{"recordedAt":1,"value":"ok"}');
  assert.equal(h.query('p',{limit:1})[0].value,'ok');
  assert.ok(fs.readFileSync(file,'utf8').endsWith('\n'));
});

test('history retention removes old rotated segments and obeys total byte budget',()=>{
  const dir=temp(),h=new HistoryStore({dataDir:dir,maxFileBytes:1024,maxTotalBytes:2500,maxSegments:4,retentionMs:1,readChunkBytes:4096});
  for(let i=0;i<60;i++)h.append('p',{recordedAt:i,pad:'z'.repeat(80)});
  for(const name of fs.readdirSync(dir).filter(x=>/^p\.jsonl\.\d+$/.test(x))){const p=path.join(dir,name);fs.utimesSync(p,new Date(0),new Date(0));}
  h.append('p',{recordedAt:100,pad:'fresh'});
  const segments=fs.readdirSync(dir).filter(x=>/^p\.jsonl\.\d+$/.test(x));
  assert.equal(segments.length,0);
  const total=fs.readdirSync(dir).filter(x=>x.startsWith('p.jsonl')).reduce((s,n)=>s+fs.statSync(path.join(dir,n)).size,0);
  assert.ok(total<=2500);
});
