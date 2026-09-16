'use strict';

const DEFAULT_FLAGS = Object.freeze({
  shell: true,
  connectionCenter: true,
  masterWorkspace: true,
  discoveryWorkspace: true,
  simulatorWorkspace: true,
  trafficWorkspace: true,
  registerLabWorkspace: true,
  testCenterWorkspace: true,
  chartsWorkspace: true,
  historianWorkspace: true,
  automationWorkspace: false,
  hmiWorkspace: false,
});

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function loadFeatureFlags(env = process.env) {
  const flags = {};
  for (const [key, fallback] of Object.entries(DEFAULT_FLAGS)) {
    const envName = `MODBUS_V8_${key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
    flags[key] = parseBoolean(env[envName], fallback);
  }
  return Object.freeze(flags);
}

function assertFeature(flags, key) {
  if (!flags?.[key]) {
    const error = new Error(`v8 feature ${key} is disabled`);
    error.name = 'V8FeatureDisabledError';
    error.code = 'FEATURE_DISABLED';
    error.feature = key;
    throw error;
  }
}

module.exports = {
  DEFAULT_FLAGS,
  loadFeatureFlags,
  assertFeature,
};
