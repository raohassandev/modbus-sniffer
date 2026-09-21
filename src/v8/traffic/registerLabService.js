'use strict';

const { EventEmitter } = require('node:events');
const protocol = require('../protocol');
const registerCodec = require('../../register/registerCodec');

const READ_AREAS = Object.freeze({
  [protocol.FC.READ_COILS]: 'coils',
  [protocol.FC.READ_DISCRETE_INPUTS]: 'discreteInputs',
  [protocol.FC.READ_HOLDING_REGISTERS]: 'holdingRegisters',
  [protocol.FC.READ_INPUT_REGISTERS]: 'inputRegisters',
});

const TYPE_WORDS = registerCodec.TYPE_WORDS;
const VALID_TYPES = registerCodec.VALID_TYPES;

class RegisterLabError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RegisterLabError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, RegisterLabError);
  }
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current));
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointKey({ connectionId, unitId, area, address }) {
  return JSON.stringify([String(connectionId || ''), Number(unitId), String(area), Number(address)]);
}

function wordsToBuffer(words) {
  const out = Buffer.alloc(words.length * 2);
  words.forEach((word, index) => out.writeUInt16BE(Number(word) & 0xFFFF, index * 2));
  return out;
}

function jsonValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function framingFromEvent(event) {
  const explicit = String(event?.details?.framing || '').toLowerCase();
  if (['rtu', 'ascii', 'tcp'].includes(explicit)) return explicit;
  const raw = Buffer.from(String(event?.rawHex || ''), 'hex');
  if (raw[0] === 0x3A) return 'ascii';
  if (raw.length >= 8 && raw.readUInt16BE(2) === 0) {
    const length = raw.readUInt16BE(4);
    if (length >= 2 && 6 + length === raw.length) return 'tcp';
  }
  return 'rtu';
}

function decodeAdu(event) {
  const rawHex = String(event?.rawHex || '').replace(/\s+/g, '');
  if (!rawHex || rawHex.length % 2) return null;
  const raw = Buffer.from(rawHex, 'hex');
  const framing = framingFromEvent(event);
  try {
    if (framing === 'tcp') return { framing, ...protocol.decodeTcpAdu(raw) };
    if (framing === 'ascii') return { framing, ...protocol.decodeAsciiAdu(raw) };
    return { framing, ...protocol.decodeRtuAdu(raw) };
  } catch {
    return null;
  }
}

function normalizeDefinition(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RegisterLabError('INVALID_DEFINITION', 'Register definition must be an object');
  const sourceKey = String(input.sourceKey ?? existing?.sourceKey ?? '').trim();
  if (!sourceKey) throw new RegisterLabError('INVALID_DEFINITION', 'sourceKey is required');
  const type = String(input.type ?? existing?.type ?? 'uint16');
  if (!VALID_TYPES.has(type)) throw new RegisterLabError('INVALID_DEFINITION', `Unsupported type ${type}`, { type });
  const scale = safeNumber(input.scale ?? existing?.scale ?? 1, 1);
  const offset = safeNumber(input.offset ?? existing?.offset ?? 0, 0);
  const precision = Math.max(0, Math.min(12, Number.isInteger(Number(input.precision ?? existing?.precision)) ? Number(input.precision ?? existing?.precision) : 3));
  const byteOrder = input.byteOrder == null ? (existing?.byteOrder ?? null) : String(input.byteOrder || '').toUpperCase().replace(/[^A-Z]/g, '') || null;
  const limitsInput = input.limits && typeof input.limits === 'object' ? input.limits : existing?.limits;
  const limits = limitsInput ? {
    min: limitsInput.min == null || limitsInput.min === '' ? null : safeNumber(limitsInput.min, null),
    max: limitsInput.max == null || limitsInput.max === '' ? null : safeNumber(limitsInput.max, null),
  } : null;
  return Object.freeze({
    sourceKey,
    name: String(input.name ?? existing?.name ?? '').slice(0, 200),
    type,
    byteOrder,
    scale,
    offset,
    precision,
    unit: String(input.unit ?? existing?.unit ?? '').slice(0, 80),
    enum: input.enum && typeof input.enum === 'object' && !Array.isArray(input.enum) ? clone(input.enum) : clone(existing?.enum || {}),
    bitfield: input.bitfield && typeof input.bitfield === 'object' && !Array.isArray(input.bitfield) ? clone(input.bitfield) : clone(existing?.bitfield || {}),
    limits,
    notes: String(input.notes ?? existing?.notes ?? '').slice(0, 4000),
    provenance: input.provenance && typeof input.provenance === 'object' && !Array.isArray(input.provenance) ? clone(input.provenance) : clone(existing?.provenance || {}),
    updatedAt: new Date().toISOString(),
  });
}

