'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SETTINGS } = require('../shared/contracts.cjs');
const { normalizeAgentBaseUrl, normalizeLocalModelBaseUrl } = require('./security.cjs');

const THEMES = new Set(['system', 'dark', 'light']);
const APPROVAL_MODES = new Set(['ask', 'read-only']);
const AGENT_PROVIDERS = new Set(['3aik-cloud', 'openai-compatible']);
const LOCAL_PRESETS = new Set(['ollama', 'lm-studio', 'llama-cpp', 'custom']);

function sanitizeSettings(input, fallback = DEFAULT_SETTINGS) {
  const candidate = input && typeof input === 'object' ? input : {};
  const normalizedBaseUrl = normalizeAgentBaseUrl(candidate.agentBaseUrl);
  const normalizedLocalBaseUrl = normalizeLocalModelBaseUrl(candidate.localBaseUrl);
  const localModel = typeof candidate.localModel === 'string' ? candidate.localModel.trim() : '';

  return {
    theme: THEMES.has(candidate.theme) ? candidate.theme : fallback.theme,
    approvalMode: APPROVAL_MODES.has(candidate.approvalMode)
      ? candidate.approvalMode
      : fallback.approvalMode,
    openLastProject:
      typeof candidate.openLastProject === 'boolean'
        ? candidate.openLastProject
        : fallback.openLastProject,
    compactActivity:
      typeof candidate.compactActivity === 'boolean'
        ? candidate.compactActivity
        : fallback.compactActivity,
    agentProvider: AGENT_PROVIDERS.has(candidate.agentProvider)
      ? candidate.agentProvider
      : fallback.agentProvider,
    agentBaseUrl: normalizedBaseUrl || fallback.agentBaseUrl,
    localPreset: LOCAL_PRESETS.has(candidate.localPreset)
      ? candidate.localPreset
      : fallback.localPreset,
    localBaseUrl: normalizedLocalBaseUrl || fallback.localBaseUrl,
    localModel: localModel && localModel.length <= 160 ? localModel : fallback.localModel
  };
}

function createSettingsStore(filePath) {
  let state = { ...DEFAULT_SETTINGS };
  let lastProject = null;
  let deviceId = randomUUID();

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = sanitizeSettings(parsed);
      lastProject = typeof parsed.lastProject === 'string' ? parsed.lastProject : null;
      deviceId = typeof parsed.deviceId === 'string' && /^[a-f0-9-]{36}$/i.test(parsed.deviceId)
        ? parsed.deviceId
        : deviceId;
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        console.warn('Could not read desktop settings:', error.message);
      }
    }
    persist();
    return get();
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify({ ...state, lastProject, deviceId }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    fs.renameSync(temporaryPath, filePath);
  }

  function get() {
    return { ...state };
  }

  function update(patch) {
    state = sanitizeSettings({ ...state, ...(patch || {}) }, state);
    persist();
    return get();
  }

  function getLastProject() {
    return lastProject;
  }

  function getDeviceId() {
    return deviceId;
  }

  function setLastProject(projectPath) {
    lastProject = typeof projectPath === 'string' ? projectPath : null;
    persist();
  }

  return { get, getDeviceId, getLastProject, load, setLastProject, update };
}

module.exports = { createSettingsStore, sanitizeSettings };
