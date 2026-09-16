'use strict';

const { WebSocket } = require('ws');
const { startV8WorkbenchServer } = require('./workbenchServer');
const { assertFeature } = require('./featureFlags');
const { MasterWorkspaceService } = require('./master/masterWorkspaceService');
const { mountMasterWorkspaceRoutes } = require('./master/masterWorkspaceRoutes');
const { DiscoveryScanService } = require('./discovery/discoveryScanService');
const { mountDiscoveryRoutes } = require('./discovery/discoveryRoutes');

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

  const onMasterEvent = (event) => broadcast({ type: 'runtime.event', event });
  const onDiscoveryEvent = (event) => broadcast({ type: 'runtime.event', event });
  masterWorkspace.on('event', onMasterEvent);
  discovery.on('event', onDiscoveryEvent);

  const baseClose = web.close;
  return Object.freeze({
    ...web,
    masterWorkspace,
    discovery,
    async close() {
      discovery.off('event', onDiscoveryEvent);
      masterWorkspace.off('event', onMasterEvent);
      await discovery.shutdown();
      await masterWorkspace.shutdown();
      await baseClose();
    },
  });
}

module.exports = {
  startV8ProductServer,
};
