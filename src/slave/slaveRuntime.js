'use strict';

const { EventEmitter } = require('node:events');
const {
  ConnectionBroker,
  SerialTransport,
  TcpServerTransport,
  TlsServerTransport,
  UdpServerTransport,
  TunnelTcpServerTransport,
  LabVirtualSlaveServer,
  DynamicValueEngine,
  VirtualDevice,
} = require('../modbusCore');

const AREAS = Object.freeze(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']);
const DEFAULT_SIZES = Object.freeze({
  coils: 1024,
  discreteInputs: 1024,
  holdingRegisters: 1024,
  inputRegisters: 1024,
});

class SlaveRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SlaveRuntimeError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, SlaveRuntimeError);
  }
}

function integer(value, fallback, { min = 0, max = 65535, field = 'value' } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    if (fallback !== undefined) return fallback;
    throw new SlaveRuntimeError('INVALID_ARGUMENT', `${field} must be an integer`, { field, value });
  }
  if (n < min || n > max) throw new SlaveRuntimeError('INVALID_ARGUMENT', `${field} must be ${min}..${max}`, { field, value: n, min, max });
  return n;
}

function framingForType(type) {
  if (['tcp','tls','udp'].includes(type)) return 'tcp';
  if (['rtu','rtu-tcp','rtu-udp'].includes(type)) return 'rtu';
  if (['ascii','ascii-tcp','ascii-udp'].includes(type)) return 'ascii';
  throw new SlaveRuntimeError('INVALID_TRANSPORT', 'Unsupported Slave transport', { type });
}
function isSerialType(type) { return type === 'rtu' || type === 'ascii'; }
function isNetworkType(type) { return !isSerialType(type); }

function normalizeConfig(input = {}) {
  const type = String(input.type || 'tcp').trim().toLowerCase();
  const supported = ['rtu','ascii','tcp','tls','udp','rtu-tcp','ascii-tcp','rtu-udp','ascii-udp'];
  if (!supported.includes(type)) throw new SlaveRuntimeError('INVALID_TRANSPORT', 'Unsupported Slave transport', { type, supported });

  if (isNetworkType(type)) {
    const host = String(input.host || '127.0.0.1').trim();
    if (!host) throw new SlaveRuntimeError('INVALID_ARGUMENT', 'Network listen host is required');
    const tls = type === 'tls' ? Object.freeze({
      cert: String(input.cert || input.tls?.cert || '').trim(),
      key: String(input.key || input.tls?.key || '').trim(),
      ca: String(input.ca || input.tls?.ca || '').trim() || null,
      requestCert: input.requestCert === true || input.tls?.requestCert === true,
      rejectUnauthorized: input.rejectUnauthorized === true || input.tls?.rejectUnauthorized === true,
      minVersion: String(input.minVersion || input.tls?.minVersion || 'TLSv1.2'),
    }) : null;
    if (type === 'tls' && (!tls.cert || !tls.key)) throw new SlaveRuntimeError('TLS_MATERIAL_REQUIRED', 'TLS Slave requires certificate and private key');
    return Object.freeze({
      type,
      framing: framingForType(type),
      host,
      port: integer(input.port, type === 'tls' ? 802 : 502, { min: 0, max: 65535, field: 'port' }),
      maxClients: integer(input.maxClients, 32, { min: 1, max: 256, field: 'maxClients' }),
      maxPeers: integer(input.maxPeers, 256, { min: 1, max: 4096, field: 'maxPeers' }),
      idleTimeoutMs: integer(input.idleTimeoutMs, 0, { min: 0, max: 24 * 60 * 60 * 1000, field: 'idleTimeoutMs' }),
      tls,
    });
  }

  const path = String(input.path || '').trim();
  if (!path) throw new SlaveRuntimeError('INVALID_ARGUMENT', 'Serial port is required');
  const parity = String(input.parity || 'none').toLowerCase();
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(parity)) throw new SlaveRuntimeError('INVALID_ARGUMENT', 'Unsupported parity', { parity });
  const dataBits = integer(input.dataBits, 8, { min: 5, max: 8, field: 'dataBits' });
  const stopBits = Number(input.stopBits ?? 1);
  if (![1, 1.5, 2].includes(stopBits)) throw new SlaveRuntimeError('INVALID_ARGUMENT', 'stopBits must be 1, 1.5 or 2');

  return Object.freeze({
    type,
    framing: type,
    path,
    baudRate: integer(input.baudRate, 9600, { min: 50, max: 4000000, field: 'baudRate' }),
    parity,
    dataBits,
    stopBits,
    echoSuppression: input.echoSuppression === true,
    rtsTxMode: ['none', 'high-during-tx', 'low-during-tx'].includes(String(input.rtsTxMode || 'none')) ? String(input.rtsTxMode || 'none') : 'none',
    rtsSettleMs: integer(input.rtsSettleMs, 0, { min: 0, max: 60000, field: 'rtsSettleMs' }),
  });
}

