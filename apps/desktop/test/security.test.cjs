'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { ALLOWED_EVENT_CHANNELS, ALLOWED_INVOKE_CHANNELS, INVOKE_CHANNELS } = require('../src/shared/contracts.cjs');
const {
  isAllowedChatNavigation,
  isAllowedExternalUrl,
  isAllowedIpcChannel,
  isPathWithin,
  isTrustedRendererUrl,
  isVersionNewer,
  normalizeLocalModelBaseUrl,
  normalizeViewBounds,
  resolveAssetPath
} = require('../src/main/security.cjs');

test('IPC is deny-by-default and only exposes named channels', () => {
  assert.equal(new Set(ALLOWED_INVOKE_CHANNELS).size, ALLOWED_INVOKE_CHANNELS.length);
  assert.equal(new Set(ALLOWED_EVENT_CHANNELS).size, ALLOWED_EVENT_CHANNELS.length);
  assert.equal(isAllowedIpcChannel(INVOKE_CHANNELS.SELECT_PROJECT), true);
  assert.equal(isAllowedIpcChannel('electron:execute-shell'), false);
  assert.equal(isAllowedIpcChannel('desktop:agent-event', 'event'), true);
  assert.equal(isAllowedIpcChannel('desktop:get-bootstrap', 'event'), false);
});

test('trusted renderer and chat navigation checks require exact origins', () => {
  assert.equal(isTrustedRendererUrl('app://desktop/index.html'), true);
  assert.equal(isTrustedRendererUrl('app://desktop.evil.test/index.html'), false);
  assert.equal(isTrustedRendererUrl('https://3aik.com'), false);
  assert.equal(isAllowedChatNavigation('https://3aik.com/chat?id=1'), true);
  assert.equal(isAllowedChatNavigation('http://3aik.com/chat'), false);
  assert.equal(isAllowedChatNavigation('https://3aik.com.evil.test'), false);
});

test('external URL allowlist does not accept prefix or credential tricks', () => {
  assert.equal(isAllowedExternalUrl('https://3aik.com/docs'), true);
  assert.equal(isAllowedExternalUrl('https://github.com/alivirgo/3aik-web2/issues'), true);
  assert.equal(isAllowedExternalUrl('https://github.com/alivirgo/other'), false);
  assert.equal(isAllowedExternalUrl('https://github.com/alivirgo/3aik-web2-evil'), false);
  assert.equal(isAllowedExternalUrl('https://3aik.com@evil.test'), false);
  assert.equal(isAllowedExternalUrl('file:///C:/Windows/System32/calc.exe'), false);
});

test('path containment rejects sibling prefix attacks and traversal', () => {
  const root = path.join(os.tmpdir(), 'desktop-assets');
  assert.equal(isPathWithin(root, path.join(root, 'index.html')), true);
  assert.equal(isPathWithin(root, root), true);
  assert.equal(isPathWithin(root, `${root}-evil${path.sep}index.html`), false);
  assert.equal(isPathWithin(root, path.resolve(root, '..', 'secret.txt')), false);
  assert.equal(resolveAssetPath(root, 'app://desktop/styles.css'), path.join(root, 'styles.css'));
  assert.throws(() => resolveAssetPath(root, 'app://attacker/styles.css'), /Untrusted/);
});

test('local model endpoints are limited to loopback and private networks', () => {
  assert.equal(normalizeLocalModelBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeLocalModelBaseUrl('http://localhost:1234/v1'), 'http://localhost:1234/v1');
  assert.equal(normalizeLocalModelBaseUrl('https://192.168.1.8:8443/v1'), 'https://192.168.1.8:8443/v1');
  assert.equal(normalizeLocalModelBaseUrl('https://models.example.com/v1'), null);
  assert.equal(normalizeLocalModelBaseUrl('https://fdown.example/v1'), null);
  assert.equal(normalizeLocalModelBaseUrl('file:///tmp/model'), null);
});

test('chat view bounds are finite and clamped to the window', () => {
  assert.deepEqual(
    normalizeViewBounds({ x: -4, y: 60, width: 2000, height: 900 }, { width: 1200, height: 800 }),
    { x: 0, y: 60, width: 1200, height: 740 }
  );
  assert.equal(normalizeViewBounds({ x: 1, y: 2, width: 'bad', height: 4 }, { width: 10, height: 10 }), null);
});

test('update comparison does not offer older or malformed releases', () => {
  assert.equal(isVersionNewer('0.2.0', '0.1.9'), true);
  assert.equal(isVersionNewer('1.0.0', '0.9.9'), true);
  assert.equal(isVersionNewer('0.1.0', '0.1.0'), false);
  assert.equal(isVersionNewer('0.0.9', '0.1.0'), false);
  assert.equal(isVersionNewer('latest', '0.1.0'), false);
});
