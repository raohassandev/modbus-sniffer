'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {prepareDesktopDataDir}=require('../desktop/storage');

function temp(prefix){return fs.mkdtempSync(path.join(os.tmpdir(),prefix));}

test('desktop storage initializes in writable user-data directory',()=>{
  const user=temp('mbdesk-user-');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[]});
  assert.equal(out.dataDir,path.join(user,'data'));
  assert.equal(out.migrated,false);
  assert.ok(fs.existsSync(path.join(out.dataDir,'.desktop-storage-v2.json')));
});

test('desktop storage migrates legacy workspace and history once without deleting source',()=>{
  const root=temp('mbdesk-legacy-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(path.join(legacy,'history'),{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspaces.json'),'{"version":2,"projects":[],"profiles":[]}');
  fs.writeFileSync(path.join(legacy,'history','p1.jsonl'),'{"recordedAt":1}\n');
  const first=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(first.migrated,true);
  assert.equal(first.source,path.resolve(legacy));
  assert.ok(fs.existsSync(path.join(user,'data','workspaces.json')));
  assert.ok(fs.existsSync(path.join(user,'data','history','p1.jsonl')));
  assert.ok(fs.existsSync(path.join(legacy,'workspaces.json')));
  const second=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(second.migrated,false);
});

test('desktop storage never merges legacy data into an existing user workspace',()=>{
  const root=temp('mbdesk-safe-'),legacy=path.join(root,'legacy'),user=path.join(root,'user'),dest=path.join(user,'data');
  fs.mkdirSync(legacy,{recursive:true});fs.mkdirSync(dest,{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspaces.json'),'legacy');
  fs.writeFileSync(path.join(dest,'workspaces.json'),'current');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,false);
  assert.equal(fs.readFileSync(path.join(dest,'workspaces.json'),'utf8'),'current');
});

test('desktop launcher starts the v7 backend and keeps loopback dynamic port safety',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop','main.js'),'utf8');
  assert.match(source,/src['"],\s*['"]index-v7\.js/);
  assert.doesNotMatch(source,/src['"],\s*['"]index-v6\.js/);
  assert.match(source,/--data-dir/);
  assert.match(source,/requestSingleInstanceLock/);
  assert.match(source,/server\.listen\(requested,\s*['"]127\.0\.0\.1['"]/);
  assert.match(source,/MODBUS_DESKTOP_PORT/);
  assert.match(source,/return probePort\(0\)/);
  assert.match(source,/contextIsolation:true/);
  assert.match(source,/sandbox:true/);
});
