'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../public/v8/traffic-register.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../public/v8/traffic-register.css'), 'utf8');

test('v8 Register Lab requests 10k points and renders a virtual window instead of every row', () => {
  assert.match(source, /URLSearchParams\(\{limit:'10000'\}\)/);
  assert.match(source, /registerState\.points\.slice\(start,end\)\.map\(registerRow\)/);
  assert.match(source, /registerSpacerRow\(start\*rowHeight\)/);
  assert.match(source, /registerSpacerRow\(\(total-end\)\*rowHeight\)/);
  assert.doesNotMatch(source, /body\.replaceChildren\(\.\.\.registerState\.points\.map/);
});

test('v8 Register Lab virtual window rerenders on scroll and keeps keyboard navigation', () => {
  assert.match(source, /registerViewport[^\n]*addEventListener\('scroll',renderRegisterRows\)/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.ok(source.includes(`event.key==='${key}'`));
  assert.match(css, /\.register-spacer-row td\{padding:0!important;border:0!important\}/);
  assert.match(css, /\.register-row:focus-visible/);
});
