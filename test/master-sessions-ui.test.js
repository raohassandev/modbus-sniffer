'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const sessions=fs.readFileSync(path.join(root,'public/master-sessions-v7.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/master-sessions-v7.css'),'utf8');
const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');

test('monitor sessions source parses as JavaScript',()=>{
  assert.doesNotThrow(()=>new vm.Script(sessions,{filename:'master-sessions-v7.js'}));
});

test('monitor sessions load only after the Master workspace exists',()=>{
  assert.match(loader,/master-sessions-v7\.css/);
  const masterIndex=loader.indexOf("master.src='/master-v7.js");
  const onloadIndex=loader.indexOf('master.onload',masterIndex);
  const sessionsIndex=loader.indexOf("sessions.src='/master-sessions-v7.js",onloadIndex);
  assert.ok(masterIndex>=0&&onloadIndex>masterIndex&&sessionsIndex>onloadIndex,'session UI must load after Master');
});

test('saved monitors persist a versioned definition and connection profile across desktop port changes',()=>{
  assert.match(sessions,/modbus\.master\.monitor-sessions\.v1/);
  assert.match(sessions,/version:1/);
  for(const token of ['unitId','functionCode','address','addressMode','quantity','pollIntervalMs','timeoutMs','baudRate','parity','dataBits','stopBits','host','port','type','scale','offset']){
    assert.ok(sessions.includes(token),`saved monitor must include ${token}`);
  }
  assert.match(sessions,/localStorage\.setItem\(STORAGE_KEY/);
  assert.match(sessions,/\/api\/master\/monitor-sessions/);
  assert.match(sessions,/method:'PUT'/);
  assert.match(sessions,/loadRemoteStore/);
  assert.match(sessions,/navigator\.sendBeacon/);
  assert.match(sessions,/browser fallback/);
  assert.match(sessions,/beforeunload/);
});

test('Monitor Sessions never persist or restore rendered field HTML',()=>{
  const snapshotBlock=sessions.slice(sessions.indexOf('function snapshotFromDom'),sessions.indexOf('function buildSession'));
  const restoreBlock=sessions.slice(sessions.indexOf('function restoreSnapshot'),sessions.indexOf('function applyDefinition'));
  assert.match(snapshotBlock,/rowsHtml:''/);
  assert.doesNotMatch(snapshotBlock,/masterDataBody'\)\?\.innerHTML/);
  assert.doesNotMatch(restoreBlock,/snap\.rowsHtml/);
  assert.match(restoreBlock,/Saved monitor loaded\. Press Read Once or Start Polling/);
});

test('monitor switching stops polling and disconnects when the saved connection profile changes',()=>{
  const switchBlock=sessions.slice(sessions.indexOf('async function switchTo'),sessions.indexOf('function renderTabs'));
  assert.match(switchBlock,/stopPollingIfNeeded/);
  assert.match(switchBlock,/disconnectIfConnectionChanges/);
  assert.match(sessions,/fingerprint\(connectionFromDom\(\)\)===fingerprint\(target\.connection\)/);
  assert.match(sessions,/masterDisconnect/);
  assert.match(sessions,/\{force=false\}/);
  assert.match(sessions,/switchTo\(tab\.dataset\.sessionId,\{force:true\}\)/);
});

test('delete safely disconnects before applying a different saved connection profile',()=>{
  const block=sessions.slice(sessions.indexOf("els.delete.addEventListener"),sessions.indexOf('for(const id of monitoredIds)'));
  assert.match(block,/stopPollingIfNeeded/);
  assert.match(block,/disconnectIfConnectionChanges\(next\)/);
  assert.ok(block.indexOf('disconnectIfConnectionChanges(next)')<block.indexOf('store.sessions.splice'),'disconnect must happen before deleting/applying the next session');
});

test('remote Monitor Session state is loaded before the initial monitor is applied',()=>{
  const block=sessions.slice(sessions.indexOf('async function ensureInitial'),sessions.indexOf("els.tabs.addEventListener"));
  assert.match(block,/await loadRemoteStore\(\)/);
  assert.match(block,/store=remote/);
  assert.match(block,/localStorage\.setItem\(STORAGE_KEY/);
  assert.ok(block.indexOf('await loadRemoteStore()')<block.indexOf('applyDefinition(active())'));
});

test('reload does not silently overwrite a different already-live Master connection profile',()=>{
  const block=sessions.slice(sessions.indexOf('async function ensureInitial'),sessions.indexOf("els.tabs.addEventListener"));
  assert.match(block,/\/api\/master\/status/);
  assert.match(block,/runtimeStatus\?\.connected/);
  assert.match(block,/fingerprint\(runtimeStatus\.config\)!==fingerprint\(active\(\)\.connection\)/);
  assert.match(block,/different profile/);
});

test('sessions expose familiar New Save Duplicate Rename Delete and tab workflow',()=>{
  for(const token of ['Monitor Sessions','＋ New','Save Session','Duplicate','Rename','Delete','role="tablist"','data-session-id']){
    assert.ok(sessions.includes(token),`sessions UI must contain ${token}`);
  }
  assert.match(sessions,/function buildSession/);
  assert.match(sessions,/function captureInto/);
  assert.match(sessions,/function applyDefinition/);
  assert.match(sessions,/function restoreSnapshot/);
});

test('session UI is scoped and responsive',()=>{
  assert.match(css,/\.master-session-bar/);
  assert.match(css,/\.master-session-tabs/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.doesNotMatch(css,/(^|\n)(body|\.sidebar|\.workspace)\s*\{/);
});
