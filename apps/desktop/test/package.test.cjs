'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));

test('Windows packaging is branded, licensed, and aligned to v3', () => {
  assert.equal(manifest.version, '3.0.0');
  assert.equal(manifest.productName, '3aik');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.build.appId, 'com.3aik.desktop');
  assert.equal(manifest.build.win.icon, 'build-resources/icon.svg');
  assert.equal(manifest.build.nsis.license, 'build-resources/license.txt');
  assert.deepEqual(manifest.build.win.target.map((entry) => entry.target), ['nsis', 'portable']);
  assert.match(manifest.scripts['pack:win'], /--publish never/);
  assert.equal(Object.hasOwn(manifest.dependencies || {}, 'electron-updater'), false);
});

test('Linux packaging ships AppImage and deb with publish disabled', () => {
  assert.equal(manifest.build.linux.icon, 'build-resources/icon.svg');
  assert.equal(manifest.build.linux.category, 'Development');
  assert.deepEqual(manifest.build.linux.target.map((entry) => entry.target), ['AppImage', 'deb']);
  assert.match(manifest.scripts['pack:linux'], /--publish never/);
  assert.equal(manifest.build.appImage.artifactName, '3aik-${version}-${arch}.${ext}');
  assert.equal(manifest.build.deb.artifactName, '3aik_${version}_${arch}.${ext}');
});

test('packaged MIT license matches the repository license', () => {
  const packagedLicense = fs.readFileSync(path.join(desktopRoot, 'build-resources', 'license.txt'), 'utf8').trim();
  const repositoryLicense = fs.readFileSync(path.join(desktopRoot, '..', '..', 'LICENSE'), 'utf8').trim();
  assert.equal(packagedLicense, repositoryLicense);
  assert(manifest.build.extraResources.some((entry) => entry.to === 'LICENSE.txt'));
});
