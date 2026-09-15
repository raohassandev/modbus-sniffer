'use strict';

const AREAS = Object.freeze({
  coils: Object.freeze({ prefix: '0', functionCode: 1 }),
  discreteInputs: Object.freeze({ prefix: '1', functionCode: 2 }),
  inputRegisters: Object.freeze({ prefix: '3', functionCode: 4 }),
  holdingRegisters: Object.freeze({ prefix: '4', functionCode: 3 }),
});

class AddressNotationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AddressNotationError';
    this.code = code;
    this.details = { ...details };
    Error.captureStackTrace?.(this, AddressNotationError);
  }
}

function validateCanonical(address) {
  if (!Number.isInteger(address) || address < 0 || address > 0xFFFF) {
    throw new AddressNotationError('ADDRESS_OUT_OF_RANGE', 'Canonical Modbus address must be 0..65535', { address });
  }
  return address;
}

function validateArea(area) {
  if (!AREAS[area]) throw new AddressNotationError('INVALID_AREA', `Unsupported Modbus area: ${area}`, { area });
  return area;
}

function toCanonicalAddress(value, { mode = 'zero-based', area = null } = {}) {
  if (mode === 'zero-based') {
    const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    return validateCanonical(numeric);
  }
  if (mode === 'one-based') {
    const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65536) throw new AddressNotationError('ADDRESS_OUT_OF_RANGE', 'One-based Modbus address must be 1..65536', { value });
    return numeric - 1;
  }
  if (mode !== 'reference') throw new AddressNotationError('INVALID_MODE', `Unsupported address mode: ${mode}`, { mode });

  validateArea(area);
  const text = String(value ?? '').trim();
  if (!/^\d{5,6}$/.test(text)) throw new AddressNotationError('INVALID_REFERENCE', 'Reference notation must contain exactly 5 or 6 digits', { value, area });
  const expectedPrefix = AREAS[area].prefix;
  if (text[0] !== expectedPrefix) {
    throw new AddressNotationError('AREA_PREFIX_MISMATCH', `Reference ${text} does not match area ${area}`, { value: text, area, expectedPrefix });
  }
  const offsetText = text.slice(1);
  const oneBased = Number(offsetText);
  const max = text.length === 5 ? 9999 : 99999;
  if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > max) throw new AddressNotationError('INVALID_REFERENCE', 'Reference offset must be one-based and non-zero', { value: text });
  return validateCanonical(oneBased - 1);
}

function formatAddress(address, { mode = 'zero-based', area = null, extended = false } = {}) {
  validateCanonical(address);
  if (mode === 'zero-based') return String(address);
  if (mode === 'one-based') return String(address + 1);
  if (mode !== 'reference') throw new AddressNotationError('INVALID_MODE', `Unsupported address mode: ${mode}`, { mode });
  validateArea(area);
  const digits = extended ? 5 : 4;
  const oneBased = address + 1;
  if (!extended && oneBased > 9999) {
    throw new AddressNotationError('REFERENCE_WIDTH_OVERFLOW', 'Address requires extended 6-digit reference notation', { address, area });
  }
  return `${AREAS[area].prefix}${String(oneBased).padStart(digits, '0')}`;
}

function addressView(address, area) {
  validateArea(area);
  validateCanonical(address);
  return Object.freeze({
    area,
    functionCode: AREAS[area].functionCode,
    canonical: address,
    zeroBased: formatAddress(address, { mode: 'zero-based' }),
    oneBased: formatAddress(address, { mode: 'one-based' }),
    reference: address < 9999 ? formatAddress(address, { mode: 'reference', area }) : null,
    extendedReference: formatAddress(address, { mode: 'reference', area, extended: true }),
  });
}

module.exports = {
  AREAS,
  AddressNotationError,
  addressView,
  formatAddress,
  toCanonicalAddress,
  validateCanonical,
};
