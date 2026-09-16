'use strict';

const net = require('node:net');
const os = require('node:os');

function listLocalAddresses() {
  const rows = [];
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry?.address) continue;
      rows.push(Object.freeze({
        interfaceName,
        address: entry.address,
        family: typeof entry.family === 'string' ? entry.family : entry.family === 6 ? 'IPv6' : 'IPv4',
        internal: Boolean(entry.internal),
        cidr: entry.cidr || null,
      }));
    }
  }
  return Object.freeze(rows);
}

function isWildcardAddress(address) {
  return address === '0.0.0.0' || address === '::';
}

function assertIpAddress(address, field = 'address') {
  if (typeof address !== 'string' || !address.trim()) throw new TypeError(`${field} must be a non-empty IP address`);
  const normalized = address.trim();
  if (!net.isIP(normalized)) throw new TypeError(`${field} must be a valid IPv4 or IPv6 address`);
  return normalized;
}

function assertLocalAddress(address, { allowWildcard = false, field = 'address' } = {}) {
  const normalized = assertIpAddress(address, field);
  if (allowWildcard && isWildcardAddress(normalized)) return normalized;
  const local = listLocalAddresses().some((entry) => entry.address === normalized);
  if (!local) {
    const error = new Error(`${field} ${normalized} is not assigned to this host`);
    error.name = 'NetworkAddressError';
    error.code = 'LOCAL_ADDRESS_NOT_ASSIGNED';
    error.details = { field, address: normalized };
    throw error;
  }
  return normalized;
}

function ipv4ToInt(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;
}

function ipv4SameSubnet(target, cidr) {
  if (typeof cidr !== 'string') return false;
  const [local, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const targetInt = ipv4ToInt(target);
  const localInt = ipv4ToInt(local);
  if (targetInt == null || localInt == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  return (targetInt & mask) === (localInt & mask);
}

function recommendLocalAddress(targetAddress, addresses = listLocalAddresses()) {
  const target = typeof targetAddress === 'string' ? targetAddress.trim() : '';
  const familyNumber = net.isIP(target);
  if (!familyNumber) return null;
  const family = familyNumber === 6 ? 'IPv6' : 'IPv4';
  const candidates = (addresses || []).filter((entry) => entry?.address && entry.family === family);
  if (!candidates.length) return null;

  let selected = null;
  let reason = 'family-match';
  if (familyNumber === 4) {
    selected = candidates.find((entry) => !entry.internal && ipv4SameSubnet(target, entry.cidr))
      || candidates.find((entry) => ipv4SameSubnet(target, entry.cidr));
    if (selected) reason = 'same-subnet';
  }
  selected ||= candidates.find((entry) => !entry.internal) || candidates[0];

  return Object.freeze({
    targetAddress: target,
    address: selected.address,
    interfaceName: selected.interfaceName || null,
    family: selected.family,
    cidr: selected.cidr || null,
    internal: Boolean(selected.internal),
    reason,
  });
}

module.exports = {
  assertIpAddress,
  assertLocalAddress,
  isWildcardAddress,
  ipv4SameSubnet,
  ipv4ToInt,
  listLocalAddresses,
  recommendLocalAddress,
};
