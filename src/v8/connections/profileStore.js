'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const PROFILE_KINDS = Object.freeze(['serial-rtu', 'serial-ascii', 'tcp-client', 'tcp-server']);

class ConnectionProfileError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectionProfileError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ConnectionProfileError);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function profileId() {
  return `conn-${crypto.randomUUID()}`;
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new ConnectionProfileError('INVALID_PROFILE', `${field} is required`, { field });
  return value.trim();
}

function integer(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ConnectionProfileError('INVALID_PROFILE', `${field} must be ${min}..${max}`, { field, value });
  return value;
}

function serialDefaults(kind, config = {}) {
  const framing = kind === 'serial-ascii' ? 'ascii' : 'rtu';
  return {
    path: nonEmpty(config.path, 'config.path'),
    baudRate: integer(config.baudRate ?? 9600, 50, 4000000, 'config.baudRate'),
    dataBits: [5, 6, 7, 8].includes(config.dataBits ?? 8) ? (config.dataBits ?? 8) : (() => { throw new ConnectionProfileError('INVALID_PROFILE', 'config.dataBits must be 5..8'); })(),
    stopBits: [1, 1.5, 2].includes(config.stopBits ?? 1) ? (config.stopBits ?? 1) : (() => { throw new ConnectionProfileError('INVALID_PROFILE', 'config.stopBits must be 1, 1.5 or 2'); })(),
    parity: ['none', 'even', 'odd', 'mark', 'space'].includes(config.parity ?? 'none') ? (config.parity ?? 'none') : (() => { throw new ConnectionProfileError('INVALID_PROFILE', 'unsupported parity'); })(),
    rtscts: Boolean(config.rtscts),
    xon: Boolean(config.xon),
    xoff: Boolean(config.xoff),
    xany: Boolean(config.xany),
    rtsTxMode: ['none', 'high-during-tx', 'low-during-tx'].includes(config.rtsTxMode ?? 'none') ? (config.rtsTxMode ?? 'none') : (() => { throw new ConnectionProfileError('INVALID_PROFILE', 'unsupported rtsTxMode'); })(),
    rtsSettleMs: Number.isFinite(config.rtsSettleMs) && config.rtsSettleMs >= 0 ? config.rtsSettleMs : 0,
    echoSuppression: Boolean(config.echoSuppression),
    writeTimeoutMs: Number.isFinite(config.writeTimeoutMs) && config.writeTimeoutMs > 0 ? config.writeTimeoutMs : 3000,
    framing,
  };
}

function tcpClientDefaults(config = {}) {
  return {
    host: nonEmpty(config.host, 'config.host'),
    port: integer(config.port ?? 502, 1, 65535, 'config.port'),
    localAddress: config.localAddress == null || config.localAddress === '' ? null : nonEmpty(config.localAddress, 'config.localAddress'),
    family: [0, 4, 6].includes(config.family ?? 0) ? (config.family ?? 0) : 0,
    connectTimeoutMs: Number.isFinite(config.connectTimeoutMs) && config.connectTimeoutMs > 0 ? config.connectTimeoutMs : 3000,
    idleTimeoutMs: Number.isFinite(config.idleTimeoutMs) && config.idleTimeoutMs >= 0 ? config.idleTimeoutMs : 0,
    writeTimeoutMs: Number.isFinite(config.writeTimeoutMs) && config.writeTimeoutMs > 0 ? config.writeTimeoutMs : 3000,
    reconnect: {
      enabled: Boolean(config.reconnect?.enabled),
      maxAttempts: Number.isInteger(config.reconnect?.maxAttempts) && config.reconnect.maxAttempts >= 0 ? config.reconnect.maxAttempts : 5,
      initialDelayMs: Number.isFinite(config.reconnect?.initialDelayMs) && config.reconnect.initialDelayMs >= 0 ? config.reconnect.initialDelayMs : 100,
      maxDelayMs: Number.isFinite(config.reconnect?.maxDelayMs) && config.reconnect.maxDelayMs >= 0 ? config.reconnect.maxDelayMs : 2000,
    },
  };
}

function tcpServerDefaults(config = {}) {
  return {
    host: nonEmpty(config.host ?? '127.0.0.1', 'config.host'),
    port: integer(config.port ?? 502, 0, 65535, 'config.port'),
    maxClients: integer(config.maxClients ?? 64, 1, 10000, 'config.maxClients'),
    idleTimeoutMs: Number.isFinite(config.idleTimeoutMs) && config.idleTimeoutMs >= 0 ? config.idleTimeoutMs : 0,
    writeTimeoutMs: Number.isFinite(config.writeTimeoutMs) && config.writeTimeoutMs > 0 ? config.writeTimeoutMs : 3000,
  };
}

