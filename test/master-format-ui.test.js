'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const format=fs.readFileSync(path.join(root,'public/master-format-v7.js'),'utf8');
const sessions=fs.readFileSync(path.join(root,'public/master-sessions-v7.js'),'utf8');
const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');

test('Master format extension parses and loads before Monitor Sessions',()=>{
  assert.doesNotThrow(()=>new vm.Script(format,{filename:'master-format-v7.js'}));
  const master=loader.indexOf("master.src='/master-v7.js");
  const formatter=loader.indexOf("format.src='/master-format-v7.js",master);
  const sessionsIndex=loader.indexOf("sessions.src='/master-sessions-v7.js",formatter);
  assert.ok(master>=0&&formatter>master&&sessionsIndex>formatter,'Master -> Format -> Sessions load order is required');
});

test('format selector exposes standard 16 32 and 64-bit engineering types',()=>{
  for(const token of ['uint16','int16','uint32','int32','float32','uint64','int64','float64','hex','binary','ascii']){
    assert.ok(format.includes(`'${token}'`),`missing ${token}`);
  }
  assert.match(format,/wordCount=type=>\['uint32','int32','float32'\]\.includes\(type\)\?2:/);
  assert.match(format,/\['uint64','int64','float64'\]\.includes\(type\)\?4:1/);
});

test('format engine supports ABCD BADC CDAB DCBA transformations and big integer decoding',()=>{
  for(const order of ['ABCD','BADC','CDAB','DCBA'])assert.ok(format.includes(`'${order}'`),`missing order ${order}`);
  assert.match(format,/getUint32\(0,false\)/);
  assert.match(format,/getInt32\(0,false\)/);
  assert.match(format,/getFloat32\(0,false\)/);
  assert.match(format,/getFloat64\(0,false\)/);
  assert.match(format,/getBigUint64/);
  assert.match(format,/getBigInt64/);
  assert.match(format,/bytes\.reverse\(\)/);
});

test('format rendering is idempotent under MutationObserver polling updates',()=>{
  assert.match(format,/const setHtml=.*node\.innerHTML!==html/);
  assert.match(format,/const setText=.*node\.textContent!==next/);
  assert.match(format,/new MutationObserver\(\(\)=>render\(\)\)/);
});

test('precision and byte order are persisted per saved monitor session',()=>{
  assert.match(format,/id="masterPrecision"/);
  assert.match(sessions,/precision:num\('masterPrecision',3\)/);
  assert.match(sessions,/byteOrder:window\.ModbusMasterFormat\?\.getByteOrder/);
  assert.match(sessions,/setByteOrder\?\.\(f\.byteOrder\|\|'ABCD'\)/);
  assert.match(sessions,/setValue\('masterPrecision',f\.precision\?\?3\)/);
});
