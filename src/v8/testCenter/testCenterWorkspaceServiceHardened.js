'use strict';

const base = require('./testCenterWorkspaceService');
const { RecipeEngine, validateRecipe } = require('./recipeEngineHardened');
const { RawFrameStudio, RawFrameStudioError } = require('./rawFrameStudio');

function preflightRepeat(input = {}) {
  const count = input.count ?? 1;
  const intervalMs = input.intervalMs ?? 0;
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new RawFrameStudioError('INVALID_REPEAT_COUNT', 'count must be 1..10000');
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new RawFrameStudioError('INVALID_REPEAT_INTERVAL', 'intervalMs must be >= 0');
}

class TestCenterWorkspaceService extends base.TestCenterWorkspaceService {
  constructor(options = {}) {
    super(options);
    this.recipe.stop();
    this.recipe = new RecipeEngine({ resolveContext: (connectionId) => this.sessions.get(connectionId)?.context || null });
    this.recipe.on('event', (event) => this.emit('event', event));
  }

  _rawPreview(input = {}) {
    const connectionId = String(input.connectionId || '').trim();
    if (!connectionId) throw new base.TestCenterWorkspaceError('CONNECTION_REQUIRED', 'connectionId is required');
    const existing = this.sessions.get(connectionId);
    let studio = existing?.raw || null;
    if (!studio) {
      const projectId = this.connectionCenter.activeProjectId();
      const profile = this.connectionCenter.listProfiles(projectId).find((entry) => entry.connectionId === connectionId);
      if (!profile) throw new base.TestCenterWorkspaceError('PROFILE_NOT_FOUND', `Connection profile ${connectionId} was not found`, { connectionId, projectId });
      if (!this._eligible(profile)) throw new base.TestCenterWorkspaceError('TEST_TRANSPORT_UNSUPPORTED', 'Test Center requires serial RTU/ASCII, TCP client or virtual transport', { connectionId, transportKind: profile.transportKind });
      studio = new RawFrameStudio({ broker: this.broker, connectionId, ownerId: `v8-preflight:test:${connectionId}`, framing: this._framing(profile) });
    }
    const raw = studio.prepare(input);
    return { studio, existing, classification: studio.classify(raw) };
  }

  _preflightRaw(input = {}) {
    const { studio, existing, classification } = this._rawPreview(input);
    if (classification.category === 'write' && input.confirmation?.write !== true) {
      throw new RawFrameStudioError('WRITE_CONFIRMATION_REQUIRED', 'Validated write frames require explicit write confirmation');
    }
    if (classification.category === 'raw' && (input.confirmation?.raw !== true || existing?.raw?.labArmed !== true)) {
      throw new RawFrameStudioError('LAB_NOT_ARMED', 'Malformed, vendor or manual raw frames require an already armed LAB session and per-send raw confirmation');
    }
    return { studio, classification };
  }

  async sendRaw(input = {}) {
    this._preflightRaw(input);
    return super.sendRaw(input);
  }

  async repeatRaw(input = {}) {
    preflightRepeat(input);
    this._preflightRaw(input);
    return super.repeatRaw(input);
  }

  async armLab(connectionId, options = {}) {
    if (!options?.confirmation?.confirmed || options.confirmation.raw !== true) {
      throw new RawFrameStudioError('LAB_CONFIRMATION_REQUIRED', 'LAB/raw transmission requires explicit raw-frame confirmation');
    }
    return super.armLab(connectionId, options);
  }

  async armWrites(connectionId, options = {}) {
    if (options?.confirmation?.confirmed !== true) {
      throw new base.TestCenterWorkspaceError('CONFIRMATION_REQUIRED', 'Explicit confirmation is required before enabling Test Center writes');
    }
    return super.armWrites(connectionId, options);
  }

  async runRecipe(recipe, options = {}) {
    // Validate the fully expanded execution budget before _ensureSession() can
    // open a serial/network transport or claim a Connection Broker resource.
    validateRecipe(recipe);
    return super.runRecipe(recipe, options);
  }
}

module.exports = {
  ...base,
  preflightRepeat,
  TestCenterWorkspaceService,
};
