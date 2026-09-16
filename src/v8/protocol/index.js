'use strict';

const errors = require('./errors');
const model = require('./model');
const lrc = require('./lrc');
const framing = require('./framing');
const functions = require('./functions');
const extendedFunctions = require('./extendedFunctions');
const dataTypes = require('./dataTypes');

const FC = Object.freeze({
  ...functions.FC,
  ...extendedFunctions.EXTENDED_FC,
});

module.exports = Object.freeze({
  ...errors,
  ...model,
  ...lrc,
  ...framing,
  ...functions,
  ...extendedFunctions,
  ...dataTypes,
  FC,
});
