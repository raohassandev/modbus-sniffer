'use strict';

function isAllowedNavigationUrl(target, selectedPort) {
  try {
    const expected = new URL(`http://127.0.0.1:${selectedPort}`);
    const parsed = new URL(String(target || ''));
    return parsed.origin === expected.origin;
  } catch {
    return false;
  }
}

module.exports = { isAllowedNavigationUrl };
