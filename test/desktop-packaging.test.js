'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const desktopDir = path.join(root, 'desktop');
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
const mainSource = fs.readFileSync(path.join(desktopDir, 'main.js'), 'utf8');

test('desktop package includes every local module required by main.js', () => {
  const packagedFiles = new Set(desktopPackage.build?.files || []);
  const localRequires = [...mainSource.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)]
    .map(match => match[1])
    .map(specifier => specifier.endsWith('.js') ? specifier : `${specifier}.js`);

  assert.ok(localRequires.length > 0, 'expected desktop main.js to have local module dependencies');
  for (const requiredFile of localRequires) {
    assert.ok(
      fs.existsSync(path.join(desktopDir, requiredFile)),
      `desktop local module ${requiredFile} must exist`
    );
    assert.ok(
      packagedFiles.has(requiredFile),
      `desktop build.files must include local module ${requiredFile}`
    );
  }
});
