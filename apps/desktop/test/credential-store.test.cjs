'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCredentialStore } = require('../src/main/credential-store.cjs');
const { createSettingsStore } = require('../src/main/settings-store.cjs');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '3aik-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('API keys are encrypted before persistence when secure storage is available', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'credentials.json');
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^protected:/, '')
  };
  const store = createCredentialStore(file, secureStorage);
  const result = store.setLocalApiKey('secret-value', true);
  assert.equal(result.persistence, 'os-encrypted');
  assert(!fs.readFileSync(file, 'utf8').includes('secret-value'));
  assert.equal(createCredentialStore(file, secureStorage).getLocalApiKey(), 'secret-value');
});

test('API keys remain memory-only when secure storage is unavailable', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'credentials.json');
  const unavailable = { isEncryptionAvailable: () => false };
  const store = createCredentialStore(file, unavailable);
  const result = store.setLocalApiKey('session-secret', true);
  assert.equal(result.persistence, 'memory');
  assert.equal(store.getLocalApiKey(), 'session-secret');
  assert.equal(fs.existsSync(file), false);
  assert.equal(createCredentialStore(file, unavailable).getLocalApiKey(), '');
});

test('Electron basic_text backend is treated as insecure', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'credentials.json');
  const weakStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: () => {
      throw new Error('must not encrypt with basic_text');
    }
  };
  const store = createCredentialStore(file, weakStorage);
  assert.equal(store.encryptionAvailable(), false);
  assert.equal(store.setLocalApiKey('memory-only', true).persistence, 'memory');
  assert.equal(fs.existsSync(file), false);
});

test('credential store rejects unbounded secret payloads', (t) => {
  const directory = temporaryDirectory(t);
  const store = createCredentialStore(path.join(directory, 'credentials.json'), {
    isEncryptionAvailable: () => false
  });
  assert.throws(() => store.setLocalApiKey('x'.repeat(8193), false), /8,192/);
});

test('device ID is random, persisted, and omitted from renderer settings', (t) => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, 'settings.json');
  const first = createSettingsStore(file);
  first.load();
  const deviceId = first.getDeviceId();
  assert.match(deviceId, /^[a-f0-9-]{36}$/i);
  assert.equal(Object.hasOwn(first.get(), 'deviceId'), false);
  const second = createSettingsStore(file);
  second.load();
  assert.equal(second.getDeviceId(), deviceId);
});