function normalizeDevice(input = {}, framing = 'tcp') {
  const maxUnit = framing === 'tcp' ? 255 : 247;
  const unitId = integer(input.unitId, undefined, { min: 1, max: maxUnit, field: 'unitId' });
  const sizes = {};
  for (const area of AREAS) sizes[area] = integer(input.sizes?.[area], DEFAULT_SIZES[area], { min: 0, max: 65536, field: `sizes.${area}` });
  const identitySource = input.identity && typeof input.identity === 'object' && !Array.isArray(input.identity) ? input.identity : {};
  const identityAliases = { '0':'vendorName', '1':'productCode', '2':'revision', '3':'vendorUrl', '4':'productName', '5':'modelName', '6':'userApplicationName' };
  const identity = { ...identitySource };
  for (const [numericKey, namedKey] of Object.entries(identityAliases)) {
    if (identity[namedKey] == null && identity[numericKey] != null) identity[namedKey] = identity[numericKey];
  }
  return Object.freeze({
    unitId,
    sizes: Object.freeze(sizes),
    writableAreas: Object.freeze({
      coils: input.writableAreas?.coils !== false,
      holdingRegisters: input.writableAreas?.holdingRegisters !== false,
    }),
    exceptionStatus: integer(input.exceptionStatus, 0, { min: 0, max: 0xFF, field: 'exceptionStatus' }),
    identity: Object.freeze({
      vendorName: String(identity.vendorName || 'Automatrix'),
      productCode: String(identity.productCode || `Virtual-${unitId}`),
      revision: String(identity.revision || '1.0'),
      vendorUrl: String(identity.vendorUrl || ''),
      productName: String(identity.productName || 'Modbus Virtual Device'),
      modelName: String(identity.modelName || ''),
      userApplicationName: String(identity.userApplicationName || ''),
    }),
    memory: input.memory && typeof input.memory === 'object' ? input.memory : {},
    fileRecords: Array.isArray(input.fileRecords) ? cloneJson(input.fileRecords) : [],
    fifoQueues: Array.isArray(input.fifoQueues) ? cloneJson(input.fifoQueues) : [],
  });
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sparseArea(area) {
  const out = [];
  const values = area?.values;
  if (!values?.length) return out;
  let start = -1;
  let segment = [];
  const flush = () => {
    if (start >= 0 && segment.length) out.push({ address: start, values: segment });
    start = -1;
    segment = [];
  };
  for (let i = 0; i < values.length; i += 1) {
    const value = Number(values[i]);
    if (value === 0) {
      flush();
      continue;
    }
    if (start < 0) start = i;
    segment.push(area.bit ? Boolean(value) : value);
  }
  flush();
  return out;
}

class SlaveRuntime extends EventEmitter {
  constructor({
    brokerFactory = () => new ConnectionBroker(),
    maxEvents = 2000,
  } = {}) {
    super();
    if (typeof brokerFactory !== 'function') throw new TypeError('brokerFactory must be a function');
    if (!Number.isInteger(maxEvents) || maxEvents < 100) throw new TypeError('maxEvents must be >= 100');
    this.brokerFactory = brokerFactory;
    this.maxEvents = maxEvents;
    this.broker = this.brokerFactory();
    this.server = null;
    this.transport = null;
    this.connectionId = null;
    this.config = null;
    this.events = [];
    this.sequence = 0;
    this._relay = null;
    this.generators = new DynamicValueEngine({ resolveDevice: (_serverId, unitId) => this.server?.running ? (this.server.getDevice(Number(unitId)) || null) : null });
    this._generatorRelay = (event) => this._recordEvent(event);
    this.generators.on('event', this._generatorRelay);
    this.generators.start();
  }

  status() {
    const snapshot = this.server?.snapshot?.() || null;
    return Object.freeze({
      configured: Boolean(this.server && this.config),
      running: Boolean(snapshot?.running),
      config: this.config ? Object.freeze({ ...this.config }) : null,
      server: snapshot,
      devices: Object.freeze(this.listDevices()),
      clients: Object.freeze(this.listClients()),
      events: this.events.length,
      listenAddress: this.transport?.address?.() || null,
      transportStatus: this.transport?.status?.() || null,
      lab: this.server?.faultLab?.snapshot?.() || null,
      generators: this.generators.snapshot(),
    });
  }

  async configure(input = {}) {
    const next = normalizeConfig(input);
    if (this.server?.running) throw new SlaveRuntimeError('SLAVE_RUNNING', 'Stop the Slave server before changing its connection');
    const existing = this._captureDeviceDefinitions();
    await this._disposeServer();

    this.broker = this.brokerFactory();
    this.config = next;
    this.connectionId = `stable-slave-${Date.now().toString(36)}`;
    this.transport = this._createTransport(next);
    const resourceKey = isNetworkType(next.type)
      ? `${next.type}-listen:${next.host.toLowerCase()}:${next.port}`
      : `serial:${next.path.toLowerCase()}`;
    this.broker.defineConnection({
      connectionId: this.connectionId,
      resourceKey,
      transportKind: isNetworkType(next.type) ? `${next.type}-server` : `serial-${next.type}`,
      transport: this.transport,
      metadata: { productMode: 'slave', framing: next.framing, transportType: next.type },
      exclusive: true,
    });

    this.server = new LabVirtualSlaveServer({
      broker: this.broker,
      connectionId: this.connectionId,
      ownerId: 'stable-slave',
      framing: next.framing,
      receivePollMs: 25,
    });
    this._relay = (event) => this._recordEvent(event);
    this.server.on('event', this._relay);

    const definitions = existing.length ? existing : [normalizeDevice({ unitId: 1 }, next.framing)];
    for (const definition of definitions) this._materialize(definition);
    return this.status();
  }

  async start(input = null) {
    if (input || !this.server) {
      await this.configure(input || { type: 'tcp', host: '127.0.0.1', port: 502 });
    }
    if (this.server.running) return this.status();
    await this.server.start();
    this._recordSynthetic('slave.started', { config: this.config, unitIds: this.server.snapshot().unitIds });
    return this.status();
  }

  async stop() {
    if (!this.server) return this.status();
    if (this.server.running) {
      await this.server.stop({ closeConnection: true });
      this._recordSynthetic('slave.stopped', {});
    }
    return this.status();
  }

  async shutdown() {
    this.generators.stop();
    await this._disposeServer();
  }

  listDevices() {
    if (!this.server) return [];
    return [...this.server.devices.values()]
      .sort((a, b) => a.unitId - b.unitId)
      .map((device) => Object.freeze({
        unitId: device.unitId,
        sizes: Object.freeze(Object.fromEntries(AREAS.map((area) => [area, device.areas[area].size]))),
        writableAreas: Object.freeze({ ...device.writableAreas }),
        exceptionStatus: device.exceptionStatus,
        identity: Object.freeze(Object.fromEntries([...device.identity.entries()].map(([id, value]) => [String(id), Buffer.from(value).toString('utf8')]))),
        fileRecordSegments: device.exportFileRecords().length,
        fifoQueues: device.exportFifoQueues().length,
      }));
  }

  addDevice(input = {}) {
    if (!this.server || !this.config) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Configure the Slave connection before adding devices');
    const definition = normalizeDevice(input, this.config.framing || framingForType(this.config.type));
    if (this.server.getDevice(definition.unitId)) throw new SlaveRuntimeError('UNIT_ID_CONFLICT', `Unit ID ${definition.unitId} already exists`, { unitId: definition.unitId });
    const device = this._materialize(definition);
    this._recordSynthetic('slave.device-added', { unitId: device.unitId });
    return this.listDevices().find((item) => item.unitId === device.unitId);
  }

  removeDevice(unitId) {
    if (!this.server) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Slave is not configured');
    const id = integer(unitId, undefined, { min: 1, max: 255, field: 'unitId' });
    const removed = this.server.removeDevice(id);
    if (!removed) throw new SlaveRuntimeError('DEVICE_NOT_FOUND', `Unit ID ${id} does not exist`, { unitId: id });
    this._recordSynthetic('slave.device-removed', { unitId: id });
    return true;
  }

  readMemory({ unitId, area = 'holdingRegisters', address = 0, quantity = 16 } = {}) {
    const device = this._device(unitId);
    if (!AREAS.includes(area)) throw new SlaveRuntimeError('INVALID_MEMORY_AREA', `Unknown memory area ${area}`, { area });
    const start = integer(address, 0, { min: 0, max: 65535, field: 'address' });
    const count = integer(quantity, 16, { min: 1, max: 2000, field: 'quantity' });
    const values = device.read(area, start, count);
    return Object.freeze({ unitId: device.unitId, area, address: start, quantity: count, values: Object.freeze(values) });
  }

  seedMemory({ unitId, area = 'holdingRegisters', address = 0, values = [] } = {}) {
    const device = this._device(unitId);
    if (!AREAS.includes(area)) throw new SlaveRuntimeError('INVALID_MEMORY_AREA', `Unknown memory area ${area}`, { area });
    const start = integer(address, 0, { min: 0, max: 65535, field: 'address' });
    if (!Array.isArray(values) || !values.length) throw new SlaveRuntimeError('INVALID_MEMORY_VALUES', 'values must be a non-empty array');
    device.seed(area, start, values);
    this._recordSynthetic('slave.memory-seeded', { unitId: device.unitId, area, address: start, quantity: values.length });
    return this.readMemory({ unitId: device.unitId, area, address: start, quantity: values.length });
  }

  readFileRecords({ unitId, records = [] } = {}) {
    const device = this._device(unitId);
    if (!Array.isArray(records) || !records.length) throw new SlaveRuntimeError('INVALID_FILE_RECORDS', 'records must be a non-empty array');
    return Object.freeze({
      unitId: device.unitId,
      records: Object.freeze(records.map((record, index) => {
        const fileNumber = integer(record.fileNumber, undefined, { min: 0, max: 0xFFFF, field: `records[${index}].fileNumber` });
        const recordNumber = integer(record.recordNumber, undefined, { min: 0, max: 0xFFFF, field: `records[${index}].recordNumber` });
        const recordLength = integer(record.recordLength, undefined, { min: 1, max: 125, field: `records[${index}].recordLength` });
        return Object.freeze({ fileNumber, recordNumber, values: Object.freeze(device.readFileRecord(fileNumber, recordNumber, recordLength)) });
      })),
    });
  }

  seedFileRecords({ unitId, records = [] } = {}) {
    const device = this._device(unitId);
    if (!Array.isArray(records) || !records.length) throw new SlaveRuntimeError('INVALID_FILE_RECORDS', 'records must be a non-empty array');
    const written = records.map((record, index) => {
      const fileNumber = integer(record.fileNumber, undefined, { min: 0, max: 0xFFFF, field: `records[${index}].fileNumber` });
      const recordNumber = integer(record.recordNumber, undefined, { min: 0, max: 0xFFFF, field: `records[${index}].recordNumber` });
      if (!Array.isArray(record.values) || !record.values.length) throw new SlaveRuntimeError('INVALID_FILE_RECORDS', `records[${index}].values must be non-empty`);
      const values = record.values.map((value, valueIndex) => integer(value, undefined, { min: 0, max: 0xFFFF, field: `records[${index}].values[${valueIndex}]` }));
      device.writeFileRecord(fileNumber, recordNumber, values, { seed: true });
      return { fileNumber, recordNumber, values };
    });
    this._recordSynthetic('slave.file-records-seeded', { unitId: device.unitId, records: written.length });
    return Object.freeze({ unitId: device.unitId, records: Object.freeze(written) });
  }

  seedFifo({ unitId, address = 0, values = [] } = {}) {
    const device = this._device(unitId);
    const pointer = integer(address, 0, { min: 0, max: 0xFFFF, field: 'address' });
    const normalized = device.seedFifo(pointer, values.map((value, index) => integer(value, undefined, { min: 0, max: 0xFFFF, field: `values[${index}]` })));
    this._recordSynthetic('slave.fifo-seeded', { unitId: device.unitId, address: pointer, quantity: normalized.length });
    return Object.freeze({ unitId: device.unitId, address: pointer, values: Object.freeze(normalized) });
  }

  readFifo({ unitId, address = 0 } = {}) {
    const device = this._device(unitId);
    const pointer = integer(address, 0, { min: 0, max: 0xFFFF, field: 'address' });
    return Object.freeze({ unitId: device.unitId, address: pointer, values: Object.freeze(device.readFifo(pointer)) });
  }

  armLab(policy = {}, confirmation = {}) {
    if (!this.server) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Configure the Slave before arming LAB behavior');
    return this.server.armFaultLab(policy, confirmation);
  }

  disarmLab() {
    if (!this.server) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Configure the Slave before changing LAB behavior');
    return this.server.disarmFaultLab();
  }

  listGenerators() {
    return this.generators.list({ serverId: 'stable' });
  }

  saveGenerator(input = {}) {
    if (!this.server) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Configure the Slave before adding generators');
    const unitId = integer(input.unitId, undefined, { min: 1, max: 255, field: 'unitId' });
    this._device(unitId);
    return this.generators.upsert({ ...input, serverId: 'stable', unitId });
  }

  removeGenerator(generatorId) {
    return this.generators.remove(String(generatorId));
  }

  listClients() {
    return typeof this.transport?.listClients === 'function' ? this.transport.listClients() : [];
  }

  getEvents({ limit = 200, type = null } = {}) {
    const safeLimit = Math.max(1, Math.min(this.maxEvents, Number(limit) || 200));
    const filtered = type ? this.events.filter((event) => event.type === type) : this.events;
    return Object.freeze(filtered.slice(-safeLimit));
  }

  exportConfig() {
    return Object.freeze({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      config: this.config ? (() => { const out=cloneJson(this.config); if(out?.tls){ out.tls.key=null; out.tls.credentialsRequired=true; } return out; })() : null,
      devices: this._captureDeviceDefinitions(),
    });
  }

  async importConfig(payload = {}) {
    if (this.server?.running) throw new SlaveRuntimeError('SLAVE_RUNNING', 'Stop the Slave server before importing a simulator map');
    if (!payload || typeof payload !== 'object' || Number(payload.schemaVersion) !== 1) {
      throw new SlaveRuntimeError('INVALID_IMPORT', 'Slave import schemaVersion must be 1');
    }
    const config = normalizeConfig(payload.config || {});
    const definitions = Array.isArray(payload.devices) ? payload.devices.map((item) => normalizeDevice(item, config.framing || framingForType(config.type))) : [];
    await this._disposeServer();
    this.broker = this.brokerFactory();
    this.config = config;
    this.connectionId = `stable-slave-${Date.now().toString(36)}`;
    this.transport = this._createTransport(config);
    this.broker.defineConnection({
      connectionId: this.connectionId,
      resourceKey: isNetworkType(config.type) ? `${config.type}-listen:${config.host.toLowerCase()}:${config.port}` : `serial:${config.path.toLowerCase()}`,
      transportKind: isNetworkType(config.type) ? `${config.type}-server` : `serial-${config.type}`,
      transport: this.transport,
      metadata: { productMode: 'slave', framing: config.framing, transportType: config.type },
      exclusive: true,
    });
    this.server = new LabVirtualSlaveServer({
      broker: this.broker,
      connectionId: this.connectionId,
      ownerId: 'stable-slave',
      framing: config.framing,
      receivePollMs: 25,
    });
    this._relay = (event) => this._recordEvent(event);
    this.server.on('event', this._relay);
    for (const definition of definitions.length ? definitions : [normalizeDevice({ unitId: 1 }, config.framing || framingForType(config.type))]) this._materialize(definition);
    this._recordSynthetic('slave.imported', { devices: this.server.devices.size });
    return this.status();
  }

  _createTransport(config) {
    if (config.type === 'tcp') return new TcpServerTransport({ host: config.host, port: config.port, maxClients: config.maxClients, idleTimeoutMs: config.idleTimeoutMs });
    if (config.type === 'tls') return new TlsServerTransport({ host: config.host, port: config.port, maxClients: config.maxClients, idleTimeoutMs: config.idleTimeoutMs, cert: config.tls.cert, key: config.tls.key, ca: config.tls.ca, requestCert: config.tls.requestCert, rejectUnauthorized: config.tls.rejectUnauthorized, minVersion: config.tls.minVersion });
    if (config.type === 'udp' || config.type === 'rtu-udp' || config.type === 'ascii-udp') return new UdpServerTransport({ host: config.host, port: config.port, maxPeers: config.maxPeers });
    if (config.type === 'rtu-tcp') return new TunnelTcpServerTransport({ host: config.host, port: config.port, maxClients: config.maxClients, idleTimeoutMs: config.idleTimeoutMs, framing: 'rtu' });
    if (config.type === 'ascii-tcp') return new TunnelTcpServerTransport({ host: config.host, port: config.port, maxClients: config.maxClients, idleTimeoutMs: config.idleTimeoutMs, framing: 'ascii' });
    return new SerialTransport({
      path: config.path, baudRate: config.baudRate, parity: config.parity, dataBits: config.dataBits, stopBits: config.stopBits,
      framing: config.type, echoSuppression: config.echoSuppression, rtsTxMode: config.rtsTxMode, rtsSettleMs: config.rtsSettleMs,
    });
  }

  _materialize(definition) {
    const device = this.server.addDevice(new VirtualDevice({
      unitId: definition.unitId,
      sizes: definition.sizes,
      identity: definition.identity,
      writableAreas: definition.writableAreas,
      exceptionStatus: definition.exceptionStatus,
      fileRecords: definition.fileRecords,
      fifoQueues: definition.fifoQueues,
    }));
    for (const area of AREAS) {
      const segments = Array.isArray(definition.memory?.[area]) ? definition.memory[area] : [];
      for (const segment of segments) {
        if (!Array.isArray(segment.values) || !segment.values.length) continue;
        device.seed(area, Number(segment.address || 0), segment.values);
      }
    }
    return device;
  }

  _device(unitId) {
    if (!this.server) throw new SlaveRuntimeError('SLAVE_NOT_CONFIGURED', 'Slave is not configured');
    const id = integer(unitId, undefined, { min: 1, max: 255, field: 'unitId' });
    const device = this.server.getDevice(id);
    if (!device) throw new SlaveRuntimeError('DEVICE_NOT_FOUND', `Unit ID ${id} does not exist`, { unitId: id });
    return device;
  }

  _captureDeviceDefinitions() {
    if (!this.server) return [];
    return [...this.server.devices.values()].map((device) => ({
      unitId: device.unitId,
      sizes: Object.fromEntries(AREAS.map((area) => [area, device.areas[area].size])),
      writableAreas: { ...device.writableAreas },
      exceptionStatus: device.exceptionStatus,
      identity: Object.fromEntries([...device.identity.entries()].map(([id, value]) => [String(id), Buffer.from(value).toString('utf8')])),
      fileRecords: device.exportFileRecords(),
      fifoQueues: device.exportFifoQueues(),
      memory: Object.fromEntries(AREAS.map((area) => [area, sparseArea(device.areas[area])])),
    }));
  }

  _recordEvent(event) {
    const raw = event?.raw;
    const record = Object.freeze({
      eventId: event?.eventId || `slave-event-${++this.sequence}`,
      timestamp: Number(event?.timestamp || Date.now()),
      type: String(event?.type || 'slave.event'),
      source: event?.source || 'virtual-slave',
      ownerMode: event?.ownerMode || 'slave',
      connectionId: event?.connectionId || this.connectionId || null,
      channelId: event?.channelId || null,
      direction: event?.direction || null,
      unitId: event?.unitId ?? null,
      functionCode: event?.functionCode ?? null,
      rawHex: event?.rawHex || (Buffer.isBuffer(raw) ? raw.toString('hex').toUpperCase() : null),
      details: cloneJson(event?.details || {}),
    });
    this.events.push(record);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.emit('event', record);
  }

  _recordSynthetic(type, details) {
    this._recordEvent({ type, timestamp: Date.now(), details });
  }

  async _disposeServer() {
    if (!this.server) return;
    try { await this.stop(); } catch { /* best-effort cleanup */ }
    if (this._relay) this.server.off('event', this._relay);
    this.server = null;
    this.transport = null;
    this.connectionId = null;
    this.config = null;
    this._relay = null;
    this.broker = this.brokerFactory();
  }
}

module.exports = {
  AREAS,
  DEFAULT_SIZES,
  SlaveRuntime,
  SlaveRuntimeError,
  normalizeConfig,
  normalizeDevice,
  framingForType,
  isSerialType,
  isNetworkType,
};
