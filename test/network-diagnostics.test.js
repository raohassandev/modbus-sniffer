'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {requireIp,tracerouteCommand,parseTraceroute}=require('../src/networkDiscovery/diagnostics');

test('network diagnostics accept only discovered IP literals',()=>{
  assert.equal(requireIp('192.168.1.10'),'192.168.1.10');
  assert.equal(requireIp('fd00::1'),'fd00::1');
  assert.throws(()=>requireIp('plc.local'),e=>e?.code==='NETWORK_DIAGNOSTIC_IP_REQUIRED');
});

test('traceroute command is bounded to safe hop and timeout limits',()=>{
  const cmd=tracerouteCommand('192.168.1.10',{maxHops:999,perHopTimeoutMs:99999});
  assert.ok(['traceroute','tracert'].includes(cmd.command));
  assert.equal(cmd.args.includes('192.168.1.10'),true);
  const joined=cmd.args.join(' ');
  assert.match(joined,/64/);
});

test('traceroute parser retains hop address timing and timeout evidence',()=>{
  const unix=parseTraceroute(' 1  192.168.1.1  1.10 ms  1.20 ms  1.30 ms\n 2  * * *\n 3  10.0.0.1  4.5 ms\n');
  assert.equal(unix.length,3);
  assert.equal(unix[0].ip,'192.168.1.1');
  assert.deepEqual(unix[0].timesMs,[1.10,1.20,1.30]);
  assert.equal(unix[1].timeout,true);
  assert.equal(unix[2].ip,'10.0.0.1');
});
