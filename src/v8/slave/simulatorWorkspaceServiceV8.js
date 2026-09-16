'use strict';

const {
  SimulatorWorkspaceService: BaseSimulatorWorkspaceService,
  SimulatorWorkspaceError,
  normalizeServer,
  normalizeDevice,
} = require('./simulatorWorkspaceService');

const SERVER_KINDS = Object.freeze({
  tcp: new Set(['tcp-server', 'udp-server', 'tls-server']),
  rtu: new Set(['serial-rtu', 'rtu-tcp-server', 'rtu-udp-server']),
  ascii: new Set(['serial-ascii', 'ascii-tcp-server', 'ascii-udp-server']),
});

class SimulatorWorkspaceService extends BaseSimulatorWorkspaceService {
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
