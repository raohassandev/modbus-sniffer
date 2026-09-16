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

function decodeRequestPdu(pdu) {
  return extendedFunctions.decodeExtendedRequestPdu(pdu) || functions.decodeRequestPdu(pdu);
}

module.exports = Object.freeze({
  ...errors,
  ...model,
  ...lrc,
  ...framing,
  ...functions,
  ...extendedFunctions,
  ...dataModel,
  FC,
  decodeRequestPdu,
});
