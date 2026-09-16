'use strict';

const { WebSocket } = require('ws');
const { startV8WorkbenchServer } = require('./workbenchServer');
const { assertFeature } = require('./featureFlags');
const { MasterWorkspaceService } = require('./master/masterWorkspaceService');
const { mountMasterWorkspaceRoutes } = require('./master/masterWorkspaceRoutes');
const { DiscoveryScanService } = require('./discovery/discoveryScanService');
const { mountDiscoveryRoutes } = require('./discovery/discoveryRoutes');
const { SimulatorWorkspaceService } = require('./slave/simulatorWorkspaceService');
const { mountSimulatorRoutes } = require('./slave/simulatorRoutes');

async function startV8ProductServer(options = {}) {
  const web = await startV8WorkbenchServer(options);
  const masterWorkspace = new MasterWorkspaceService({
    store: options.store,
    broker: options.broker,
    connectionCenter: web.center,
  });
  const discovery = new DiscoveryScanService({
    store: options.store,
    broker: options.broker,
    connectionCenter: web.center,
    masterWorkspace,
  });
  const simulator = new SimulatorWorkspaceService({
    store: options.store,
    broker: options.broker,
    connectionCenter: web.center,
  });

  const broadcast = (event) => {
    const payload = JSON.stringify({ at: Date.now(), ...event });
    for (const client of web.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  mountMasterWorkspaceRoutes({
    app: web.app,
    masterWorkspace,
    flags: options.flags,
    assertFeature,
    broadcast,
  });
  mountDiscoveryRoutes({
    app: web.app,
    discovery,
    flags: options.flags,
    assertFeature,
    broadcast,
  });
  mountSimulatorRoutes({
    app: web.app,
    simulator,
    flags: options.flags,
    assertFeature,
    broadcast,
  });

  const onMasterEvent = (event) => broadcast({ type: 'runtime.event', event });
  const onDiscoveryEvent = (event) => broadcast({ type: 'runtime.event', event });
  const onSimulatorEvent = (event) => broadcast({ type: 'runtime.event', event });
  masterWorkspace.on('event', onMasterEvent);
  discovery.on('event', onDiscoveryEvent);
  simulator.on('event', onSimulatorEvent);

  const baseClose = web.close;
  return Object.freeze({
    ...web,
    masterWorkspace,
    discovery,
    simulator,
    async close() {
      simulator.off('event', onSimulatorEvent);
      discovery.off('event', onDiscoveryEvent);
      masterWorkspace.off('event', onMasterEvent);
      await simulator.shutdown();
      await discovery.shutdown();
      await masterWorkspace.shutdown();
      await baseClose();
    },
  });
}

module.exports = {
  startV8ProductServer,
};
