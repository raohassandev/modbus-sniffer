'use strict';

const net = require('node:net');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class HttpSafetyError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'HttpSafetyError';
    this.code = code;
    this.status = status;
    this.details = { ...details };
  }
}

function normalizeHostname(value) {
  return String(value || '').trim().replace(/^\[|\]$/g, '').toLowerCase();
}

function isLoopbackHostname(value) {
  const host = normalizeHostname(value);
  if (host === 'localhost') return true;
  const family = net.isIP(host);
  if (family === 4) return host.startsWith('127.');
  if (family === 6) return host === '::1' || host === '0:0:0:0:0:0:0:1';
  return false;
}

function hostnameFromHostHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try { return normalizeHostname(new URL(`http://${raw}`).hostname); }
  catch { return null; }
}

function requestOrigin(req) {
  const protocol = String(req.protocol || 'http').trim();
  const host = String(req.headers.host || '').trim();
  return host ? `${protocol}://${host}` : null;
}

function originOf(value) {
  if (!value) return null;
  try { return new URL(String(value)).origin; } catch { return null; }
}

function loopbackHostGuard(req, res, next) {
  const hostname = hostnameFromHostHeader(req?.headers?.host);
  if (!hostname || !isLoopbackHostname(hostname)) {
    return res.status(403).json({ ok: false, error: { code: 'NON_LOOPBACK_HOST', message: 'Workbench accepts only loopback Host headers' } });
  }
  return next();
}

function sameOriginMutationGuard(req, res, next) {
  if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return next();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return res.status(403).json({ ok: false, error: { code: 'CROSS_SITE_MUTATION', message: 'Cross-site mutation requests are not allowed' } });
  }
  const expected = requestOrigin(req);
  const supplied = originOf(req.headers.origin) || originOf(req.headers.referer);
  if (supplied && expected && supplied !== expected) {
    return res.status(403).json({ ok: false, error: { code: 'ORIGIN_MISMATCH', message: 'Mutation origin does not match this Workbench instance', details: { expected, supplied } } });
  }
  return next();
}

function webSocketOriginAllowed(request) {
  const hostHeader = String(request?.headers?.host || '').trim();
  const hostName = hostnameFromHostHeader(hostHeader);
  if (!hostName || !isLoopbackHostname(hostName)) return false;
  const rawOrigin = request?.headers?.origin;
  // Non-browser local SDK/automation clients generally do not send Origin.
  if (rawOrigin == null || rawOrigin === '') return true;
  const supplied = originOf(rawOrigin);
  if (!supplied) return false;
  let suppliedHostname = null;
  try { suppliedHostname = normalizeHostname(new URL(supplied).hostname); } catch { return false; }
  if (!isLoopbackHostname(suppliedHostname)) return false;
  const protocol = request?.socket?.encrypted ? 'https' : 'http';
  return supplied === `${protocol}://${hostHeader}`;
}

function createMutationRateLimiter({ windowMs = 60000, max = 240, maxEntries = 10000 } = {}) {
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new TypeError('windowMs must be >= 1000');
  if (!Number.isInteger(max) || max < 1) throw new TypeError('max must be positive');
  const buckets = new Map();
  return function mutationRateLimiter(req, res, next) {
    if (!MUTATION_METHODS.has(String(req.method || '').toUpperCase())) return next();
    const now = Date.now();
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) bucket = { startedAt: now, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > maxEntries) {
      for (const [candidate, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(candidate);
        if (buckets.size <= maxEntries) break;
      }
    }
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, error: { code: 'MUTATION_RATE_LIMIT', message: 'Too many mutation requests', details: { retryAfterSeconds: retryAfter } } });
    }
    return next();
  };
}

function createBodyLengthGuard({ maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new TypeError('maxBytes must be >= 1024');
  return function bodyLengthGuard(req, res, next) {
    const header = req.headers['content-length'];
    if (header != null) {
      const length = Number(header);
      if (!Number.isFinite(length) || length < 0) return res.status(400).json({ ok: false, error: { code: 'INVALID_CONTENT_LENGTH', message: 'Invalid Content-Length header' } });
      if (length > maxBytes) return res.status(413).json({ ok: false, error: { code: 'BODY_TOO_LARGE', message: `Request body exceeds ${maxBytes} bytes`, details: { maxBytes } } });
    }
    return next();
  };
}

module.exports = {
  MUTATION_METHODS,
  HttpSafetyError,
  normalizeHostname,
  isLoopbackHostname,
  hostnameFromHostHeader,
  requestOrigin,
  originOf,
  loopbackHostGuard,
  sameOriginMutationGuard,
  webSocketOriginAllowed,
  createMutationRateLimiter,
  createBodyLengthGuard,
};
