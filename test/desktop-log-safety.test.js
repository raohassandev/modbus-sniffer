'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactLogSecrets } = require('../desktop/logSafety');

test('desktop log sanitizer redacts JSON and key=value credentials', () => {
  const input = 'auth {"password":"secret","accessToken":"abc"} token=xyz keyPath=/secure/client.key host=127.0.0.1';
  const safe = redactLogSecrets(input);
  assert.equal(safe.includes('secret'), false);
  assert.equal(safe.includes('abc'), false);
  assert.equal(safe.includes('xyz'), false);
  assert.equal(safe.includes('/secure/client.key'), false);
  assert.match(safe, /"password":"\[REDACTED\]"/);
  assert.match(safe, /token=\[REDACTED\]/);
  assert.match(safe, /host=127\.0\.0\.1/);
});

test('desktop log sanitizer redacts Authorization and Cookie headers', () => {
  const input = 'Authorization: Bearer super-token\nCookie: session=abc123; csrf=def456\nSet-Cookie: refresh=xyz789; HttpOnly';
  const safe = redactLogSecrets(input);
  assert.equal(safe.includes('super-token'), false);
  assert.equal(safe.includes('abc123'), false);
  assert.equal(safe.includes('def456'), false);
  assert.equal(safe.includes('xyz789'), false);
  assert.match(safe, /Authorization: \[REDACTED\]/);
  assert.match(safe, /Cookie: \[REDACTED\]/);
});

test('desktop log sanitizer removes accidental PEM private-key blocks', () => {
  const input = 'before -----BEGIN PRIVATE KEY-----\nABCDEF123456\n-----END PRIVATE KEY----- after';
  const safe = redactLogSecrets(input);
  assert.equal(safe.includes('ABCDEF123456'), false);
  assert.equal(safe, 'before [REDACTED PRIVATE KEY] after');
});
