'use strict';

const {
  SimulatorWorkspaceService: BaseSimulatorWorkspaceService,
  SimulatorWorkspaceError,
  normalizeServer,
  normalizeDevice,
} = require('./simulatorWorkspaceService');
const { LabVirtualSlaveServer } = require('./labVirtualSlaveServer');
const { VirtualDevice, normalizeWritableAreas } = require('./virtualDevice');
const { DynamicValueEngine } = require('./dynamicValueEngineHardened');

const SERVER_KINDS = Object.freeze({
  tcp: new Set(['tcp-server', 'udp-server', 'tls-server']),
  rtu: new Set(['serial-rtu', 'rtu-tcp-server', 'rtu-udp-server']),
  ascii: new Set(['serial-ascii', 'ascii-tcp-server', 'ascii-udp-server']),
});

class SimulatorWorkspaceService extends BaseSimulatorWorkspaceService {
  constructor(options = {}) {
    super(options);
    this.generators.stop();
    this.generators = new DynamicValueEngine({ resolveDevice: (serverId, unitId) => this.runtimes.get(serverId)?.server.getDevice(unitId) || null });
    this.generators.on('event', (event) => this.emit('event', event));
    this.generators.start();
  }

  saveDevice(input) {
    if (!input?.writableAreas) return super.saveDevice(input);
    let existingMetadata = {};
    try { existingMetadata = this._deviceConfig(input.deviceId)?.metadata || {}; } catch { /* new device */ }
    const writableAreas = normalizeWritableAreas(input.writableAreas);
    return super.saveDevice({
      ...input,
      metadata: {
        ...existingMetadata,
        ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}),
        writableAreas,
      },
    });
  }

  async startServer(serverId) {
    if (this.runtimes.has(serverId)) return this.getServer(serverId);
    const serverConfig = this._serverConfig(serverId);
    const twin = serverConfig.metadata?.digitalTwin;
    if (twin?.requiresApproval && twin.approved !== true) {
      throw new SimulatorWorkspaceError('DIGITAL_TWIN_APPROVAL_REQUIRED', 'Generated digital-twin servers must be reviewed and explicitly approved before they can run', {
        serverId,
        twinId: twin.twinId || null,
      });
    }

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
      const device = server.addDevice(new VirtualDevice({
        unitId: config.unitId,
        sizes: config.sizes,
        identity: config.identity,
        writableAreas: config.metadata?.writableAreas || {},
      }));
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

  _materialize(config) {
    const device = new VirtualDevice({
      unitId: config.unitId,
      sizes: config.sizes,
      identity: config.identity,
      writableAreas: config.metadata?.writableAreas || {},
    });
    this._seedPersistedMemory(device, config.memory);
    return device;
  }

  _validateConnection(server) {
    const item = this.connectionCenter.get(server.connectionId);
    const kind = String(item.profile.transportKind || '').toLowerCase();
    const compatible = kind === 'virtual' || Boolean(SERVER_KINDS[server.framing]?.has(kind));
    if (!compatible) {
      throw new SimulatorWorkspaceError('SIMULATOR_TRANSPORT_MISMATCH', `Server framing ${server.framing} is incompatible with connection transport ${kind}`, {
        serverId: server.serverId,
        connectionId: server.connectionId,
        framing: server.framing,
        transportKind: kind,
      });
    }
    return item;
  }
}

module.exports = {
  SERVER_KINDS,
  SimulatorWorkspaceError,
  SimulatorWorkspaceService,
  normalizeServer,
  normalizeDevice,
};
