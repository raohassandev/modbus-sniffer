'use strict';

const crypto = require('crypto');
const net = require('net');

function text(v) { return v == null ? '' : String(v).trim(); }
function norm(v) { return text(v).toLowerCase(); }
function token(v) { return norm(v).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'unknown'; }
function shortHash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 16); }

function normalizeHost(value) {
  let host = norm(value);
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host) return '';
  // IPv6 is case-insensitive. Full RFC5952 canonicalization is intentionally not
  // attempted here; brackets/case are normalized and the endpoint remains explicit.
  return host;
}

function normalizeEndpoint(host, port = 502) {
  const h = normalizeHost(host);
  const p = Number(port);
  if (!h) throw new Error('TCP host is required.');
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('TCP port must be 1..65535.');
  return `${net.isIP(h) === 6 ? `[${h}]` : h}:${p}`;
}

function rtuIdentityToken(identity = {}, port = '') {
  if (text(identity.serialNumber)) return `sn-${token(identity.serialNumber)}`;
  if (text(identity.pnpId)) return `pnp-${shortHash(norm(identity.pnpId))}`;
  // Do not identify by VID/PID alone: replacing an adapter with another identical
  // model must not silently inherit the previous channel's engineering data.
  return `path-${token(port || identity.path || 'unassigned')}`;
}

function buildRtuChannel({ port = '', identity = null, config = {}, mode = 'passive', name = null } = {}) {
  const id = identity || {};
  const stable = rtuIdentityToken(id, port);
  const channelId = `rtu:${stable}`;
  const serial = {
    port: text(port || id.path),
    baudRate: Number(config.baudRate) || null,
    parity: text(config.parity || 'none').toLowerCase(),
    dataBits: Number(config.dataBits) || null,
    stopBits: Number(config.stopBits) || null,
    adapter: {
      serialNumber: text(id.serialNumber), vendorId: text(id.vendorId), productId: text(id.productId),
      manufacturer: text(id.manufacturer), pnpId: text(id.pnpId)
    }
  };
  return {
    channelId,
    transport: 'RTU',
    mode,
    name: name || (serial.port ? `RTU ${serial.port}` : 'RTU channel'),
    endpoint: serial.port || null,
    serial,
    active: true
  };
}

function buildTcpChannel({ targetHost, targetPort = 502, mode = 'proxy', name = null } = {}) {
  const endpoint = normalizeEndpoint(targetHost, targetPort);
  const channelId = `tcp:${mode}:${shortHash(endpoint)}`;
  return {
    channelId,
    transport: 'TCP',
    mode,
    name: name || `TCP ${endpoint}`,
    endpoint,
    tcp: { host: normalizeHost(targetHost), port: Number(targetPort) },
    active: true
  };
}

function fallbackChannel(transport = 'RTU') {
  const t = String(transport || 'RTU').toUpperCase() === 'TCP' ? 'TCP' : 'RTU';
  return t === 'TCP'
    ? { channelId:'tcp:legacy', transport:'TCP', mode:'offline', name:'Legacy TCP', endpoint:null, active:false }
    : { channelId:'rtu:legacy', transport:'RTU', mode:'offline', name:'Legacy RTU', endpoint:null, active:false };
}

function validUnitId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

function makeDeviceKey(channelId, unitId) {
  if (!text(channelId)) throw new Error('channelId is required.');
  if (!validUnitId(unitId)) throw new Error('Unit ID must be 0..255.');
  return `${text(channelId)}|${Number(unitId)}`;
}

function parseDeviceKey(value) {
  const s = text(value);
  const i = s.lastIndexOf('|');
  if (i <= 0) return null;
  const channelId = s.slice(0, i), unitId = Number(s.slice(i + 1));
  if (!channelId || !validUnitId(unitId)) return null;
  return { channelId, unitId, deviceKey: makeDeviceKey(channelId, unitId) };
}

function normalizeIdentity({ transport = 'RTU', channel = null, channelId = null, unitId = null, slaveId = null, deviceKey = null } = {}) {
  const t = String(transport || channel?.transport || 'RTU').toUpperCase() === 'TCP' ? 'TCP' : 'RTU';
  const parsed = deviceKey ? parseDeviceKey(deviceKey) : null;
  const ch = channel || (channelId || parsed?.channelId ? { ...fallbackChannel(t), channelId: channelId || parsed.channelId } : fallbackChannel(t));
  const uid = unitId ?? slaveId ?? parsed?.unitId;
  if (!validUnitId(uid)) throw new Error('Transaction is missing a valid Unit/Slave ID.');
  const key = makeDeviceKey(ch.channelId, uid);
  return { transport:t, channel:ch, channelId:ch.channelId, unitId:Number(uid), slaveId:Number(uid), deviceKey:key };
}

module.exports = {
  normalizeHost, normalizeEndpoint, buildRtuChannel, buildTcpChannel, fallbackChannel,
  makeDeviceKey, parseDeviceKey, normalizeIdentity, validUnitId
};