class RegisterLabService extends EventEmitter {
  constructor({ store = null, broker = null, maxPoints = 100000, maxPending = 4096 } = {}) {
    super();
    if (!Number.isInteger(maxPoints) || maxPoints < 1) throw new TypeError('maxPoints must be a positive integer');
    if (!Number.isInteger(maxPending) || maxPending < 1) throw new TypeError('maxPending must be a positive integer');
    this.store = store;
    this.broker = broker;
    this.maxPoints = maxPoints;
    this.maxPending = maxPending;
    this.points = new Map();
    this.pending = new Map();
    this.sequence = 0;
  }

  ingest(event) {
    if (!event || !['traffic.tx', 'traffic.rx'].includes(event.type) || !event.rawHex) return null;
    const adu = decodeAdu(event);
    if (!adu?.pdu?.length) return null;
    const ownerMode = String(event.ownerMode || '').toLowerCase();
    const isRequest = (ownerMode === 'master' && event.direction === 'tx') || (ownerMode === 'slave' && event.direction === 'rx');
    const isResponse = (ownerMode === 'master' && event.direction === 'rx') || (ownerMode === 'slave' && event.direction === 'tx');
    if (!isRequest && !isResponse) return null;
    if (isRequest) return this._request(event, adu);
    return this._response(event, adu);
  }

  list(filters = {}) {
    const connectionId = filters.connectionId == null || filters.connectionId === '' ? null : String(filters.connectionId);
    const unitId = filters.unitId == null || filters.unitId === '' ? null : Number(filters.unitId);
    const area = filters.area == null || filters.area === '' ? null : String(filters.area);
    const text = String(filters.text || '').trim().toLowerCase();
    const requestedLimit = Number(filters.limit);
    const limit = Math.max(1, Math.min(this.maxPoints, Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.floor(requestedLimit) : 1000));
    const rows = [];
    for (const point of this.points.values()) {
      if (connectionId && point.connectionId !== connectionId) continue;
      if (Number.isInteger(unitId) && point.unitId !== unitId) continue;
      if (area && point.area !== area) continue;
      const definition = this.getDefinition(point.sourceKey);
      if (text && !`${definition?.name || ''} ${point.connectionId} ${point.area} ${point.address} ${definition?.unit || ''}`.toLowerCase().includes(text)) continue;
      rows.push(this._view(point, definition));
    }
    rows.sort((a, b) => b.lastSeen - a.lastSeen || a.connectionId.localeCompare(b.connectionId) || a.unitId - b.unitId || a.area.localeCompare(b.area) || a.address - b.address);
    return Object.freeze(rows.slice(0, limit));
  }

  get(sourceKey) {
    const point = this.points.get(sourceKey);
    if (!point) throw new RegisterLabError('REGISTER_SOURCE_NOT_FOUND', `Register source ${sourceKey} was not found`, { sourceKey });
    return this._view(point, this.getDefinition(sourceKey));
  }

  interpretationMatrix(sourceKey) {
    const point = this.points.get(sourceKey);
    if (!point) throw new RegisterLabError('REGISTER_SOURCE_NOT_FOUND', `Register source ${sourceKey} was not found`, { sourceKey });
    if (point.area === 'coils' || point.area === 'discreteInputs') {
      return Object.freeze([{ type: 'bool', words: 1, byteOrder: null, value: Boolean(point.rawValue) }]);
    }
    return registerCodec.interpretationMatrix(this._contiguousWords(point, 8));
  }

  getDefinition(sourceKey, projectId = null) {
    if (!this.store) return null;
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    const definitions = project?.registerLabDefinitions;
    const value = definitions && typeof definitions === 'object' ? definitions[sourceKey] : null;
    return value ? Object.freeze(clone(value)) : null;
  }

  listDefinitions(projectId = null) {
    if (!this.store) return Object.freeze({});
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    return Object.freeze(clone(project?.registerLabDefinitions || {}));
  }

