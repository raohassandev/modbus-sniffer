'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {prepareDesktopDataDir}=require('../desktop/storage');
const {isAllowedNavigationUrl}=require('../desktop/navigationSafety');

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

test('desktop storage rolls back a partial failed migration so the next launch can retry cleanly',()=>{
  const root=temp('mbdesk-rollback-'),legacy=path.join(root,'legacy'),user=path.join(root,'user'),dest=path.join(user,'data');
  fs.mkdirSync(path.join(legacy,'history'),{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspaces.json'),'legacy-workspace');
  fs.writeFileSync(path.join(legacy,'history','p1.jsonl'),'legacy-history\n');

  assert.throws(
    ()=>prepareDesktopDataDir({
      userDataRoot:user,
      legacyCandidates:[legacy],
      copyTreeImpl:(_src,target)=>{
        fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,'partial');
        throw new Error('simulated migration copy failure');
      }
    }),
    error=>error.code==='DESKTOP_DATA_MIGRATION_FAILED'
  );
  assert.equal(fs.existsSync(path.join(dest,'workspaces.json')),false);
  assert.equal(fs.existsSync(path.join(dest,'history')),false);
  assert.equal(fs.readFileSync(path.join(legacy,'workspaces.json'),'utf8'),'legacy-workspace');

  const retry=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(retry.migrated,true);
  assert.equal(fs.readFileSync(path.join(dest,'workspaces.json'),'utf8'),'legacy-workspace');
  assert.equal(fs.readFileSync(path.join(dest,'history','p1.jsonl'),'utf8'),'legacy-history\n');
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

test('desktop renderer navigation requires the exact loopback origin',()=>{
  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:1234/',1234),true);
  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:1234/help',1234),true);
  assert.equal(isAllowedNavigationUrl('http://127.0.0.1:12345/',1234),false);
  assert.equal(isAllowedNavigationUrl('http://localhost:1234/',1234),false);
  assert.equal(isAllowedNavigationUrl('https://127.0.0.1:1234/',1234),false);
  assert.equal(isAllowedNavigationUrl('not-a-url',1234),false);
});

test('desktop launcher starts the unified backend and keeps loopback dynamic port safety',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop','main.js'),'utf8');
  const navigationSafety=fs.readFileSync(path.join(__dirname,'..','desktop','navigationSafety.js'),'utf8');
  assert.match(source,/src['"],\s*['"]index-v7\.js/);
  assert.doesNotMatch(source,/src['"],\s*['"]index-v8\.js/);
  assert.match(source,/--data-dir/);
  assert.match(source,/--web-host/);
  assert.match(source,/--web-port/);
  assert.match(source,/function healthPath\(\) \{ return '\/api\/status'; \}/);
  assert.match(source,/requestSingleInstanceLock/);
  assert.match(source,/isAllowedNavigationUrl\(url, selectedPort\)/);
  assert.match(navigationSafety,/parsed\.origin === expected\.origin/);
  assert.doesNotMatch(source,/url\.startsWith\(allowed\)/);
  assert.match(source,/server\.listen\(requested,\s*['"]127\.0\.0\.1['"]/);
  assert.match(source,/MODBUS_DESKTOP_PORT/);
  assert.match(source,/return probePort\(0\)/);
  assert.match(source,/contextIsolation:true/);
  assert.match(source,/sandbox:true/);
});