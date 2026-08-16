'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ALLOWED_EVENT_CHANNELS, ALLOWED_INVOKE_CHANNELS } = require('../src/shared/contracts.cjs');

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('renderer contains no Node, shell, or raw IPC capability', () => {
  const renderer = source('src/renderer/app.js');
  assert.doesNotMatch(renderer, /\brequire\s*\(/);
  assert.doesNotMatch(renderer, /\bipcRenderer\b/);
  assert.doesNotMatch(renderer, /\bchild_process\b/);
  assert.doesNotMatch(renderer, /\bexec(?:File|Sync)?\s*\(/);
  assert.doesNotMatch(renderer, /\beval\s*\(/);
  assert.doesNotMatch(renderer, /innerHTML/);
});

test('renderer makes truncated proposal previews explicit before approval', () => {
  const renderer = source('src/renderer/app.js');
  const html = source('src/renderer/index.html');
  assert.match(html, /id="approval-preview-warning"[^>]*role="alert"/);
  assert.match(html, /id="diff-preview-warning"[^>]*role="status"/);
  assert.match(renderer, /event\.previewTruncated/);
  assert.match(renderer, /file\.previewTruncated/);
  assert.match(renderer, /Approve partial preview/);
});

test('renderer cannot resurrect a task that terminated before IPC returned', () => {
  const renderer = source('src/renderer/app.js');
  assert.match(renderer, /terminalTaskIds:\s*new Set\(\)/);
  assert.match(renderer, /state\.terminalTaskIds\.add\(event\.taskId\)/);
  assert.match(renderer, /if \(state\.terminalTaskIds\.delete\(result\.taskId\)\)/);
  assert.match(renderer, /state\.activeTaskId = null;\s*setTaskRunning\(false\);/);
});

test('preload exposes named operations instead of a generic IPC transport', () => {
  const preload = source('src/preload/index.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('desktopAPI'/);
  assert.doesNotMatch(preload, /^\s*send:\s*\(/m);
  assert.doesNotMatch(preload, /^\s*invoke:\s*\(/m);
  assert.doesNotMatch(preload, /^\s*on:\s*\(/m);
  for (const channel of [...ALLOWED_INVOKE_CHANNELS, ...ALLOWED_EVENT_CHANNELS]) {
    assert.match(preload, new RegExp(`['\"]${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\"]`));
  }
});

test('every BrowserWindow and chat view uses secure web preferences', () => {
  const main = source('src/main/index.cjs');
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.doesNotMatch(main, /contextIsolation:\s*false/);
  assert.doesNotMatch(main, /sandbox:\s*false/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
});

test('desktop fails closed when the real shared agent core is unavailable', () => {
  const main = source('src/main/index.cjs');
  const renderer = source('src/renderer/app.js');
  assert.doesNotMatch(main, /LocalSafeAgentAdapter|createLocalSafeAgentAdapter|preview fallback/i);
  assert.doesNotMatch(renderer, /safe fallback|tasks are preview-only/i);
  assert.match(main, /await createCoreAgentAdapter/);
});
