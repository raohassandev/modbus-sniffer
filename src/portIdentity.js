'use strict';

function norm(v) {
  return v === undefined || v === null ? '' : String(v).trim().toLowerCase();
}

function buildIdentity(port) {
  if (!port) return null;
  return {
    path: port.path || '',
    serialNumber: port.serialNumber || '',
    vendorId: port.vendorId || '',
    productId: port.productId || '',
    manufacturer: port.manufacturer || '',
    pnpId: port.pnpId || ''
  };
}

function sameUsbId(a, b) {
  return norm(a.vendorId) && norm(a.productId) &&
    norm(a.vendorId) === norm(b.vendorId) &&
    norm(a.productId) === norm(b.productId);
}

function findReboundPort(ports, identity) {
  if (!identity || !Array.isArray(ports) || !ports.length) return null;

  if (identity.serialNumber) {
    const serialMatches = ports.filter(p => norm(p.serialNumber) === norm(identity.serialNumber));
    if (serialMatches.length === 1) return serialMatches[0];
  }

  if (identity.pnpId) {
    const pnpMatches = ports.filter(p => norm(p.pnpId) === norm(identity.pnpId));
    if (pnpMatches.length === 1) return pnpMatches[0];
  }

  if (identity.vendorId && identity.productId) {
    const usbMatches = ports.filter(p => sameUsbId(p, identity));
    if (usbMatches.length === 1) return usbMatches[0];
  }

  if (identity.manufacturer) {
    const makerMatches = ports.filter(p => norm(p.manufacturer) === norm(identity.manufacturer));
    if (makerMatches.length === 1) return makerMatches[0];
  }

  return null;
}

module.exports = { buildIdentity, findReboundPort };
