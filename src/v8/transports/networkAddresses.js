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

module.exports = {
  assertIpAddress,
  assertLocalAddress,
  isWildcardAddress,
  listLocalAddresses,
};
