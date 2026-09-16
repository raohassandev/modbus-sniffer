'use strict';

class VirtualDeviceError extends Error {
  constructor(code, message, exceptionCode, details = {}) {
    super(message);
    this.name = 'VirtualDeviceError';
    this.code = code;
    this.exceptionCode = exceptionCode;
    this.details = { ...details };
    Error.captureStackTrace?.(this, VirtualDeviceError);
  }
}

function validateUnitId(unitId) {
  if (!Number.isInteger(unitId) || unitId < 1 || unitId > 255) {
    throw new VirtualDeviceError('INVALID_UNIT_ID', 'Virtual Modbus device Unit ID must be 1..255', 3, { unitId });
  }
  return unitId;
}

function validateSize(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 65536) {
    throw new VirtualDeviceError('INVALID_MEMORY_SIZE', `${field} must be an integer between 0 and 65536`, 3, { field, value });
  }
  return value;
}

function normalizeWritableAreas(value = {}) {
  if (value == null) value = {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new VirtualDeviceError('INVALID_WRITE_POLICY', 'writableAreas must be an object', 3);
  }
  return Object.freeze({
    coils: value.coils == null ? true : Boolean(value.coils),
    discreteInputs: false,
    holdingRegisters: value.holdingRegisters == null ? true : Boolean(value.holdingRegisters),
    inputRegisters: false,
  });
}

class MemoryArea {
  constructor({ name, size, bit = false, writable = true }) {
    this.name = name;
    this.size = validateSize(size, `${name}.size`);
    this.bit = Boolean(bit);
    this.writable = Boolean(writable);
    this.values = this.bit ? new Uint8Array(this.size) : new Uint16Array(this.size);
  }

  validateRange(address, quantity) {
    if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) {
      throw new VirtualDeviceError('ILLEGAL_ADDRESS', `${this.name} address is outside 0..65535`, 2, { area: this.name, address });
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new VirtualDeviceError('ILLEGAL_VALUE', `${this.name} quantity must be at least 1`, 3, { area: this.name, quantity });
    }
    const end = address + quantity;
    if (end > this.size || end > 65536) {
      throw new VirtualDeviceError('ILLEGAL_ADDRESS', `${this.name} range ${address}..${end - 1} is not defined`, 2, {
        area: this.name,
        address,
        quantity,
        size: this.size,
      });
    }
  }

  _normalizeValue(value, address) {
    if (this.bit) {
      if (value !== true && value !== false && value !== 0 && value !== 1) {
        throw new VirtualDeviceError('ILLEGAL_VALUE', `${this.name} bit value must be boolean, 0 or 1`, 3, {
          area: this.name,
          address,
          value,
        });
      }
      return value ? 1 : 0;
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
      throw new VirtualDeviceError('ILLEGAL_VALUE', `${this.name} register value must be 0..65535`, 3, {
        area: this.name,
        address,
        value,
      });
    }
    return value;
  }

  _set(address, values, { enforceWritable }) {
    if (enforceWritable && !this.writable) {
      throw new VirtualDeviceError('READ_ONLY_AREA', `${this.name} is read-only`, 2, { area: this.name, address });
    }
    if (!Array.isArray(values) || values.length < 1) {
      throw new VirtualDeviceError('ILLEGAL_VALUE', `${this.name} write values must be a non-empty array`, 3, { area: this.name });
    }
    this.validateRange(address, values.length);
    const normalized = values.map((value, index) => this._normalizeValue(value, address + index));
    normalized.forEach((value, index) => { this.values[address + index] = value; });
  }

  read(address, quantity) {
    this.validateRange(address, quantity);
    return Array.from(this.values.subarray(address, address + quantity), (value) => this.bit ? Boolean(value) : value);
  }

  write(address, values) {
    this._set(address, values, { enforceWritable: true });
  }

  seed(address, values) {
    this._set(address, values, { enforceWritable: false });
  }
}

class VirtualDevice {
  constructor({
    unitId,
    sizes = {},
    identity = {},
    writableAreas = {},
  }) {
    this.unitId = validateUnitId(unitId);
    const defaults = {
      coils: 1024,
      discreteInputs: 1024,
      holdingRegisters: 1024,
      inputRegisters: 1024,
    };
    const configured = { ...defaults, ...sizes };
    this.writableAreas = normalizeWritableAreas(writableAreas);
    this.areas = Object.freeze({
      coils: new MemoryArea({ name: 'coils', size: configured.coils, bit: true, writable: this.writableAreas.coils }),
      discreteInputs: new MemoryArea({ name: 'discreteInputs', size: configured.discreteInputs, bit: true, writable: false }),
      holdingRegisters: new MemoryArea({ name: 'holdingRegisters', size: configured.holdingRegisters, bit: false, writable: this.writableAreas.holdingRegisters }),
      inputRegisters: new MemoryArea({ name: 'inputRegisters', size: configured.inputRegisters, bit: false, writable: false }),
    });
    this.identity = new Map();
    this.setIdentity({
      vendorName: 'Automatrix',
      productCode: `Virtual-${unitId}`,
      revision: 'v8',
      ...identity,
    });
  }

  setIdentity(identity = {}) {
    const aliases = {
      vendorName: 0,
      productCode: 1,
      revision: 2,
      vendorUrl: 3,
      productName: 4,
      modelName: 5,
      userApplicationName: 6,
    };
    for (const [key, value] of Object.entries(identity)) {
      const id = Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : Number(key);
      if (!Number.isInteger(id) || id < 0 || id > 0xFF || value == null) continue;
      this.identity.set(id, Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), 'utf8'));
    }
  }

  getIdentityObjects({ readDeviceIdCode = 1, objectId = 0 } = {}) {
    let ids = [...this.identity.keys()].sort((a, b) => a - b);
    if (readDeviceIdCode === 1) ids = ids.filter((id) => id <= 2);
    else if (readDeviceIdCode === 2) ids = ids.filter((id) => id <= 6);
    else if (readDeviceIdCode === 3) ids = ids.filter((id) => id >= 0x80);
    else if (readDeviceIdCode === 4) ids = ids.filter((id) => id === objectId);
    else ids = [];

    if (readDeviceIdCode !== 4) ids = ids.filter((id) => id >= objectId);
    return ids.map((id) => ({ id, value: Buffer.from(this.identity.get(id)) }));
  }

  read(area, address, quantity) {
    return this._area(area).read(address, quantity);
  }

  write(area, address, values) {
    return this._area(area).write(address, values);
  }

  validateRange(area, address, quantity) {
    return this._area(area).validateRange(address, quantity);
  }

  seed(area, address, values) {
    return this._area(area).seed(address, values);
  }

  _area(name) {
    const area = this.areas[name];
    if (!area) throw new VirtualDeviceError('UNKNOWN_AREA', `Unknown memory area: ${name}`, 2, { area: name });
    return area;
  }
}

module.exports = {
  MemoryArea,
  VirtualDevice,
  VirtualDeviceError,
  normalizeWritableAreas,
};
