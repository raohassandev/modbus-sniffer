'use strict';

const base = require('./testCenterWorkspaceService');
const { RecipeEngine, validateRecipe } = require('./recipeEngineHardened');

class TestCenterWorkspaceService extends base.TestCenterWorkspaceService {
  constructor(options = {}) {
    super(options);
    this.recipe.stop();
    this.recipe = new RecipeEngine({ resolveContext: (connectionId) => this.sessions.get(connectionId)?.context || null });
    this.recipe.on('event', (event) => this.emit('event', event));
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
  TestCenterWorkspaceService,
};
