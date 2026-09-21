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
    exceptionStatus = 0,
    fileRecords = [],
    fifoQueues = [],
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
    if (!Number.isInteger(exceptionStatus) || exceptionStatus < 0 || exceptionStatus > 0xFF) throw new VirtualDeviceError('INVALID_EXCEPTION_STATUS', 'exceptionStatus must be 0..255', 3, { exceptionStatus });
    this.exceptionStatus = exceptionStatus;
    this.fileRecords = new Map();
    this.fifoQueues = new Map();
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
    for (const record of Array.isArray(fileRecords) ? fileRecords : []) {
      this.writeFileRecord(record.fileNumber, record.recordNumber, record.values || [], { seed: true });
    }
    for (const queue of Array.isArray(fifoQueues) ? fifoQueues : []) {
      this.seedFifo(queue.address, queue.values || []);
    }
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

  readFileRecord(fileNumber, recordNumber, recordLength) {
    if (!Number.isInteger(fileNumber) || fileNumber < 0 || fileNumber > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'fileNumber must be 0..65535', 3, { fileNumber });
    if (!Number.isInteger(recordNumber) || recordNumber < 0 || recordNumber > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'recordNumber must be 0..65535', 3, { recordNumber });
    if (!Number.isInteger(recordLength) || recordLength < 1 || recordLength > 125) throw new VirtualDeviceError('ILLEGAL_VALUE', 'recordLength must be 1..125', 3, { recordLength });
    const file = this.fileRecords.get(fileNumber);
    const out = [];
    for (let offset = 0; offset < recordLength; offset += 1) out.push(file?.get(recordNumber + offset) ?? 0);
    return out;
  }

  writeFileRecord(fileNumber, recordNumber, values, { seed = false } = {}) {
    if (!Number.isInteger(fileNumber) || fileNumber < 0 || fileNumber > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'fileNumber must be 0..65535', 3, { fileNumber });
    if (!Number.isInteger(recordNumber) || recordNumber < 0 || recordNumber > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'recordNumber must be 0..65535', 3, { recordNumber });
    if (!Array.isArray(values) || !values.length || values.length > 121) throw new VirtualDeviceError('ILLEGAL_VALUE', 'file record values must contain 1..121 registers', 3, { length: values?.length });
    const normalized = values.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'file record value must be 0..65535', 3, { index, value });
      return value;
    });
    let file = this.fileRecords.get(fileNumber);
    if (!file) { file = new Map(); this.fileRecords.set(fileNumber, file); }
    normalized.forEach((value, index) => file.set(recordNumber + index, value));
    return normalized;
  }

  exportFileRecords() {
    const records = [];
    for (const [fileNumber, file] of [...this.fileRecords.entries()].sort((a,b)=>a[0]-b[0])) {
      const addresses = [...file.keys()].sort((a,b)=>a-b);
      if (!addresses.length) continue;
      let start = addresses[0], values = [], previous = start - 1;
      const flush = () => { if (values.length) records.push({ fileNumber, recordNumber: start, values: [...values] }); values = []; };
      for (const address of addresses) {
        if (address !== previous + 1) { flush(); start = address; }
        values.push(file.get(address));
        previous = address;
      }
      flush();
    }
    return records;
  }

  seedFifo(address, values) {
    if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_ADDRESS', 'FIFO pointer address must be 0..65535', 2, { address });
    if (!Array.isArray(values) || values.length < 1 || values.length > 31) throw new VirtualDeviceError('ILLEGAL_VALUE', 'FIFO values must contain 1..31 registers', 3, { length: values?.length });
    const normalized = values.map((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_VALUE', 'FIFO value must be 0..65535', 3, { index, value });
      return value;
    });
    this.fifoQueues.set(address, normalized);
    return [...normalized];
  }

  readFifo(address) {
    if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) throw new VirtualDeviceError('ILLEGAL_ADDRESS', 'FIFO pointer address must be 0..65535', 2, { address });
    return [...(this.fifoQueues.get(address) || [0])];
  }

  exportFifoQueues() {
    return [...this.fifoQueues.entries()].sort((a,b)=>a[0]-b[0]).map(([address, values]) => ({ address, values: [...values] }));
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
