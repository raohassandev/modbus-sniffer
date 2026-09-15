'use strict';

const V8_FEATURE_FLAGS = Object.freeze({
  appShell: true,
  connectionCenter: true,
  projectSchemaV3: true,
  masterRuntime: true,
  slaveRuntime: true,
  masterWorkspace: false,
  simulatorWorkspace: false,
  unifiedTraffic: false,
  registerLab: false,
  discoveryWorkspace: false,
  testCenter: false,
  recipes: false,
  charts: false,
  logger: false,
  historian: false,
  automationApi: false,
  hmiBuilder: false,
  udpTransport: false,
  tlsTransport: false,
});

function getV8FeatureFlags(overrides = null) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return V8_FEATURE_FLAGS;
  const next = { ...V8_FEATURE_FLAGS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    next[key] = Boolean(value);
  }
  return Object.freeze(next);
}

module.exports = {
  V8_FEATURE_FLAGS,
  getV8FeatureFlags,
};
