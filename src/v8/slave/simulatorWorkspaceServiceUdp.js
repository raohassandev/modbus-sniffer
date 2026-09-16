'use strict';

const {
  SimulatorWorkspaceService: BaseSimulatorWorkspaceService,
  SimulatorWorkspaceError,
} = require('./simulatorWorkspaceService');
const { LabVirtualSlaveServer } = require('./labVirtualSlaveServer');
const { VirtualDevice } = require('./virtualDevice');

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
function normalizeSizes(value = {}, fallback = null) {
  const base = fallback || { coils: 1024, discreteInputs: 1024, holdingRegisters: 1024, inputRegisters: 1024 };
  return {
    coils: int(value.coils ?? base.coils, 'sizes.coils', 0, 65536),
    discreteInputs: int(value.discreteInputs ?? base.discreteInputs, 'sizes.discreteInputs', 0, 65536),
    holdingRegisters: int(value.holdingRegisters ?? base.holdingRegisters, 'sizes.holdingRegisters', 0, 65536),
    inputRegisters: int(value.inputRegisters ?? base.inputRegisters, 'sizes.inputRegisters', 0, 65536),
  };
}

function normalizeUdpServer(input, existing = null) {
  const serverId = text(input?.serverId || existing?.serverId, 'serverId');
  return {
    serverId,
    name: String(input?.name ?? existing?.name ?? serverId).trim().slice(0, 200) || serverId,
    connectionId: text(input?.connectionId || existing?.connectionId, 'connectionId'),
    framing: 'udp',
    receivePollMs: int(input?.receivePollMs ?? existing?.receivePollMs ?? 25, 'receivePollMs', 1, 60_000),
    metadata: input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : clone(existing?.metadata || {}),
  };
}

function normalizeUdpDevice(input, server, existing = null) {
  const unitId = int(input?.unitId ?? existing?.unitId, 'unitId', 1, 255);
  const deviceId = String(input?.deviceId || existing?.deviceId || `${server.serverId}:unit:${unitId}`).trim();
  if (!deviceId) throw new SimulatorWorkspaceError('INVALID_SIMULATOR_CONFIG', 'deviceId is required');
  return {
    deviceId,
    serverId: server.serverId,
    unitId,
    name: String(input?.name ?? existing?.name ?? `Unit ${unitId}`).trim().slice(0, 200) || `Unit ${unitId}`,
    sizes: normalizeSizes(input?.sizes || {}, existing?.sizes || null),
    identity: input?.identity && typeof input.identity === 'object' && !Array.isArray(input.identity) ? clone(input.identity) : clone(existing?.identity || {}),
    memory: input?.memory && typeof input.memory === 'object' && !Array.isArray(input.memory) ? clone(input.memory) : clone(existing?.memory || {}),
    generators: Array.isArray(input?.generators) ? clone(input.generators) : clone(existing?.generators || []),
    metadata: input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : clone(existing?.metadata || {}),
  };
}

class SimulatorWorkspaceService extends BaseSimulatorWorkspaceService {
  saveServer(input) {
    const requestedFraming = String(input?.framing || '').toLowerCase();
    if (requestedFraming !== 'udp') return super.saveServer(input);

    const project = this._requireProject();
    const id = String(input?.serverId || '').trim();
    const existing = id ? project.slaveServers.find((entry) => entry.serverId === id) || null : null;
    if (existing && this.runtimes.has(existing.serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before editing it', { serverId: existing.serverId });
    const server = normalizeUdpServer(input, existing);
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

  saveDevice(input) {
    const server = this._serverConfig(input?.serverId);
    if (server.framing !== 'udp') return super.saveDevice(input);

    const project = this._requireProject();
    if (this.runtimes.has(server.serverId)) throw new SimulatorWorkspaceError('SERVER_RUNNING', 'Stop the simulator server before changing device topology', { serverId: server.serverId });
    const deviceId = String(input?.deviceId || '').trim();
    const existing = deviceId ? project.virtualDevices.find((entry) => entry.deviceId === deviceId) || null : null;
    const device = normalizeUdpDevice(input, server, existing);
    const unitConflict = project.virtualDevices.find((entry) => entry.serverId === server.serverId && entry.unitId === device.unitId && entry.deviceId !== device.deviceId);
    if (unitConflict) throw new SimulatorWorkspaceError('UNIT_ID_CONFLICT', `Unit ${device.unitId} already exists on ${server.serverId}`, { serverId: server.serverId, unitId: device.unitId });
    const index = project.virtualDevices.findIndex((entry) => entry.deviceId === device.deviceId);
    if (index >= 0) project.virtualDevices[index] = device;
    else project.virtualDevices.push(device);
    this._persist(project, { virtualDevices: project.virtualDevices });
    this._emit('simulator.device-saved', server.serverId, { deviceId: device.deviceId, unitId: device.unitId });
    return this.getDevice(device.deviceId);
  }

  async startServer(serverId) {
    const serverConfig = this._serverConfig(serverId);
    if (serverConfig.framing !== 'udp') return super.startServer(serverId);
    if (this.runtimes.has(serverId)) return this.getServer(serverId);

    const profile = this._validateConnection(serverConfig);
    const runtime = this.broker.getConnection(serverConfig.connectionId);
    if (runtime.owner || ['open', 'opening', 'closing'].includes(runtime.state)) {
      throw new SimulatorWorkspaceError('CONNECTION_ACTIVE', `Connection ${serverConfig.connectionId} must be inactive before starting Simulator`, { connectionId: serverConfig.connectionId, owner: runtime.owner });
    }

    const ownerId = `v8-simulator:${serverId}`;
    // Native Modbus/UDP uses one MBAP/TID ADU per datagram. Internally the shared
    // Slave codec therefore uses its transaction-safe TCP framing, while the
    // persisted/workspace protocol remains explicitly labelled UDP.
    const server = new LabVirtualSlaveServer({
      broker: this.broker,
      connectionId: serverConfig.connectionId,
      ownerId,
      framing: 'tcp',
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
      this.runtimes.set(serverId, { server, ownerId, relay, startedAt: Date.now(), profileKind: profile.profile.transportKind, workspaceFraming: 'udp' });
      for (const device of deviceConfigs) {
        for (const generator of device.generators || []) this.generators.upsert({ ...generator, serverId, unitId: device.unitId });
      }
      this._emit('simulator.server-started', serverId, { connectionId: serverConfig.connectionId, framing: 'udp', units: deviceConfigs.map((item) => item.unitId) });
      return this.getServer(serverId);
    } catch (error) {
      server.off('event', relay);
      try { await server.stop({ closeConnection: true }); } catch { /* preserve start failure */ }
      throw error;
    }
  }

  _serverView(config) {
    const view = super._serverView(config);
    if (config.framing !== 'udp' || !view.runtime?.running) return view;
    return Object.freeze({
      ...view,
      runtime: Object.freeze({ ...view.runtime, framing: 'udp', protocolFraming: 'tcp-mbap' }),
    });
  }

  _validateConnection(server) {
    if (server.framing !== 'udp') return super._validateConnection(server);
    const item = this.connectionCenter.get(server.connectionId);
    const kind = String(item.profile.transportKind || '').toLowerCase();
    if (kind !== 'udp-server') {
      throw new SimulatorWorkspaceError('SIMULATOR_TRANSPORT_MISMATCH', `Server framing udp is incompatible with connection transport ${kind}`, { serverId: server.serverId, connectionId: server.connectionId, framing: 'udp', transportKind: kind });
    }
    return item;
  }
}

module.exports = {
  SimulatorWorkspaceService,
  normalizeUdpServer,
  normalizeUdpDevice,
};
