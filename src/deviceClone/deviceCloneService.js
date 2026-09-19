'use strict';

const AREA_BY_FC = Object.freeze({
  1: 'coils',
  2: 'discreteInputs',
  3: 'holdingRegisters',
  4: 'inputRegisters',
  5: 'coils',
  6: 'holdingRegisters',
  15: 'coils',
  16: 'holdingRegisters',
  22: 'holdingRegisters',
  23: 'holdingRegisters',
});

const READ_PRIORITY = Object.freeze({ 1: 100, 2: 100, 3: 100, 4: 100, 5: 20, 6: 20, 15: 20, 16: 20, 22: 20, 23: 20 });

class DeviceCloneError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DeviceCloneError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, DeviceCloneError);
  }
}

function int(value, fallback, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    if (fallback !== undefined) return fallback;
    throw new DeviceCloneError('INVALID_CLONE_ARGUMENT', `${field} must be an integer`, { field, value });
  }
  if (n < min || n > max) throw new DeviceCloneError('INVALID_CLONE_ARGUMENT', `${field} must be ${min}..${max}`, { field, value: n });
  return n;
}

function areaValue(area, raw) {
  if (area === 'coils' || area === 'discreteInputs') return Boolean(Number(raw));
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(0xFFFF, Math.trunc(n))) : 0;
}

function contiguousSegments(points) {
  const ordered = [...points].sort((a,b)=>a.address-b.address);
  const segments = [];
  let current = null;
  for (const point of ordered) {
    if (!current || current.address + current.values.length !== point.address) {
      current = { address: point.address, values: [point.value] };
      segments.push(current);
    } else {
      current.values.push(point.value);
    }
  }
  return segments;
}

function pickRegisters(registers) {
  const selected = new Map();
  for (const reg of registers || []) {
    const fc = Number(reg.functionCode);
    const area = AREA_BY_FC[fc];
    const address = Number(reg.address);
    if (!area || !Number.isInteger(address) || address < 0 || address > 0xFFFF) continue;
    const key = `${area}:${address}`;
    const candidate = {
      area,
      address,
      value: areaValue(area, reg.lastValue),
      functionCode: fc,
      lastHex: reg.lastHex || null,
      samples: Number(reg.samples || reg.reads || 0),
      changes: Number(reg.changes || 0),
      firstSeen: reg.firstSeen || null,
      lastSeen: reg.lastSeen || null,
      priority: READ_PRIORITY[fc] || 0,
    };
    const existing = selected.get(key);
    if (!existing || candidate.priority > existing.priority || (candidate.priority === existing.priority && candidate.samples > existing.samples)) {
      selected.set(key, candidate);
    }
  }
  return [...selected.values()];
}

class DeviceCloneService {
  constructor({ state, slaveRuntime } = {}) {
    if (!state) throw new TypeError('state is required');
    if (!slaveRuntime) throw new TypeError('slaveRuntime is required');
    this.state = state;
    this.slaveRuntime = slaveRuntime;
  }

  sources() {
    return Object.freeze((this.state.getDevices?.() || []).map((device) => Object.freeze({
      deviceKey: device.deviceKey,
      channelId: device.channelId,
      channelName: device.channelName,
      transport: device.transport,
      unitId: device.unitId,
      name: device.name,
      status: device.status,
      confirmed: device.confirmed !== false,
      registerCount: device.registerCount,
      functions: Object.freeze([...(device.functions || [])]),
      frames: device.frames,
      firstSeen: device.firstSeen,
      lastSeen: device.lastSeen,
    })));
  }

  preview(options = {}) {
    const ref = options.deviceKey || options.unitId || options.slaveId;
    if (ref == null || ref === '') throw new DeviceCloneError('SOURCE_REQUIRED', 'deviceKey or Unit ID is required');
    let detail;
    try { detail = this.state.getDevice(ref, { channelId: options.channelId || null }); }
    catch (error) { throw new DeviceCloneError(error.code || 'SOURCE_LOOKUP_FAILED', error.message, error.details || {}); }
    if (!detail?.summary) throw new DeviceCloneError('SOURCE_NOT_FOUND', 'Captured Modbus device was not found', { ref, channelId: options.channelId || null });

    const summary = detail.summary;
    const targetUnitId = int(options.targetUnitId, Number(summary.unitId), 1, 255, 'targetUnitId');
    const points = pickRegisters(detail.registers || []);
    if (!points.length) throw new DeviceCloneError('NO_REGISTER_EVIDENCE', 'Captured device has no usable coil/register evidence to clone', { deviceKey: summary.deviceKey });

    const memory = {};
    const sizes = {};
    for (const area of ['coils','discreteInputs','holdingRegisters','inputRegisters']) {
      const areaPoints = points.filter((point)=>point.area===area);
      memory[area] = contiguousSegments(areaPoints);
      sizes[area] = areaPoints.length ? Math.min(65536, Math.max(...areaPoints.map((point)=>point.address)) + 1) : 0;
    }

    const allowWrites = options.allowWrites === true;
    const uncertain = points.filter((point)=>point.samples < 2).length;
    const config = {
      type: 'tcp',
      host: String(options.host || '127.0.0.1').trim() || '127.0.0.1',
      port: int(options.port, 1502, 0, 65535, 'port'),
      maxClients: int(options.maxClients, 32, 1, 256, 'maxClients'),
      idleTimeoutMs: 0,
    };
    const clone = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      config,
      devices: [{
        unitId: targetUnitId,
        sizes,
        writableAreas: { coils: allowWrites, holdingRegisters: allowWrites },
        exceptionStatus: 0,
        identity: {
          vendorName: 'Captured Modbus Device',
          productCode: `Clone-${targetUnitId}`,
          revision: 'capture-derived',
          productName: summary.name || `Unit ${summary.unitId}`,
          modelName: '',
          userApplicationName: 'Modbus Engineering Tool Device Clone',
        },
        memory,
        fileRecords: [],
        fifoQueues: [],
      }],
    };

    return Object.freeze({
      source: Object.freeze({
        deviceKey: summary.deviceKey,
        channelId: summary.channelId,
        transport: summary.transport,
        unitId: summary.unitId,
        name: summary.name,
        capturedRegisters: detail.registers?.length || 0,
        clonedPoints: points.length,
        uncertainPoints: uncertain,
        firstSeen: summary.firstSeen,
        lastSeen: summary.lastSeen,
      }),
      policy: Object.freeze({
        writesEnabled: allowWrites,
        safeDefault: allowWrites ? 'explicit-writable-areas' : 'read-only',
        provenance: 'stable-sniffer-register-evidence',
      }),
      areaCounts: Object.freeze(Object.fromEntries(['coils','discreteInputs','holdingRegisters','inputRegisters'].map((area)=>[area, points.filter((point)=>point.area===area).length]))),
      map: Object.freeze(clone),
    });
  }

  async apply(options = {}) {
    const current = this.slaveRuntime.status();
    if (current.running) throw new DeviceCloneError('SLAVE_RUNNING', 'Stop the Slave server before applying a Device Clone');
    const preview = this.preview(options);
    const status = await this.slaveRuntime.importConfig(preview.map);
    return Object.freeze({ preview, status });
  }
}

module.exports = {
  AREA_BY_FC,
  DeviceCloneError,
  DeviceCloneService,
  contiguousSegments,
  pickRegisters,
};