function normalizeProfile(input, { preserveTimestamps = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionProfileError('INVALID_PROFILE', 'Profile must be an object');
  const kind = nonEmpty(input.kind, 'kind');
  if (!PROFILE_KINDS.includes(kind)) throw new ConnectionProfileError('INVALID_PROFILE_KIND', `Unsupported connection profile kind ${kind}`, { kind });
  const now = Date.now();
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : profileId();
  const name = nonEmpty(input.name ?? kind, 'name');
  const config = kind.startsWith('serial-') ? serialDefaults(kind, input.config)
    : kind === 'tcp-client' ? tcpClientDefaults(input.config)
      : tcpServerDefaults(input.config);
  const createdAt = preserveTimestamps && Number.isFinite(input.createdAt) ? input.createdAt : now;
  const updatedAt = preserveTimestamps && Number.isFinite(input.updatedAt) ? input.updatedAt : now;
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    kind,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    enabled: input.enabled !== false,
    tags: Object.freeze(Array.isArray(input.tags) ? [...new Set(input.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim()))] : []),
    config: Object.freeze(config),
    createdAt,
    updatedAt,
  });
}

class ConnectionProfileStore {
  constructor({ filePath = null } = {}) {
    this.filePath = filePath;
    this.profiles = new Map();
  }

  create(input) {
    const profile = normalizeProfile(input);
    if (this.profiles.has(profile.id)) throw new ConnectionProfileError('PROFILE_EXISTS', `Connection profile ${profile.id} already exists`, { id: profile.id });
    this.profiles.set(profile.id, profile);
    return profile;
  }

  update(id, patch = {}) {
    const current = this.get(id);
    const updated = normalizeProfile({
      ...clone(current),
      ...patch,
      id: current.id,
      kind: patch.kind ?? current.kind,
      config: patch.config ? { ...clone(current.config), ...patch.config } : clone(current.config),
      createdAt: current.createdAt,
      updatedAt: Date.now(),
    }, { preserveTimestamps: true });
    this.profiles.set(id, updated);
    return updated;
  }

  remove(id) {
    const current = this.get(id);
    this.profiles.delete(id);
    return current;
  }

  clone(id, { name = null } = {}) {
    const current = this.get(id);
    return this.create({
      ...clone(current),
      id: profileId(),
      name: name || `${current.name} Copy`,
      createdAt: undefined,
      updatedAt: undefined,
    });
  }

  get(id) {
    const profile = this.profiles.get(id);
    if (!profile) throw new ConnectionProfileError('PROFILE_NOT_FOUND', `Unknown connection profile ${id}`, { id });
    return profile;
  }

  list() {
    return Object.freeze([...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  exportJson({ pretty = true } = {}) {
    return JSON.stringify({ schemaVersion: SCHEMA_VERSION, profiles: this.list().map(clone) }, null, pretty ? 2 : 0);
  }

  importJson(text, { mode = 'replace' } = {}) {
    if (!['replace', 'merge'].includes(mode)) throw new ConnectionProfileError('INVALID_IMPORT_MODE', 'Import mode must be replace or merge');
    let parsed;
    try { parsed = JSON.parse(String(text)); } catch (error) { throw new ConnectionProfileError('INVALID_JSON', error.message); }
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.profiles)) throw new ConnectionProfileError('INVALID_SCHEMA', `Connection profile file must use schemaVersion ${SCHEMA_VERSION}`);
    const incoming = new Map();
    for (const raw of parsed.profiles) {
      const profile = normalizeProfile(raw, { preserveTimestamps: true });
      if (incoming.has(profile.id)) throw new ConnectionProfileError('DUPLICATE_PROFILE_ID', `Duplicate profile ${profile.id} in import`);
      incoming.set(profile.id, profile);
    }
    if (mode === 'replace') this.profiles = incoming;
    else for (const [id, profile] of incoming) this.profiles.set(id, profile);
    return this.list();
  }

  async load() {
    if (!this.filePath) return this.list();
    try {
      const text = await fs.readFile(this.filePath, 'utf8');
      this.importJson(text, { mode: 'replace' });
    } catch (error) {
      if (error.code === 'ENOENT') return this.list();
      throw error;
    }
    return this.list();
  }

  async save() {
    if (!this.filePath) throw new ConnectionProfileError('NO_FILE_PATH', 'Profile store has no persistence file path');
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${this.exportJson({ pretty: true })}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, this.filePath);
    return this.filePath;
  }
}

module.exports = {
  SCHEMA_VERSION,
  PROFILE_KINDS,
  ConnectionProfileError,
  ConnectionProfileStore,
  normalizeProfile,
};
