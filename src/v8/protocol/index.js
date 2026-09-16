'use strict';

const errors = require('./errors');
const model = require('./model');
const lrc = require('./lrc');
const framing = require('./framing');
const functions = require('./functions');
const dataTypes = require('./dataTypes');

module.exports = Object.freeze({
  ...errors,
  ...model,
  ...lrc,
  ...framing,
  ...functions,
  ...dataTypes,
});
