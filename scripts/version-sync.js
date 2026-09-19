'use strict';

const fs = require('fs');
const path = require('path');
const { PRODUCT_VERSION } = require('../src/v8/version');

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
}

const root = readJson('package.json');
const rootLock = readJson('package-lock.json');
const desktop = readJson('desktop/package.json');
const desktopLock = readJson('desktop/package-lock.json');

const expected = String(PRODUCT_VERSION);
const values = {
  'src/v8/version.js': PRODUCT_VERSION,
  'package.json': root.version,
  'package-lock.json': rootLock.version,
  'package-lock root package': rootLock.packages?.['']?.version,
  'desktop/package.json': desktop.version,
  'desktop/package-lock.json': desktopLock.version,
  'desktop lock root package': desktopLock.packages?.['']?.version,
};

const mismatches = Object.entries(values).filter(([, value]) => String(value) !== expected);
if (mismatches.length) {
  console.error(`Release version mismatch. Expected every release surface to be ${expected}.`);
  for (const [name, value] of mismatches) console.error(` - ${name}: ${value}`);
  process.exit(1);
}

console.log(`Version sync PASS: ${expected}`);
