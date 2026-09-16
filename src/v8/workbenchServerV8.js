'use strict';

const { WebSocket } = require('ws');
const { startV8WorkbenchServer } = require('./workbenchServer');
const { ConnectionCenterServiceV8 } = require('./connectionCenterServiceV8');
const { assertFeature } = require('./featureFlags');
const { MasterWorkspaceService } = require('./master/masterWorkspaceServiceHardened');
const { mountMasterWorkspaceRoutes } = require('./master/masterWorkspaceRoutes');
const { DiscoveryScanService } = require('./discovery/discoveryScanService');
const { mountDiscoveryRoutes } = require('./discovery/discoveryRoutes');
const { SimulatorWorkspaceService } = require('./slave/simulatorWorkspaceServiceV8');
const { mountSimulatorRoutes } = require('./slave/simulatorRoutes');
const { TrafficTimelineService } = require('./traffic/trafficTimelineService');
const { RegisterLabService } = require('./traffic/registerLabService');
const { mountTrafficRegisterRoutes } = require('./traffic/trafficRoutes');
const { DigitalTwinService } = require('./digitalTwin/digitalTwinService');
const { mountDigitalTwinRoutes } = require('./digitalTwin/digitalTwinRoutes');
const { TestCenterWorkspaceService } = require('./testCenter/testCenterWorkspaceService');
const { mountTestCenterRoutes } = require('./testCenter/testCenterRoutes');
const { HistoryWorkspaceService } = require('./history/historyWorkspaceService');
const { mountHistoryRoutes } = require('./history/historyRoutes');
const { HmiBuilderService } = require('./hmi/hmiBuilderServiceHardened');
const { mountHmiRoutes } = require('./hmi/hmiRoutes');

async function startV8ProductServer(options = {}) {
  const connectionCenter = options.connectionCenter || new ConnectionCenterServiceV8({ store: options.store, broker: options.broker });
  const web = await startV8WorkbenchServer({ ...options, connectionCenter });
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
  const testCenter = new TestCenterWorkspaceService({
    store: options.store,
    broker: options.broker,
    connectionCenter: web.center,
  });
  const timeline = new TrafficTimelineService({ maxEvents: 20000 });
  const registerLab = new RegisterLabService({ store: options.store, broker: options.broker });
  const digitalTwin = new DigitalTwinService({ store: options.store, registerLab, simulator });
  const history = new HistoryWorkspaceService({ store: options.store, registerLab, dataDir: options.store?.dataDir });
  const hmi = new HmiBuilderService({ store: options.store, masterWorkspace, testCenter });

  const broadcast = (event) => {
    const payload = JSON.stringify({ at: Date.now(), ...event });
    for (const client of web.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  };

  mountMasterWorkspaceRoutes({ app: web.app, masterWorkspace, flags: options.flags, assertFeature, broadcast });
  mountDiscoveryRoutes({ app: web.app, discovery, flags: options.flags, assertFeature, broadcast });
  mountSimulatorRoutes({ app: web.app, simulator, flags: options.flags, assertFeature, broadcast });
  mountTrafficRegisterRoutes({ app: web.app, timeline, registerLab, flags: options.flags, assertFeature, broadcast });
  mountDigitalTwinRoutes({ app: web.app, digitalTwin, flags: options.flags, assertFeature, broadcast });
  mountTestCenterRoutes({ app: web.app, testCenter, flags: options.flags, assertFeature, broadcast });
  mountHistoryRoutes({ app: web.app, history, flags: options.flags, assertFeature, broadcast });
  mountHmiRoutes({ app: web.app, hmi, flags: options.flags, assertFeature, broadcast });

  const capture = (event) => {
    const normalized = timeline.ingest(event);
    registerLab.ingest(normalized);
    return normalized;
  };
  const relay = (event) => {
    capture(event);
    broadcast({ type: 'runtime.event', event });
  };
  const passiveRelay = (event) => broadcast({ type: 'runtime.event', event });
  const onHistoryEvent = (event) => broadcast({ type: 'runtime.event', event });
  const onHistoryError = (error) => broadcast({ type: 'history.error', error: { code: error?.code || null, message: String(error?.message || error) } });
  const onBrokerEvent = (event) => capture(event);
  masterWorkspace.on('event', relay);
  discovery.on('event', relay);
  simulator.on('event', relay);
  testCenter.on('event', relay);
  digitalTwin.on('event', passiveRelay);
  history.on('event', onHistoryEvent);
  history.on('error', onHistoryError);
  hmi.on('event', passiveRelay);
  options.broker.on('event', onBrokerEvent);

  const baseClose = web.close;
  return Object.freeze({
    ...web,
    masterWorkspace,
    discovery,
    simulator,
    testCenter,
    timeline,
    registerLab,
    digitalTwin,
    history,
    hmi,
    async close() {
      options.broker.off('event', onBrokerEvent);
      hmi.off('event', passiveRelay);
      history.off('event', onHistoryEvent);
      history.off('error', onHistoryError);
      digitalTwin.off('event', passiveRelay);
      testCenter.off('event', relay);
      simulator.off('event', relay);
      discovery.off('event', relay);
      masterWorkspace.off('event', relay);
      history.shutdown();
      await testCenter.shutdown();
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
