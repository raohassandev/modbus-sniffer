'use strict';

const errors = require('./errors');
const model = require('./model');
const lrc = require('./lrc');
const framing = require('./framing');
const functions = require('./functions');

module.exports = Object.freeze({
  ...errors,
  ...model,
  ...lrc,
  ...framing,
  ...functions,
});