  saveDefinition(input, projectId = null) {
    if (!this.store) throw new RegisterLabError('STORE_REQUIRED', 'Project store is required to save Register Lab definitions');
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    if (!project) throw new RegisterLabError('PROJECT_NOT_FOUND', 'Active project was not found');
    const sourceKey = String(input?.sourceKey || '').trim();
    const existing = project.registerLabDefinitions?.[sourceKey] || null;
    const definition = normalizeDefinition(input, existing);
    const definitions = { ...(project.registerLabDefinitions || {}), [sourceKey]: definition };
    if (Object.keys(definitions).length > 100000) throw new RegisterLabError('DEFINITION_LIMIT', 'Register Lab definition limit exceeded');
    this.store.updateProject(project.id, { registerLabDefinitions: definitions });
    this.emit('definition', definition);
    return definition;
  }

  removeDefinition(sourceKey, projectId = null) {
    if (!this.store) return false;
    const project = projectId ? this.store.getProject(projectId) : this.store.getActiveProject();
    if (!project) return false;
    const definitions = { ...(project.registerLabDefinitions || {}) };
    const existed = Object.prototype.hasOwnProperty.call(definitions, sourceKey);
    delete definitions[sourceKey];
    if (existed) this.store.updateProject(project.id, { registerLabDefinitions: definitions });
    return existed;
  }

  clearLive() {
    this.points.clear();
    this.pending.clear();
  }

  stats() {
    return Object.freeze({ points: this.points.size, pendingRequests: this.pending.size, latestSequence: this.sequence });
  }

  _request(event, adu) {
    const fc = adu.pdu[0];
    if (READ_AREAS[fc]) {
      try {
        const request = protocol.decodeReadRequest(adu.pdu);
        const pending = Object.freeze({
          connectionId: event.connectionId,
          ownerMode: event.ownerMode,
          unitId: adu.unitId,
          functionCode: fc,
          area: READ_AREAS[fc],
          address: request.address,
          quantity: request.quantity,
          eventId: event.eventId,
          timestamp: event.timestamp,
          framing: adu.framing,
          transactionId: adu.transactionId ?? event.details?.transactionId ?? null,
          clientId: event.details?.clientId || null,
        });
        this._setPending(this._pendingKey(event, adu), pending);
        return pending;
      } catch { return null; }
    }

    if ([protocol.FC.WRITE_SINGLE_COIL, protocol.FC.WRITE_SINGLE_REGISTER, protocol.FC.WRITE_MULTIPLE_COILS, protocol.FC.WRITE_MULTIPLE_REGISTERS].includes(fc)) {
      try {
        const decoded = [protocol.FC.WRITE_SINGLE_COIL, protocol.FC.WRITE_SINGLE_REGISTER].includes(fc)
          ? protocol.decodeWriteSingleRequest(adu.pdu)
          : protocol.decodeWriteMultipleRequest(adu.pdu);
        const area = [protocol.FC.WRITE_SINGLE_COIL, protocol.FC.WRITE_MULTIPLE_COILS].includes(fc) ? 'coils' : 'holdingRegisters';
        const values = decoded.values ? [...decoded.values] : [decoded.value];
        const pending = Object.freeze({
          connectionId: event.connectionId,
          ownerMode: event.ownerMode,
          unitId: adu.unitId,
          functionCode: fc,
          area,
          address: decoded.address,
          quantity: values.length,
          values,
          write: true,
          eventId: event.eventId,
          timestamp: event.timestamp,
          framing: adu.framing,
          transactionId: adu.transactionId ?? event.details?.transactionId ?? null,
          clientId: event.details?.clientId || null,
        });
        if (adu.unitId !== 0) this._setPending(this._pendingKey(event, adu), pending);
        return pending;
      } catch { return null; }
    }
    return null;
  }

  _response(event, adu) {
    const key = this._pendingKey(event, adu);
    const pending = this.pending.get(key);
    if (!pending) return null;
    this.pending.delete(key);
    const responseFc = adu.pdu[0];
    if ((responseFc & 0x80) !== 0) return null;
    if ((responseFc & 0x7F) !== pending.functionCode) return null;

    let values;
    try {
      if (pending.write) values = pending.values;
      else if (pending.area === 'coils' || pending.area === 'discreteInputs') {
        values = protocol.decodeReadBitsResponse(adu.pdu, { expectedQuantity: pending.quantity }).values;
      } else {
        values = protocol.decodeReadRegistersResponse(adu.pdu, { expectedQuantity: pending.quantity }).values;
      }
    } catch { return null; }

    const updated = [];
    values.forEach((value, index) => {
      updated.push(this._upsertPoint({
        connectionId: pending.connectionId,
        ownerMode: pending.ownerMode,
        unitId: pending.unitId,
        area: pending.area,
        address: pending.address + index,
        rawValue: value,
        timestamp: event.timestamp || Date.now(),
        requestEventId: pending.eventId,
        responseEventId: event.eventId,
        functionCode: pending.functionCode,
        quality: 'good',
      }));
    });
    return Object.freeze(updated);
  }

