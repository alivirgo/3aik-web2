'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preload scripts cannot load arbitrary local modules. Keep this
// literal map synchronized with shared/contracts.cjs; a test enforces parity.
const INVOKE_CHANNELS = Object.freeze({
  GET_BOOTSTRAP: 'desktop:get-bootstrap',
  SET_ACTIVE_VIEW: 'desktop:set-active-view',
  SET_CHAT_BOUNDS: 'desktop:set-chat-bounds',
  RELOAD_CHAT: 'desktop:reload-chat',
  SELECT_PROJECT: 'desktop:select-project',
  RUN_AGENT_TASK: 'desktop:run-agent-task',
  CANCEL_AGENT_TASK: 'desktop:cancel-agent-task',
  RESOLVE_APPROVAL: 'desktop:resolve-approval',
  GET_SETTINGS: 'desktop:get-settings',
  SET_SETTINGS: 'desktop:set-settings',
  TEST_MODEL_CONNECTION: 'desktop:test-model-connection',
  GET_ABOUT: 'desktop:get-about',
  CHECK_FOR_UPDATES: 'desktop:check-for-updates',
  OPEN_EXTERNAL: 'desktop:open-external'
});
const EVENT_CHANNELS = Object.freeze({
  AGENT_EVENT: 'desktop:agent-event',
  CHAT_STATUS: 'desktop:chat-status',
  NAVIGATE: 'desktop:navigate'
});

function subscribe(channel, listener) {
  if (typeof listener !== 'function') throw new TypeError('Listener must be a function.');
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const desktopAPI = Object.freeze({
  platform: process.platform,
  getBootstrap: () => ipcRenderer.invoke(INVOKE_CHANNELS.GET_BOOTSTRAP),
  setActiveView: (view) => ipcRenderer.invoke(INVOKE_CHANNELS.SET_ACTIVE_VIEW, view),
  setChatBounds: (bounds) => ipcRenderer.invoke(INVOKE_CHANNELS.SET_CHAT_BOUNDS, { ...bounds }),
  reloadChat: () => ipcRenderer.invoke(INVOKE_CHANNELS.RELOAD_CHAT),
  selectProject: () => ipcRenderer.invoke(INVOKE_CHANNELS.SELECT_PROJECT),
  runAgentTask: (prompt) => ipcRenderer.invoke(INVOKE_CHANNELS.RUN_AGENT_TASK, { prompt }),
  cancelAgentTask: (taskId) => ipcRenderer.invoke(INVOKE_CHANNELS.CANCEL_AGENT_TASK, taskId),
  resolveApproval: (approvalId, approved) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.RESOLVE_APPROVAL, approvalId, Boolean(approved)),
  getSettings: () => ipcRenderer.invoke(INVOKE_CHANNELS.GET_SETTINGS),
  setSettings: (settings) => ipcRenderer.invoke(INVOKE_CHANNELS.SET_SETTINGS, { ...settings }),
  testModelConnection: (settings) =>
    ipcRenderer.invoke(INVOKE_CHANNELS.TEST_MODEL_CONNECTION, { ...settings }),
  getAbout: () => ipcRenderer.invoke(INVOKE_CHANNELS.GET_ABOUT),
  checkForUpdates: () => ipcRenderer.invoke(INVOKE_CHANNELS.CHECK_FOR_UPDATES),
  openExternal: (url) => ipcRenderer.invoke(INVOKE_CHANNELS.OPEN_EXTERNAL, url),
  onAgentEvent: (listener) => subscribe(EVENT_CHANNELS.AGENT_EVENT, listener),
  onChatStatus: (listener) => subscribe(EVENT_CHANNELS.CHAT_STATUS, listener),
  onNavigate: (listener) => subscribe(EVENT_CHANNELS.NAVIGATE, listener)
});

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI);
