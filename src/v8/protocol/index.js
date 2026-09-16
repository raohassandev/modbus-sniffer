'use strict';

const errors = require('./errors');
const model = require('./model');
const lrc = require('./lrc');
const framing = require('./framing');
const functions = require('./functions');
const extendedFunctions = require('./extendedFunctions');
const dataModel = require('./dataModel');

const FC = Object.freeze({
  ...functions.FC,
  ...extendedFunctions.FC,
});

module.exports = Object.freeze({
  ...errors,
  ...model,
  ...lrc,
  ...framing,
  ...functions,
  ...extendedFunctions,
  ...dataModel,
  FC,
});
