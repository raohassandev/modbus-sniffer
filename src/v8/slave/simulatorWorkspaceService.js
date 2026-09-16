'use strict';

const { EventEmitter } = require('node:events');
const { createWorkbenchEvent } = require('../events');
const { LabVirtualSlaveServer } = require('./labVirtualSlaveServer');
const { VirtualDevice } = require('./virtualDevice');
const { DynamicValueEngine } = require('./dynamicValueEngine');

const AREAS = Object.freeze(new Set(['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters']));
const FRAMINGS = Object.freeze(new Set(['rtu', 'ascii', 'tcp']));

class SimulatorWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SimulatorWorkspaceError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, SimulatorWorkspaceError);
  }
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function text(value, field) {
  const result = String(value ?? '').trim();
  if (!result) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', `${field} is required`, { field });
  return result;
}
function int(value, field, min, max, fallback = null) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    if (fallback != null && (value == null || value === '')) return fallback;
    throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', `${field} must be ${min}..${max}`, { field, value });
  }
  return number;
}

function normalizeServer(input, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', 'Server must be an object');
  const serverId = text(input.serverId || existing?.serverId, 'serverId');
  const framing = String(input.framing || existing?.framing || 'rtu').toLowerCase();
  if (!FRAMINGS.has(framing)) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', 'framing must be rtu, ascii or tcp', { framing });
  return {
    serverId,
    name: String(input.name ?? existing?.name ?? serverId).trim().slice(0, 200) || serverId,
    connectionId: text(input.connectionId || existing?.connectionId, 'connectionId'),
    framing,
    receivePollMs: int(input.receivePollMs ?? existing?.receivePollMs ?? 25, 'receivePollMs', 1, 60_000),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : clone(existing?.metadata || {}),
  };
}

function normalizeSizes(value = {}, fallback = null) {
  const base = fallback || { coils: 1024, discreteInputs: 1024, holdingRegisters: 1024, inputRegisters: 1024 };
  return {
    coils: int(value.coils ?? base.coils, 'sizes.coils', 0, 65536),
    discreteInputs: int(value.discreteInputs ?? base.discreteInputs, 'sizes.discreteInputs', 0, 65536),
    holdingRegisters: int(value.holdingRegisters ?? base.holdingRegisters, 'sizes.holdingRegisters', 0, 65536),
    inputRegisters: int(value.inputRegisters ?? base.inputRegisters, 'sizes.inputRegisters', 0, 65536),
  };
}

function normalizeDevice(input, server, existing = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', 'Virtual device must be an object');
  const unitMax = server.framing === 'tcp' ? 255 : 247;
  const unitId = int(input.unitId ?? existing?.unitId, 'unitId', 1, unitMax);
  const deviceId = String(input.deviceId || existing?.deviceId || `${server.serverId}:unit:${unitId}`).trim();
  if (!deviceId) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', 'deviceId is required');
  return {
    deviceId,
    serverId: server.serverId,
    unitId,
    name: String(input.name ?? existing?.name ?? `Unit ${unitId}`).trim().slice(0, 200) || `Unit ${unitId}`,
    sizes: normalizeSizes(input.sizes || {}, existing?.sizes || null),
    identity: input.identity && typeof input.identity === 'object' && !Array.isArray(input.identity) ? clone(input.identity) : clone(existing?.identity || {}),
    memory: input.memory && typeof input.memory === 'object' && !Array.isArray(input.memory) ? clone(input.memory) : clone(existing?.memory || {}),
    generators: Array.isArray(input.generators) ? clone(input.generators) : clone(existing?.generators || []),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : clone(existing?.metadata || {}),
  };
}

function stripGeneratorRuntime(generator) {
  const { runtime, ...config } = generator || {};
  return clone(config);
}

