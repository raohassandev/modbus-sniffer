'use strict';

// Default browser validation targets the shipped unified Modbus Engineering Tool.
// Internal compatibility-shell coverage remains available explicitly via
// `npm run e2e:compat` and is not a second product launch path.
module.exports = require('./playwright.unified.config');
