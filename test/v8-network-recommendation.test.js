'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ipv4SameSubnet, recommendLocalAddress } = require('../src/v8/transports/networkAddresses');

test('v8 IPv4 subnet matcher handles prefix boundaries deterministically', () => {
  assert.equal(ipv4SameSubnet('192.168.10.50', '192.168.10.4/24'), true);
  assert.equal(ipv4SameSubnet('192.168.11.50', '192.168.10.4/24'), false);
  assert.equal(ipv4SameSubnet('10.15.31.1', '10.15.16.10/20'), true);
  assert.equal(ipv4SameSubnet('10.15.32.1', '10.15.16.10/20'), false);
});

test('v8 local interface recommendation prefers same-subnet non-internal IPv4 interface', () => {
  const addresses = [
    { interfaceName: 'Loopback', address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' },
    { interfaceName: 'Plant LAN', address: '172.18.0.19', family: 'IPv4', internal: false, cidr: '172.18.0.19/24' },
    { interfaceName: 'Office LAN', address: '192.168.1.20', family: 'IPv4', internal: false, cidr: '192.168.1.20/24' },
  ];
  const recommendation = recommendLocalAddress('172.18.0.55', addresses);
  assert.equal(recommendation.address, '172.18.0.19');
  assert.equal(recommendation.interfaceName, 'Plant LAN');
  assert.equal(recommendation.reason, 'same-subnet');
});

test('v8 local interface recommendation falls back safely by address family', () => {
  const addresses = [
    { interfaceName: 'LAN', address: '10.0.0.2', family: 'IPv4', internal: false, cidr: '10.0.0.2/24' },
    { interfaceName: 'v6', address: '2001:db8::2', family: 'IPv6', internal: false, cidr: '2001:db8::2/64' },
  ];
  assert.equal(recommendLocalAddress('192.0.2.20', addresses).address, '10.0.0.2');
  assert.equal(recommendLocalAddress('2001:db8::50', addresses).address, '2001:db8::2');
  assert.equal(recommendLocalAddress('not-an-ip', addresses), null);
});
