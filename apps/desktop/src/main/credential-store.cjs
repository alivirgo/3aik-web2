'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createCredentialStore(filePath, secureStorage) {
  let memoryApiKey = '';

  function encryptionAvailable() {
    try {
      if (!secureStorage || !secureStorage.isEncryptionAvailable()) return false;
      if (
        typeof secureStorage.getSelectedStorageBackend === 'function' &&
        secureStorage.getSelectedStorageBackend() === 'basic_text'
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function readPersisted() {
    if (!encryptionAvailable()) return '';
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (typeof payload.localApiKey !== 'string') return '';
      return secureStorage.decryptString(Buffer.from(payload.localApiKey, 'base64'));
    } catch {
      return '';
    }
  }

  function getLocalApiKey() {
    return memoryApiKey || readPersisted();
  }

  function hasLocalApiKey() {
    return Boolean(getLocalApiKey());
  }

  function clearPersisted() {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }

  function setLocalApiKey(value, remember) {
    const apiKey = typeof value === 'string' ? value.trim() : '';
    if (apiKey.length > 8192) throw new Error('API key must be 8,192 characters or fewer.');
    memoryApiKey = apiKey;
    if (!apiKey) {
      clearPersisted();
      return { stored: false, persistence: 'none' };
    }

    if (remember && encryptionAvailable()) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const encrypted = secureStorage.encryptString(apiKey).toString('base64');
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify({ localApiKey: encrypted }, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      fs.renameSync(temporaryPath, filePath);
      return { stored: true, persistence: 'os-encrypted' };
    }

    clearPersisted();
    return { stored: true, persistence: 'memory' };
  }

  return {
    encryptionAvailable,
    getLocalApiKey,
    hasLocalApiKey,
    setLocalApiKey
  };
}

module.exports = { createCredentialStore };
