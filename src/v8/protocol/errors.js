'use strict';

class ProtocolValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, ProtocolValidationError);
  }
}

function fail(code, message, details) {
  throw new ProtocolValidationError(code, message, details);
}

module.exports = {
  ProtocolValidationError,
  fail,
};