  _upsertPoint(input) {
    const sourceKey = pointKey(input);
    const current = this.points.get(sourceKey);
    const point = {
      sourceKey,
      connectionId: String(input.connectionId || ''),
      ownerMode: input.ownerMode == null ? null : String(input.ownerMode),
      unitId: Number(input.unitId),
      area: String(input.area),
      address: Number(input.address),
      rawValue: input.rawValue,
      functionCode: input.functionCode ?? null,
      quality: input.quality || 'good',
      sampleCount: (current?.sampleCount || 0) + 1,
      firstSeen: current?.firstSeen || input.timestamp,
      lastSeen: input.timestamp,
      changedAt: current && Object.is(current.rawValue, input.rawValue) ? current.changedAt : input.timestamp,
      requestEventId: input.requestEventId || null,
      responseEventId: input.responseEventId || null,
      sequence: ++this.sequence,
    };
    this.points.set(sourceKey, point);
    if (this.points.size > this.maxPoints) {
      const oldest = [...this.points.values()].sort((a, b) => a.lastSeen - b.lastSeen).slice(0, this.points.size - this.maxPoints);
      for (const item of oldest) this.points.delete(item.sourceKey);
    }
    const view = this._view(point, this.getDefinition(sourceKey));
    this.emit('point', view);
    return view;
  }

  _view(point, definition) {
    return Object.freeze({
      ...point,
      definition,
      engineering: this._engineering(point, definition),
      writeAccess: this._writeAccess(point),
    });
  }

  _engineering(point, definition) {
    if (!definition) return null;
    const wordsNeeded = TYPE_WORDS[definition.type] || 1;
    return registerCodec.decodeDefinition(this._contiguousWords(point, wordsNeeded), definition);
  }

  _contiguousWords(point, count) {
    if (point.area === 'coils' || point.area === 'discreteInputs') return [point.rawValue];
    const words = [];
    for (let offset = 0; offset < count; offset += 1) {
      const next = this.points.get(pointKey({ connectionId: point.connectionId, unitId: point.unitId, area: point.area, address: point.address + offset }));
      if (!next || !Number.isInteger(Number(next.rawValue))) break;
      words.push(Number(next.rawValue));
    }
    return words;
  }

  _writeAccess(point) {
    if (!this.broker || !['coils', 'holdingRegisters'].includes(point.area)) return Object.freeze({ allowed: false, reason: 'read-only-source' });
    try {
      const runtime = this.broker.getConnection(point.connectionId);
      const allowed = runtime.state === 'open' && runtime.owner?.ownerMode === 'master' && runtime.writeLock === 'ENABLED';
      return Object.freeze({ allowed, reason: allowed ? null : 'master-write-lock-required' });
    } catch {
      return Object.freeze({ allowed: false, reason: 'connection-unavailable' });
    }
  }

  _pendingKey(event, adu) {
    const connectionId = String(event.connectionId || 'unknown');
    const clientId = String(event.details?.clientId || '');
    if (adu.framing === 'tcp') return `tcp:${connectionId}:${clientId}:${adu.unitId}:${adu.transactionId ?? event.details?.transactionId ?? 'none'}`;
    return `serial:${connectionId}:${adu.unitId}`;
  }

  _setPending(key, value) {
    this.pending.set(key, value);
    if (this.pending.size > this.maxPending) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp).slice(0, this.pending.size - this.maxPending);
      for (const [pendingKey] of oldest) this.pending.delete(pendingKey);
    }
    const cutoff = Date.now() - 120000;
    for (const [pendingKey, pending] of this.pending) if ((pending.timestamp || 0) < cutoff) this.pending.delete(pendingKey);
  }
}

module.exports = {
  RegisterLabError,
  RegisterLabService,
  READ_AREAS,
  TYPE_WORDS,
  decodeTrafficAdu: decodeAdu,
  normalizeRegisterDefinition: normalizeDefinition,
  registerSourceKey: pointKey,
};
