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

test('desktop storage can recover a legacy workspace backup even when the primary workspace file is missing',()=>{
  const root=temp('mbdesk-backup-only-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspaces.json.bak'),'backup-only');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,true);
  assert.equal(out.source,path.resolve(legacy));
  assert.equal(fs.readFileSync(path.join(user,'data','workspaces.json.bak'),'utf8'),'backup-only');
  assert.ok(fs.existsSync(path.join(legacy,'workspaces.json.bak')));
});

test('desktop storage migrates a Monitor Session recovery backup even when the primary file is missing',()=>{
  const root=temp('mbdesk-monitor-backup-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'master-monitor-sessions.json.bak'),'{"version":1,"activeId":null,"sessions":[]}');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,true);
  assert.equal(out.source,path.resolve(legacy));
  assert.equal(
    fs.readFileSync(path.join(user,'data','master-monitor-sessions.json.bak'),'utf8'),
    '{"version":1,"activeId":null,"sessions":[]}'
  );
});

test('desktop storage migrates durable Master Monitor Sessions and can discover a monitor-only legacy store',()=>{
  const root=temp('mbdesk-monitor-only-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'master-monitor-sessions.json'),'{"version":1,"activeId":null,"sessions":[]}');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,true);
  assert.equal(out.source,path.resolve(legacy));
  assert.equal(
    fs.readFileSync(path.join(user,'data','master-monitor-sessions.json'),'utf8'),
    '{"version":1,"activeId":null,"sessions":[]}'
  );
  assert.ok(fs.existsSync(path.join(legacy,'master-monitor-sessions.json')));
});

test('desktop storage migrates network discovery inventory and its recovery backup',()=>{
  const root=temp('mbdesk-network-discovery-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(legacy,{recursive:true});
  fs.writeFileSync(path.join(legacy,'network-discovery.json'),'{"version":1,"projects":{}}');
  fs.writeFileSync(path.join(legacy,'network-discovery.json.bak'),'{"version":1,"projects":{"backup":{}}}');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,true);
  assert.equal(out.source,path.resolve(legacy));
  assert.equal(fs.readFileSync(path.join(user,'data','network-discovery.json'),'utf8'),'{"version":1,"projects":{}}');
  assert.equal(fs.readFileSync(path.join(user,'data','network-discovery.json.bak'),'utf8'),'{"version":1,"projects":{"backup":{}}}');
  assert.ok(fs.existsSync(path.join(legacy,'network-discovery.json')));
});

test('desktop storage migrates Logger/Trend evidence with the rest of legacy user data',()=>{
  const root=temp('mbdesk-logger-'),legacy=path.join(root,'legacy'),user=path.join(root,'user');
  fs.mkdirSync(path.join(legacy,'logger-trend','samples'),{recursive:true});
  fs.writeFileSync(path.join(legacy,'logger-trend','profiles.json'),'{"profiles":[]}');
  fs.writeFileSync(path.join(legacy,'logger-trend','samples','modbus-1.jsonl'),'{"streamId":"s1","value":1}\n');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,true);
  assert.equal(fs.readFileSync(path.join(user,'data','logger-trend','profiles.json'),'utf8'),'{"profiles":[]}');
  assert.equal(fs.readFileSync(path.join(user,'data','logger-trend','samples','modbus-1.jsonl'),'utf8'),'{"streamId":"s1","value":1}\n');
  assert.ok(fs.existsSync(path.join(legacy,'logger-trend','profiles.json')));
});

test('desktop storage treats existing Logger/Trend data as populated and never merges a legacy workspace into it',()=>{
  const root=temp('mbdesk-logger-safe-'),legacy=path.join(root,'legacy'),user=path.join(root,'user'),dest=path.join(user,'data');
  fs.mkdirSync(legacy,{recursive:true});
  fs.mkdirSync(path.join(dest,'logger-trend'),{recursive:true});
  fs.writeFileSync(path.join(legacy,'workspaces.json'),'legacy');
  fs.writeFileSync(path.join(dest,'logger-trend','profiles.json'),'current-logger-data');
  const out=prepareDesktopDataDir({userDataRoot:user,legacyCandidates:[legacy]});
  assert.equal(out.migrated,false);
  assert.equal(fs.existsSync(path.join(dest,'workspaces.json')),false);
  assert.equal(fs.readFileSync(path.join(dest,'logger-trend','profiles.json'),'utf8'),'current-logger-data');
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
  assert.match(source,/probePort\(18787\)/);
  assert.match(source,/return probePort\(0\)/);
  assert.match(source,/MODBUS_DESKTOP_PORT must be an integer from 1024 to 65535/);
  assert.match(source,/preferences\/bookmarks remain available/);
  assert.match(source,/const child = spawn\(process\.execPath/);
  assert.match(source,/return child/);
  assert.match(source,/waitReady\(selectedPort, child/);
  assert.match(source,/Backend process exited before readiness was confirmed/);
  assert.match(source,/MODBUS_DESKTOP_INSTANCE_TOKEN/);
  assert.match(source,/desktopInstanceToken !== child\.modbusInstanceToken/);
  assert.match(source,/await waitReady\(port, startedBackend\)/);
  assert.match(source,/contextIsolation:true/);
  assert.match(source,/sandbox:true/);
});