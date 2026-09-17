'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const sessions=fs.readFileSync(path.join(root,'public/master-sessions-v7.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/master-sessions-v7.css'),'utf8');
const loader=fs.readFileSync(path.join(root,'public/platform-v6.js'),'utf8');

test('monitor sessions load only after the Master workspace exists',()=>{
  assert.match(loader,/master-sessions-v7\.css/);
  const masterIndex=loader.indexOf("master.src='/master-v7.js");
  const onloadIndex=loader.indexOf('master.onload',masterIndex);
  const sessionsIndex=loader.indexOf("sessions.src='/master-sessions-v7.js",onloadIndex);
  assert.ok(masterIndex>=0&&onloadIndex>masterIndex&&sessionsIndex>onloadIndex,'session UI must load after Master');
});

test('saved monitors persist a versioned definition and connection profile locally',()=>{
  assert.match(sessions,/modbus\.master\.monitor-sessions\.v1/);
  assert.match(sessions,/version:1/);
  for(const token of ['unitId','functionCode','address','addressMode','quantity','pollIntervalMs','timeoutMs','baudRate','parity','dataBits','stopBits','host','port','type','scale','offset']){
    assert.ok(sessions.includes(token),`saved monitor must include ${token}`);
  }
  assert.match(sessions,/localStorage\.setItem\(STORAGE_KEY/);
  assert.match(sessions,/beforeunload/);
});

test('monitor switching stops polling and disconnects when the saved connection profile changes',()=>{
  const switchBlock=sessions.slice(sessions.indexOf('async function switchTo'),sessions.indexOf('function renderTabs'));
  assert.match(switchBlock,/stopPollingIfNeeded/);
  assert.match(switchBlock,/disconnectIfConnectionChanges/);
  assert.match(sessions,/fingerprint\(connectionFromDom\(\)\)===fingerprint\(target\.connection\)/);
  assert.match(sessions,/masterDisconnect/);
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