class SimulatorWorkspaceService extends EventEmitter {
  constructor({ store, broker, connectionCenter } = {}) {
    super();
    if (!store) throw new TypeError('store is required');
    if (!broker) throw new TypeError('broker is required');
    if (!connectionCenter) throw new TypeError('connectionCenter is required');
    this.store = store;
    this.broker = broker;
    this.connectionCenter = connectionCenter;
    this.runtimes = new Map();
    this.generators = new DynamicValueEngine({ resolveDevice: (serverId, unitId) => this.runtimes.get(serverId)?.server.getDevice(unitId) || null });
    this.generators.on('event', (event) => this.emit('event', event));
    this.generators.start();
  }

  activeProject() { return this.store.getActiveProject(); }

  listServers() {
    const project = this.activeProject();
    return Object.freeze((project?.slaveServers || []).map((config) => this._serverView(config)));
  }

  getServer(serverId) {
    const config = this._serverConfig(serverId);
    return this._serverView(config);
  }

  saveServer(input) {
    const project = this._requireProject();
    const id = String(input?.serverId || '').trim();
    const existing = id ? project.slaveServers.find((entry) => entry.serverId === id) || null : null;
    if (existing && this.runtimes.has(existing.serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before editing it', { serverId: existing.serverId });
    const server = normalizeServer(input, existing);
    this._validateConnection(server);
    const conflict = project.slaveServers.find((entry) => entry.serverId !== server.serverId && entry.connectionId === server.connectionId);
    if (conflict) throw new SimulatorWorkspaceError('CONNECTION_ALREADY_ASSIGNED', `Connection ${server.connectionId} is already assigned to simulator server ${conflict.serverId}`, { connectionId: server.connectionId });
    const index = project.slaveServers.findIndex((entry) => entry.serverId === server.serverId);
    if (index >= 0) project.slaveServers[index] = server;
    else project.slaveServers.push(server);
    this._persist(project, { slaveServers: project.slaveServers });
    this._emit('simulator.server-saved', server.serverId, { connectionId: server.connectionId, framing: server.framing });
    return this.getServer(server.serverId);
  }

  removeServer(serverId) {
    if (this.runtimes.has(serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before deleting it', { serverId });
    const project = this._requireProject();
    const before = project.slaveServers.length;
    project.slaveServers = project.slaveServers.filter((entry) => entry.serverId !== serverId);
    if (project.slaveServers.length === before) return false;
    project.virtualDevices = project.virtualDevices.filter((entry) => entry.serverId !== serverId);
    this._persist(project, { slaveServers: project.slaveServers, virtualDevices: project.virtualDevices });
    this._emit('simulator.server-removed', serverId);
    return true;
  }

  listDevices(serverId = null) {
    const project = this._requireProject();
    return Object.freeze(project.virtualDevices
      .filter((entry) => serverId == null || entry.serverId === serverId)
      .map((entry) => Object.freeze(clone(entry))));
  }

  getDevice(deviceId) {
    const device = this._deviceConfig(deviceId);
    return Object.freeze(clone(device));
  }

  saveDevice(input) {
    const project = this._requireProject();
    const server = this._serverConfig(input?.serverId);
    if (this.runtimes.has(server.serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before changing device topology', { serverId: server.serverId });
    const deviceId = String(input?.deviceId || '').trim();
    const existing = deviceId ? project.virtualDevices.find((entry) => entry.deviceId === deviceId) || null : null;
    const device = normalizeDevice(input, server, existing);
    const unitConflict = project.virtualDevices.find((entry) => entry.serverId === server.serverId && entry.unitId === device.unitId && entry.deviceId !== device.deviceId);
    if (unitConflict) throw new SimulatorWorkspaceError('UNIT_ID_CONFLICT', `Unit ${device.unitId} already exists on ${server.serverId}`, { serverId: server.serverId, unitId: device.unitId });
    const index = project.virtualDevices.findIndex((entry) => entry.deviceId === device.deviceId);
    if (index >= 0) project.virtualDevices[index] = device;
    else project.virtualDevices.push(device);
    this._persist(project, { virtualDevices: project.virtualDevices });
    this._emit('simulator.device-saved', server.serverId, { deviceId: device.deviceId, unitId: device.unitId });
    return this.getDevice(device.deviceId);
  }

  removeDevice(deviceId) {
    const project = this._requireProject();
    const device = project.virtualDevices.find((entry) => entry.deviceId === deviceId);
    if (!device) return false;
    if (this.runtimes.has(device.serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before removing a device', { serverId: device.serverId, deviceId });
    project.virtualDevices = project.virtualDevices.filter((entry) => entry.deviceId !== deviceId);
    this._persist(project, { virtualDevices: project.virtualDevices });
    this._emit('simulator.device-removed', device.serverId, { deviceId, unitId: device.unitId });
    return true;
  }

  async startServer(serverId) {
    if (this.runtimes.has(serverId)) return this.getServer(serverId);
    const serverConfig = this._serverConfig(serverId);
    const profile = this._validateConnection(serverConfig);
    const runtime = this.broker.getConnection(serverConfig.connectionId);
    if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
      throw new SimulatorWorkspaceError('CONNECTION_ACTIVE', `Connection ${serverConfig.connectionId} must be inactive before starting Simulator`, { connectionId: serverConfig.connectionId, owner: runtime.owner });
    }
    const ownerId = `v8-simulator:${serverId}`;
    const server = new LabVirtualSlaveServer({
      broker: this.broker,
      connectionId: serverConfig.connectionId,
      ownerId,
      framing: serverConfig.framing,
      receivePollMs: serverConfig.receivePollMs,
    });
    const deviceConfigs = this._requireProject().virtualDevices.filter((entry) => entry.serverId === serverId);
    for (const config of deviceConfigs) {
      const device = server.addDevice(new VirtualDevice({ unitId: config.unitId, sizes: config.sizes, identity: config.identity }));
      this._seedPersistedMemory(device, config.memory);
    }
    const relay = (event) => this.emit('event', event);
    server.on('event', relay);
    server.on('write-audit', (record) => this.emit('write-audit', record));
    try {
      await server.start();
      this.runtimes.set(serverId, { server, ownerId, relay, startedAt: Date.now(), profileKind: profile.profile.transportKind });
      for (const device of deviceConfigs) {
        for (const generator of device.generators || []) this.generators.upsert({ ...generator, serverId, unitId: device.unitId });
      }
      this._emit('simulator.server-started', serverId, { connectionId: serverConfig.connectionId, units: deviceConfigs.map((item) => item.unitId) });
      return this.getServer(serverId);
    } catch (error) {
      server.off('event', relay);
      try { await server.stop({ closeConnection: true }); } catch { /* preserve start failure */ }
      throw error;
    }
  }

  async stopServer(serverId) {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) return this.getServer(serverId);
    for (const generator of this.generators.list({ serverId })) this.generators.remove(generator.generatorId);
    runtime.server.disarmFaultLab();
    runtime.server.off('event', runtime.relay);
    await runtime.server.stop({ closeConnection: true });
    this.runtimes.delete(serverId);
    this._emit('simulator.server-stopped', serverId);
    return this.getServer(serverId);
  }

  readMemory(deviceId, { area = 'holdingRegisters', address = 0, quantity = 16 } = {}) {
    if (!AREAS.has(area)) throw new SimulatorWorkspaceError('INVALID_MEMORY_AREA', `Unknown memory area ${area}`, { area });
    const config = this._deviceConfig(deviceId);
    const runtimeDevice = this.runtimes.get(config.serverId)?.server.getDevice(config.unitId) || null;
    const device = runtimeDevice || this._materialize(config);
    const values = device.read(area, int(address, 'address', 0, 65535), int(quantity, 'quantity', 1, 2000));
    return Object.freeze({ deviceId, serverId: config.serverId, unitId: config.unitId, area, address: Number(address), quantity: Number(quantity), values: Object.freeze(values) });
  }

  seedMemory(deviceId, { area, address, values } = {}) {
    if (!AREAS.has(area)) throw new SimulatorWorkspaceError('INVALID_MEMORY_AREA', `Unknown memory area ${area}`, { area });
    if (!Array.isArray(values) || !values.length) throw new SimulatorWorkspaceError('INVALID_MEMORY_VALUES', 'values must be a non-empty array');
    const project = this._requireProject();
    const index = project.virtualDevices.findIndex((entry) => entry.deviceId === deviceId);
    if (index < 0) throw new SimulatorWorkspaceError('DEVICE_NOT_FOUND', `Virtual device ${deviceId} was not found`, { deviceId });
    const config = project.virtualDevices[index];
    const start = int(address, 'address', 0, 65535);
    const validator = this.runtimes.get(config.serverId)?.server.getDevice(config.unitId) || this._materialize(config);
    validator.seed(area, start, values);
    const memory = clone(config.memory || {});
    const segments = Array.isArray(memory[area]) ? memory[area] : [];
    const key = `${start}:${values.length}`;
    const next = { address: start, values: clone(values) };
    const segmentIndex = segments.findIndex((entry) => `${entry.address}:${entry.values?.length || 0}` === key);
    if (segmentIndex >= 0) segments[segmentIndex] = next;
    else segments.push(next);
    memory[area] = segments.slice(-5000);
    config.memory = memory;
    project.virtualDevices[index] = config;
    this._persist(project, { virtualDevices: project.virtualDevices });
    const live = this.runtimes.get(config.serverId)?.server.getDevice(config.unitId);
    if (live && live !== validator) live.seed(area, start, values);
    this._emit('simulator.memory-seeded', config.serverId, { deviceId, unitId: config.unitId, area, address: start, quantity: values.length });
    return this.readMemory(deviceId, { area, address: start, quantity: values.length });
  }

  saveGenerator(deviceId, input) {
    const project = this._requireProject();
    const index = project.virtualDevices.findIndex((entry) => entry.deviceId === deviceId);
    if (index < 0) throw new SimulatorWorkspaceError('DEVICE_NOT_FOUND', `Virtual device ${deviceId} was not found`, { deviceId });
    const device = project.virtualDevices[index];
    const runtime = this.runtimes.get(device.serverId);
    const normalized = runtime
      ? this.generators.upsert({ ...input, serverId: device.serverId, unitId: device.unitId })
      : (() => {
          // Use a short-lived validator engine so stopped servers get the same validation without becoming active.
          const validator = new DynamicValueEngine({ resolveDevice: () => null });
          const result = validator.upsert({ ...input, serverId: device.serverId, unitId: device.unitId });
          validator.stop();
          return result;
        })();
    const persisted = stripGeneratorRuntime(normalized);
    const generators = Array.isArray(device.generators) ? device.generators : [];
    const generatorIndex = generators.findIndex((entry) => entry.generatorId === persisted.generatorId);
    if (generatorIndex >= 0) generators[generatorIndex] = persisted;
    else generators.push(persisted);
    device.generators = generators;
    project.virtualDevices[index] = device;
    this._persist(project, { virtualDevices: project.virtualDevices });
    this._emit('simulator.generator-persisted', device.serverId, { deviceId, unitId: device.unitId, generatorId: persisted.generatorId });
    return runtime ? this.generators.get(persisted.generatorId) : Object.freeze({ ...persisted, runtime: null });
  }

  removeGenerator(deviceId, generatorId) {
    const project = this._requireProject();
    const index = project.virtualDevices.findIndex((entry) => entry.deviceId === deviceId);
    if (index < 0) throw new SimulatorWorkspaceError('DEVICE_NOT_FOUND', `Virtual device ${deviceId} was not found`, { deviceId });
    const device = project.virtualDevices[index];
    const before = (device.generators || []).length;
    device.generators = (device.generators || []).filter((entry) => entry.generatorId !== generatorId);
    if (device.generators.length === before) return false;
    this.generators.remove(generatorId);
    project.virtualDevices[index] = device;
    this._persist(project, { virtualDevices: project.virtualDevices });
    return true;
  }

  armFaultLab(serverId, policy, { confirmed = false } = {}) {
    const runtime = this._runtime(serverId);
    const snapshot = runtime.server.armFaultLab(policy, { confirmed });
    this._emit('simulator.fault-lab-armed', serverId, { policy: snapshot.policy });
    return snapshot;
  }

  disarmFaultLab(serverId) {
    const runtime = this._runtime(serverId);
    const snapshot = runtime.server.disarmFaultLab();
    this._emit('simulator.fault-lab-disarmed', serverId);
    return snapshot;
  }

  getWriteAudit(serverId, options = {}) { return this._runtime(serverId).server.getWriteAudit(options); }
  listClientSessions(serverId) { return this._runtime(serverId).server.listClientSessions(); }

  async shutdown() {
    for (const serverId of [...this.runtimes.keys()]) {
      try { await this.stopServer(serverId); } catch { /* best effort */ }
    }
    this.generators.stop();
  }

  _serverView(config) {
    const runtime = this.runtimes.get(config.serverId);
    const deviceCount = this._requireProject().virtualDevices.filter((entry) => entry.serverId === config.serverId).length;
    return Object.freeze({
      ...clone(config),
      deviceCount,
      runtime: runtime ? runtime.server.snapshot() : Object.freeze({ running: false, connectionId: config.connectionId, framing: config.framing, faultLab: { enabled: false } }),
    });
  }

  _serverConfig(serverId) {
    const project = this._requireProject();
    const config = project.slaveServers.find((entry) => entry.serverId === serverId);
    if (!config) throw new SimulatorWorkspaceError('SERVER_NOT_FOUND', `Simulator server ${serverId} was not found`, { serverId });
    return config;
  }

  _deviceConfig(deviceId) {
    const project = this._requireProject();
    const device = project.virtualDevices.find((entry) => entry.deviceId === deviceId);
    if (!device) throw new SimulatorWorkspaceError('DEVICE_NOT_FOUND', `Virtual device ${deviceId} was not found`, { deviceId });
    return device;
  }

  _runtime(serverId) {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) throw new SimulatorWorkspaceError('SERVER_NOT_RUNNING', `Simulator server ${serverId} is not running`, { serverId });
    return runtime;
  }

  _requireProject() {
    const project = this.activeProject();
    if (!project) throw new SimulatorWorkspaceError('PROJECT_NOT_FOUND', 'No active v8 project');
    return project;
  }

  _persist(project, patch) {
    this.store.updateProject(project.id, patch);
  }

  _validateConnection(server) {
    const item = this.connectionCenter.get(server.connectionId);
    const kind = String(item.profile.transportKind || '').toLowerCase();
    const compatible = kind === 'virtual'
      || (server.framing === 'tcp' && kind === 'tcp-server')
      || (server.framing === 'rtu' && kind === 'serial-rtu')
      || (server.framing === 'ascii' && kind === 'serial-ascii');
    if (!compatible) throw new SimulatorWorkspaceError('SIMULATOR_TRANSPORT_MISMATCH', `Server framing ${server.framing} is incompatible with connection transport ${kind}`, { serverId: server.serverId, connectionId: server.connectionId, framing: server.framing, transportKind: kind });
    return item;
  }

  _materialize(config) {
    const device = new VirtualDevice({ unitId: config.unitId, sizes: config.sizes, identity: config.identity });
    this._seedPersistedMemory(device, config.memory);
    return device;
  }

  _seedPersistedMemory(device, memory = {}) {
    for (const area of AREAS) {
      for (const segment of Array.isArray(memory?.[area]) ? memory[area] : []) {
        device.seed(area, Number(segment.address), Array.isArray(segment.values) ? segment.values : []);
      }
    }
  }

  _emit(type, serverId, details = {}) {
    this.emit('event', createWorkbenchEvent({
      type,
      source: 'simulator-workspace',
      connectionId: serverId ? this._requireProject().slaveServers.find((entry) => entry.serverId === serverId)?.connectionId || null : null,
      ownerMode: 'slave',
      details: { serverId, ...details },
    }));
  }
}

module.exports = {
  SimulatorWorkspaceError,
  SimulatorWorkspaceService,
  normalizeServer,
  normalizeDevice,
};
