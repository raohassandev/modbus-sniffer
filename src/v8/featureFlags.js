'use strict';

const FEATURE_DEFINITIONS = Object.freeze({
  projectModel: Object.freeze({ defaultEnabled: true, stableFoundation: true }),
  connectionCenter: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  masterWorkspace: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  simulatorWorkspace: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  trafficWorkspace: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  registerLab: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  testCenter: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  historian: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  automation: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  hmiBuilder: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
  secureModbusTls: Object.freeze({ defaultEnabled: false, stableFoundation: false }),
});

class FeatureFlagError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FeatureFlagError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, FeatureFlagError);
  }
}

function parseBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && (value === 0 || value === 1)) return Boolean(value);
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  }
  throw new FeatureFlagError('INVALID_FEATURE_FLAG_VALUE', `${field} must be boolean-like`, { field, value });
}

function normalizeFeatureFlags(overrides = {}, { allowUnknown = false } = {}) {
  if (overrides == null) overrides = {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new FeatureFlagError('INVALID_FEATURE_FLAGS', 'Feature flags must be an object');
  }

  const result = {};
  for (const [name, definition] of Object.entries(FEATURE_DEFINITIONS)) {
    result[name] = definition.defaultEnabled;
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (!FEATURE_DEFINITIONS[name]) {
      if (allowUnknown) continue;
      throw new FeatureFlagError('UNKNOWN_FEATURE_FLAG', `Unknown v8 feature flag: ${name}`, { name });
    }
    result[name] = parseBoolean(value, name);
  }

  return Object.freeze(result);
}

function featureFlagsFromEnv(env = process.env) {
  const overrides = {};
  for (const name of Object.keys(FEATURE_DEFINITIONS)) {
    const key = `MODBUS_V8_${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}`;
    if (Object.prototype.hasOwnProperty.call(env, key)) overrides[name] = env[key];
  }
  return normalizeFeatureFlags(overrides);
}

function describeFeatureFlags(flags = normalizeFeatureFlags()) {
  const normalized = normalizeFeatureFlags(flags);
  return Object.freeze(Object.entries(FEATURE_DEFINITIONS).map(([name, definition]) => Object.freeze({
    name,
    enabled: normalized[name],
    stableFoundation: definition.stableFoundation,
  })));
}

module.exports = {
  FEATURE_DEFINITIONS,
  FeatureFlagError,
  normalizeFeatureFlags,
  featureFlagsFromEnv,
  describeFeatureFlags,
};
