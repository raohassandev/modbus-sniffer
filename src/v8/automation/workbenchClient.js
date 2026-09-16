'use strict';

const net = require('node:net');

class WorkbenchClientError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkbenchClientError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, WorkbenchClientError);
  }
}

function isLoopback(hostname) {
  if (hostname === 'localhost') return true;
  const ip = net.isIP(hostname);
  if (ip === 4) return hostname.startsWith('127.');
  if (ip === 6) return hostname === '::1' || hostname === '0:0:0:0:0:0:0:1';
  return false;
}

function normalizeBaseUrl(value, { allowRemote = false } = {}) {
  let url;
  try { url = new URL(value || 'http://127.0.0.1:8088'); } catch {
    throw new WorkbenchClientError('INVALID_BASE_URL', 'Workbench base URL is invalid', { value });
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new WorkbenchClientError('INVALID_BASE_URL', 'Workbench base URL must use HTTP or HTTPS');
  if (!allowRemote && !isLoopback(url.hostname)) {
    throw new WorkbenchClientError('REMOTE_API_DISABLED', 'Remote automation endpoints are disabled by default; explicitly opt in to a trusted remote endpoint', { hostname: url.hostname });
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

class WorkbenchApiClient {
  constructor({ baseUrl = 'http://127.0.0.1:8088', allowRemote = false, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.baseUrl = normalizeBaseUrl(baseUrl, { allowRemote });
    this.fetch = fetchImpl;
  }

  async request(method, pathname, body = undefined) {
    const url = new URL(pathname, this.baseUrl);
    const response = await this.fetch(url, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { ok: false, error: { code: 'INVALID_JSON_RESPONSE', message: text.slice(0, 1000) } }; }
    }
    if (!response.ok || payload?.ok === false) {
      const source = payload?.error || {};
      throw new WorkbenchClientError(source.code || `HTTP_${response.status}`, source.message || `Workbench API returned HTTP ${response.status}`, {
        status: response.status,
        ...(source.details || {}),
      });
    }
    return payload;
  }

  status() { return this.request('GET', '/api/v8/status'); }
  listConnections() { return this.request('GET', '/api/v8/connections'); }
  openConnection(connectionId, ownerMode = 'master') { return this.request('POST', `/api/v8/connections/${encodeURIComponent(connectionId)}/open`, { ownerMode }); }
  closeConnection(connectionId) { return this.request('POST', `/api/v8/connections/${encodeURIComponent(connectionId)}/close`, {}); }
  testConnection(connectionId) { return this.request('POST', `/api/v8/connections/${encodeURIComponent(connectionId)}/test`, {}); }
  read(spec) { return this.request('POST', '/api/v8/master/read', spec); }

  write(spec, { confirmed = false, bulk = false, broadcast = false } = {}) {
    if (confirmed !== true) throw new WorkbenchClientError('CONFIRMATION_REQUIRED', 'Automation writes require explicit confirmed=true');
    const functionCode = Number(spec?.functionCode);
    const isBulk = [15, 16, 23].includes(functionCode);
    const isBroadcast = Number(spec?.unitId) === 0;
    if (isBulk && bulk !== true) throw new WorkbenchClientError('BULK_CONFIRMATION_REQUIRED', 'Bulk writes require bulk=true confirmation');
    if (isBroadcast && broadcast !== true) throw new WorkbenchClientError('BROADCAST_CONFIRMATION_REQUIRED', 'Broadcast writes require broadcast=true confirmation');
    return this.request('POST', '/api/v8/master/write', {
      ...spec,
      confirmation: { confirmed: true, bulk: Boolean(bulk), broadcast: Boolean(broadcast) },
    });
  }

  listJobs() { return this.request('GET', '/api/v8/master/jobs'); }
  readJob(jobId) { return this.request('POST', `/api/v8/master/jobs/${encodeURIComponent(jobId)}/read`, {}); }
  startScheduler(connectionId) { return this.request('POST', `/api/v8/master/runtime/${encodeURIComponent(connectionId)}/start`, {}); }
  stopScheduler(connectionId) { return this.request('POST', `/api/v8/master/runtime/${encodeURIComponent(connectionId)}/stop`, {}); }
  listSimulator() { return this.request('GET', '/api/v8/simulator'); }
  startSimulator(serverId) { return this.request('POST', `/api/v8/simulator/servers/${encodeURIComponent(serverId)}/start`, {}); }
  stopSimulator(serverId) { return this.request('POST', `/api/v8/simulator/servers/${encodeURIComponent(serverId)}/stop`, {}); }
  runRecipe(recipe, options = {}) { return this.request('POST', '/api/v8/test-center/recipe/run', { recipe, ...options }); }
  listDigitalTwins() { return this.request('GET', '/api/v8/digital-twins'); }
  applyDigitalTwin(twinId, options = {}) { return this.request('POST', `/api/v8/digital-twins/${encodeURIComponent(twinId)}/apply`, options); }
  approveDigitalTwin(twinId, { confirmed = false } = {}) {
    if (!confirmed) throw new WorkbenchClientError('CONFIRMATION_REQUIRED', 'Digital twin approval requires explicit confirmation');
    return this.request('POST', `/api/v8/digital-twins/${encodeURIComponent(twinId)}/approve`, { confirmed: true });
  }
}

module.exports = {
  WorkbenchApiClient,
  WorkbenchClientError,
  isLoopback,
  normalizeBaseUrl,
};
