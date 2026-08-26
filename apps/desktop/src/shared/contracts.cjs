'use strict';

const INVOKE_CHANNELS = Object.freeze({
  GET_BOOTSTRAP: 'desktop:get-bootstrap',
  SET_ACTIVE_VIEW: 'desktop:set-active-view',
  SET_CHAT_BOUNDS: 'desktop:set-chat-bounds',
  RELOAD_CHAT: 'desktop:reload-chat',
  SELECT_PROJECT: 'desktop:select-project',
  LIST_PROJECT_FILES: 'desktop:list-project-files',
  READ_PROJECT_FILE: 'desktop:read-project-file',
  WRITE_PROJECT_FILE: 'desktop:write-project-file',
  RUN_AGENT_TASK: 'desktop:run-agent-task',
  CANCEL_AGENT_TASK: 'desktop:cancel-agent-task',
  RESOLVE_APPROVAL: 'desktop:resolve-approval',
  GET_SETTINGS: 'desktop:get-settings',
  SET_SETTINGS: 'desktop:set-settings',
  TEST_MODEL_CONNECTION: 'desktop:test-model-connection',
  GET_ABOUT: 'desktop:get-about',
  CHECK_FOR_UPDATES: 'desktop:check-for-updates',
  OPEN_EXTERNAL: 'desktop:open-external',
  SYNC_CHAT_THEME: 'desktop:sync-chat-theme'
});

const EVENT_CHANNELS = Object.freeze({
  AGENT_EVENT: 'desktop:agent-event',
  CHAT_STATUS: 'desktop:chat-status',
  NAVIGATE: 'desktop:navigate'
});

const ALLOWED_INVOKE_CHANNELS = Object.freeze(Object.values(INVOKE_CHANNELS));
const ALLOWED_EVENT_CHANNELS = Object.freeze(Object.values(EVENT_CHANNELS));

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'system',
  approvalMode: 'ask',
  openLastProject: true,
  compactActivity: false,
  agentProvider: '3aik-cloud',
  agentBaseUrl: 'https://3aik.com',
  localPreset: 'ollama',
  localBaseUrl: 'http://127.0.0.1:11434/v1',
  localModel: 'qwen3-coder'
});

module.exports = {
  ALLOWED_EVENT_CHANNELS,
  ALLOWED_INVOKE_CHANNELS,
  DEFAULT_SETTINGS,
  EVENT_CHANNELS,
  INVOKE_CHANNELS
};
