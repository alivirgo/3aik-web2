'use strict';

const api = window.desktopAPI;
const state = {
  activeView: 'chat',
  activeTaskId: null,
  terminalTaskIds: new Set(),
  approvalId: null,
  project: null,
  settings: null,
  credentials: { hasLocalApiKey: false, secureStorageAvailable: false },
  adapter: null,
  releaseUrl: null,
  clearApiKeyRequested: false,
  chatBoundsFrame: 0
};

const $ = (id) => document.getElementById(id);
const elements = {
  titleStatus: $('title-status'),
  titleStatusDot: $('title-status-dot'),
  sidebarVersion: $('sidebar-version'),
  chatFrame: $('chat-frame'),
  chatStatus: $('chat-status'),
  reloadChat: $('reload-chat'),
  projectMini: $('project-mini'),
  projectMiniButton: $('project-mini-button'),
  projectMiniName: $('project-mini-name'),
  projectMiniPath: $('project-mini-path'),
  projectBanner: $('project-banner'),
  projectName: $('project-name'),
  projectPath: $('project-path'),
  chooseProjectTop: $('choose-project-top'),
  chooseProjectBanner: $('choose-project-banner'),
  activityEmpty: $('activity-empty'),
  activityList: $('activity-list'),
  activitySubtitle: $('activity-subtitle'),
  clearActivity: $('clear-activity'),
  agentForm: $('agent-form'),
  agentTask: $('agent-task'),
  runTask: $('run-task'),
  stopTask: $('stop-task'),
  adapterLabel: $('adapter-label'),
  approvalLabel: $('approval-label'),
  approvalCard: $('approval-card'),
  approvalTitle: $('approval-title'),
  approvalMessage: $('approval-message'),
  approvalPreviewWarning: $('approval-preview-warning'),
  approvalRisk: $('approval-risk'),
  grantApproval: $('grant-approval'),
  denyApproval: $('deny-approval'),
  diffEmpty: $('diff-empty'),
  diffPreview: $('diff-preview'),
  diffTitle: $('diff-title'),
  diffSummary: $('diff-summary'),
  diffPreviewWarning: $('diff-preview-warning'),
  diffFiles: $('diff-files'),
  settingsForm: $('settings-form'),
  approvalMode: $('approval-mode'),
  agentBaseUrl: $('agent-base-url'),
  cloudProviderFields: $('cloud-provider-fields'),
  localProviderFields: $('local-provider-fields'),
  localBaseUrl: $('local-base-url'),
  localModel: $('local-model'),
  localApiKey: $('local-api-key'),
  rememberLocalApiKey: $('remember-local-api-key'),
  rememberKeyRow: $('remember-key-row'),
  secureStorageHelp: $('secure-storage-help'),
  apiKeyStatus: $('api-key-status'),
  clearApiKey: $('clear-api-key'),
  openLastProject: $('open-last-project'),
  compactActivity: $('compact-activity'),
  settingsStatus: $('settings-status'),
  testModelConnection: $('test-model-connection'),
  connectionTestStatus: $('connection-test-status'),
  detectedModels: $('detected-models'),
  aboutVersion: $('about-version'),
  runtimeElectron: $('runtime-electron'),
  runtimeChromium: $('runtime-chromium'),
  runtimeNode: $('runtime-node'),
  runtimePlatform: $('runtime-platform'),
  checkUpdates: $('check-updates'),
  viewRelease: $('view-release'),
  updateMessage: $('update-message'),
  openRepository: $('open-repository'),
  toastRegion: $('toast-region')
};

const LOCAL_PRESETS = Object.freeze({
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3-coder' },
  'lm-studio': { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  'llama-cpp': { baseUrl: 'http://127.0.0.1:8080/v1', model: 'local-model' },
  custom: null
});

function showToast(message, tone = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${tone === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function readableError(error) {
  if (!error) return 'Something went wrong.';
  const message = typeof error.message === 'string' ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme || 'system';
}

function setTitleStatus(label, status = 'ready') {
  elements.titleStatus.textContent = label;
  elements.titleStatusDot.className = `connection-dot${status === 'loading' ? ' is-loading' : status === 'error' ? ' is-error' : ''}`;
}

function queueChatBounds() {
  if (state.activeView !== 'chat') return;
  window.cancelAnimationFrame(state.chatBoundsFrame);
  state.chatBoundsFrame = window.requestAnimationFrame(async () => {
    const rect = elements.chatFrame.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    try {
      await api.setChatBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    } catch (error) {
      console.error('Could not resize chat view:', error);
    }
  });
}

async function activateView(view) {
  if (!['chat', 'agent', 'settings', 'about'].includes(view)) return;

  if (view !== 'chat') await api.setActiveView(view);
  state.activeView = view;
  for (const panel of document.querySelectorAll('[data-view-panel]')) {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  }
  for (const button of document.querySelectorAll('.nav-item[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }

  if (view === 'chat') {
    await api.setActiveView('chat');
    queueChatBounds();
  }
  if (view === 'about') void loadAbout();
}

function updateProject(project) {
  state.project = project;
  const hasProject = Boolean(project && project.path);
  elements.projectMini.hidden = !hasProject;
  elements.projectBanner.classList.toggle('has-project', hasProject);
  elements.projectMiniName.textContent = hasProject ? project.name : 'Project';
  elements.projectMiniPath.textContent = hasProject ? project.path : '';
  elements.projectName.textContent = hasProject ? project.name : 'Choose a project to begin';
  elements.projectPath.textContent = hasProject
    ? project.path
    : '3aik only receives the folder you explicitly select.';
  elements.agentTask.disabled = !hasProject || Boolean(state.activeTaskId);
  updateRunButton();
}

function updateRunButton() {
  elements.runTask.disabled =
    !state.project ||
    Boolean(state.activeTaskId) ||
    !elements.agentTask.value.trim();
}

async function chooseProject() {
  try {
    const project = await api.selectProject();
    if (!project) return;
    updateProject(project);
    await activateView('agent');
    elements.agentTask.focus();
    showToast(`Using ${project.name}`);
  } catch (error) {
    showToast(readableError(error), 'error');
  }
}

function resetReview() {
  state.approvalId = null;
  elements.approvalCard.hidden = true;
  elements.approvalPreviewWarning.hidden = true;
  elements.approvalPreviewWarning.textContent = '';
  elements.grantApproval.textContent = 'Approve action';
  elements.diffPreview.hidden = true;
  elements.diffPreviewWarning.hidden = true;
  elements.diffPreviewWarning.textContent = '';
  elements.diffEmpty.hidden = false;
  elements.diffFiles.replaceChildren();
}

function setTaskRunning(running) {
  elements.agentTask.disabled = running || !state.project;
  elements.chooseProjectTop.disabled = running;
  elements.chooseProjectBanner.disabled = running;
  elements.stopTask.hidden = !running;
  elements.runTask.hidden = running;
  updateRunButton();
}

function activitySymbol(tone) {
  if (tone === 'success') return '✓';
  if (tone === 'warning') return '!';
  if (tone === 'error') return '×';
  return '↻';
}

function addActivity({ title, message, tone = 'working', at = new Date().toISOString() }) {
  elements.activityEmpty.hidden = true;
  elements.clearActivity.hidden = false;
  const item = document.createElement('li');
  item.className = 'activity-item';
  item.dataset.tone = tone;

  const icon = document.createElement('span');
  icon.className = 'activity-icon';
  icon.textContent = activitySymbol(tone);
  icon.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('div');
  copy.className = 'activity-copy';
  const heading = document.createElement('strong');
  heading.textContent = title || 'Agent activity';
  const description = document.createElement('p');
  description.textContent = message || '';
  copy.append(heading, description);

  const time = document.createElement('time');
  time.className = 'activity-time';
  time.dateTime = at;
  time.textContent = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(at));
  item.append(icon, copy, time);
  elements.activityList.append(item);
  elements.activityList.scrollTop = elements.activityList.scrollHeight;
}

function showDiff(event) {
  const files = Array.isArray(event.files) ? event.files : [];
  const truncatedFile = files.find((file) => file.previewTruncated);
  const previewWarning = event.previewWarning || truncatedFile?.truncation?.warning || '';
  const previewTruncated = Boolean(event.previewTruncated || truncatedFile);
  elements.diffEmpty.hidden = true;
  elements.diffPreview.hidden = false;
  elements.diffTitle.textContent = previewTruncated
    ? `${event.title || 'Change preview'} · partial preview`
    : event.title || 'Change preview';
  elements.diffSummary.textContent = event.summary || '';
  elements.diffPreviewWarning.textContent = previewWarning;
  elements.diffPreviewWarning.hidden = !previewTruncated;
  elements.diffFiles.replaceChildren();

  for (const file of files) {
    const container = document.createElement('article');
    container.className = 'diff-file';
    const header = document.createElement('div');
    header.className = 'diff-file-header';
    const filePath = document.createElement('span');
    filePath.textContent = file.path || 'Proposed file';
    const stats = document.createElement('span');
    stats.className = 'diff-stats';
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = `+${Number(file.additions) || 0}`;
    const separator = document.createTextNode('  ');
    const minus = document.createElement('span');
    minus.className = 'minus';
    minus.textContent = `−${Number(file.deletions) || 0}`;
    stats.append(plus, separator, minus);
    header.append(filePath, stats);
    const patch = document.createElement('pre');
    patch.textContent = file.patch || 'Preview details will be supplied by the connected agent core.';
    container.append(header);
    if (file.previewTruncated) {
      const warning = document.createElement('div');
      warning.className = 'diff-file-warning';
      warning.textContent = file.truncation?.warning || 'This file preview is truncated. Review the complete source before approving.';
      container.append(warning);
    }
    container.append(patch);
    elements.diffFiles.append(container);
  }
}

function handleAgentEvent(event) {
  if (!event || typeof event !== 'object') return;
  if (event.type === 'task.started') {
    state.activeTaskId = event.taskId;
    setTaskRunning(true);
    elements.activitySubtitle.textContent = 'Working through the task safely.';
    addActivity({ ...event, title: 'Task started', tone: 'working' });
    setTitleStatus('Agent working', 'loading');
    return;
  }

  if (event.type === 'activity') {
    addActivity(event);
    return;
  }

  if (event.type === 'approval.requested') {
    state.approvalId = event.approvalId;
    elements.approvalTitle.textContent = event.title || 'Approval needed';
    elements.approvalMessage.textContent = event.message || '';
    elements.approvalPreviewWarning.textContent = event.previewWarning || '';
    elements.approvalPreviewWarning.hidden = !event.previewTruncated;
    elements.grantApproval.textContent = event.previewTruncated ? 'Approve partial preview' : 'Approve action';
    elements.approvalRisk.textContent = event.risk || 'Review carefully';
    elements.approvalRisk.dataset.risk = event.risk || 'caution';
    elements.approvalCard.hidden = false;
    addActivity({ title: 'Waiting for approval', message: event.message, tone: 'warning', at: event.at });
    setTitleStatus('Approval needed', 'loading');
    elements.grantApproval.focus();
    return;
  }

  if (event.type === 'approval.resolved') {
    state.approvalId = null;
    elements.approvalCard.hidden = true;
    elements.approvalPreviewWarning.hidden = true;
    elements.grantApproval.textContent = 'Approve action';
    if (!event.approved && !elements.diffPreview.hidden) {
      elements.diffTitle.textContent = 'Declined · not applied';
      elements.diffSummary.textContent = 'You declined this proposal. The coding agent did not apply it.';
    }
    return;
  }

  if (event.type === 'diff.preview') {
    showDiff(event);
    addActivity({
      title: event.title,
      message: event.previewTruncated
        ? `${event.summary || ''} ${event.previewWarning || 'Preview truncated. Review the complete source before approving.'}`.trim()
        : event.summary,
      tone: event.previewTruncated ? 'warning' : 'success',
      at: event.at
    });
    return;
  }

  if (['task.completed', 'task.cancelled', 'task.failed'].includes(event.type)) {
    const failed = event.type === 'task.failed';
    const cancelled = event.type === 'task.cancelled';
    addActivity({
      title: event.title || (failed ? 'Task failed' : cancelled ? 'Task stopped' : 'Task complete'),
      message: event.message,
      tone: failed ? 'error' : cancelled ? 'warning' : 'success',
      at: event.at
    });
    if (event.taskId) {
      state.terminalTaskIds.add(event.taskId);
      while (state.terminalTaskIds.size > 32) state.terminalTaskIds.delete(state.terminalTaskIds.values().next().value);
      setTimeout(() => state.terminalTaskIds.delete(event.taskId), 10_000);
    }
    state.activeTaskId = null;
    state.approvalId = null;
    elements.approvalCard.hidden = true;
    elements.approvalPreviewWarning.hidden = true;
    elements.grantApproval.textContent = 'Approve action';
    elements.activitySubtitle.textContent = failed ? 'The task needs your attention.' : 'Task finished safely.';
    setTaskRunning(false);
    setTitleStatus(failed ? 'Agent error' : 'Ready', failed ? 'error' : 'ready');
  }
}

async function runTask(event) {
  event.preventDefault();
  const prompt = elements.agentTask.value.trim();
  if (!state.project) {
    await chooseProject();
    return;
  }
  if (!prompt || state.activeTaskId) return;

  elements.activityList.replaceChildren();
  resetReview();
  setTaskRunning(true);
  elements.activitySubtitle.textContent = 'Starting the trusted main-process adapter…';
  try {
    const result = await api.runAgentTask(prompt);
    if (state.terminalTaskIds.delete(result.taskId)) {
      state.activeTaskId = null;
      setTaskRunning(false);
    } else {
      state.activeTaskId = result.taskId;
    }
  } catch (error) {
    state.activeTaskId = null;
    setTaskRunning(false);
    showToast(readableError(error), 'error');
  }
}

async function stopTask() {
  if (!state.activeTaskId) return;
  try {
    await api.cancelAgentTask(state.activeTaskId);
  } catch (error) {
    showToast(readableError(error), 'error');
  }
}

async function resolveApproval(approved) {
  if (!state.approvalId) return;
  const approvalId = state.approvalId;
  elements.grantApproval.disabled = true;
  elements.denyApproval.disabled = true;
  try {
    await api.resolveApproval(approvalId, approved);
  } catch (error) {
    showToast(readableError(error), 'error');
  } finally {
    elements.grantApproval.disabled = false;
    elements.denyApproval.disabled = false;
  }
}

function getSelectedProvider() {
  return document.querySelector('input[name="agentProvider"]:checked')?.value || '3aik-cloud';
}

function getSelectedPreset() {
  return document.querySelector('.preset-button.is-active')?.dataset.localPreset || 'custom';
}

function setProviderVisibility() {
  const isLocal = getSelectedProvider() === 'openai-compatible';
  elements.localProviderFields.hidden = !isLocal;
  elements.cloudProviderFields.hidden = isLocal;
  elements.agentBaseUrl.required = !isLocal;
  elements.localBaseUrl.required = isLocal;
  elements.localModel.required = isLocal;
  elements.connectionTestStatus.className = '';
  elements.connectionTestStatus.textContent = isLocal
    ? 'Test the private endpoint and discover its available models.'
    : 'Test 3aik Cloud without sending an agent prompt.';
}

function setPreset(preset, updateFields = true) {
  for (const button of document.querySelectorAll('[data-local-preset]')) {
    button.classList.toggle('is-active', button.dataset.localPreset === preset);
  }
  const values = LOCAL_PRESETS[preset];
  if (updateFields && values) {
    elements.localBaseUrl.value = values.baseUrl;
    elements.localModel.value = values.model;
  }
}

function updateCredentialUi() {
  const { hasLocalApiKey, secureStorageAvailable } = state.credentials;
  elements.clearApiKey.hidden = !hasLocalApiKey && !state.clearApiKeyRequested;
  if (state.clearApiKeyRequested) {
    elements.apiKeyStatus.textContent = 'Stored key will be removed when you save.';
  } else if (hasLocalApiKey) {
    elements.apiKeyStatus.textContent = secureStorageAvailable
      ? 'A key is protected by Windows secure storage. Leave blank to keep it.'
      : 'A key is held in memory for this app session only.';
  } else {
    elements.apiKeyStatus.textContent = 'Most local servers do not require a key.';
  }
  elements.rememberLocalApiKey.disabled = !secureStorageAvailable;
  elements.rememberLocalApiKey.checked = secureStorageAvailable;
  elements.rememberKeyRow.classList.toggle('is-disabled', !secureStorageAvailable);
  elements.secureStorageHelp.textContent = secureStorageAvailable
    ? 'Protected with the operating system credential encryption service.'
    : 'Secure storage is unavailable, so keys remain in memory only and are forgotten on exit.';
}

function populateSettings(settings, credentials = state.credentials) {
  state.settings = settings;
  state.credentials = credentials || state.credentials;
  applyTheme(settings.theme);
  const theme = document.querySelector(`input[name="theme"][value="${settings.theme}"]`);
  if (theme) theme.checked = true;
  const provider = document.querySelector(`input[name="agentProvider"][value="${settings.agentProvider}"]`);
  if (provider) provider.checked = true;
  elements.approvalMode.value = settings.approvalMode;
  elements.agentBaseUrl.value = settings.agentBaseUrl;
  elements.localBaseUrl.value = settings.localBaseUrl;
  elements.localModel.value = settings.localModel;
  elements.localApiKey.value = '';
  elements.openLastProject.checked = settings.openLastProject;
  elements.compactActivity.checked = settings.compactActivity;
  document.body.classList.toggle('compact-activity', settings.compactActivity);
  elements.approvalLabel.textContent =
    settings.approvalMode === 'read-only' ? 'Read-only' : 'Ask before changes';
  const providerLabel =
    settings.agentProvider === 'openai-compatible' ? `Local · ${settings.localModel}` : '3aik Cloud';
  elements.adapterLabel.textContent = `${providerLabel} · Agent Core`;
  setPreset(settings.localPreset, false);
  setProviderVisibility();
  updateCredentialUi();
}

function collectProviderCandidate() {
  return {
    agentProvider: getSelectedProvider(),
    agentBaseUrl: elements.agentBaseUrl.value.trim(),
    localPreset: getSelectedPreset(),
    localBaseUrl: elements.localBaseUrl.value.trim(),
    localModel: elements.localModel.value.trim(),
    localApiKey: elements.localApiKey.value
  };
}

async function saveSettings(event) {
  event.preventDefault();
  elements.settingsStatus.textContent = 'Saving…';
  const patch = {
    theme: document.querySelector('input[name="theme"]:checked')?.value || 'system',
    approvalMode: elements.approvalMode.value,
    openLastProject: elements.openLastProject.checked,
    compactActivity: elements.compactActivity.checked,
    ...collectProviderCandidate()
  };
  if (patch.agentProvider === '3aik-cloud') {
    delete patch.localBaseUrl;
    delete patch.localModel;
    delete patch.localApiKey;
  }
  if (!patch.localApiKey) delete patch.localApiKey;
  else patch.rememberLocalApiKey = elements.rememberLocalApiKey.checked;
  if (state.clearApiKeyRequested) patch.clearLocalApiKey = true;

  try {
    const result = await api.setSettings(patch);
    state.clearApiKeyRequested = false;
    populateSettings(result.settings, result.credentials);
    elements.settingsStatus.textContent = 'Saved';
    window.setTimeout(() => {
      if (elements.settingsStatus.textContent === 'Saved') elements.settingsStatus.textContent = '';
    }, 2500);
  } catch (error) {
    elements.settingsStatus.textContent = readableError(error);
    showToast(readableError(error), 'error');
  }
}

async function testModelConnection() {
  const candidate = collectProviderCandidate();
  elements.testModelConnection.disabled = true;
  elements.connectionTestStatus.className = '';
  elements.connectionTestStatus.textContent = 'Connecting from the trusted main process…';
  try {
    const result = await api.testModelConnection(candidate);
    const modelNote = result.models?.length ? ` · ${result.models.length} models found` : '';
    elements.connectionTestStatus.textContent = `Connected in ${result.latencyMs} ms${modelNote}`;
    elements.connectionTestStatus.className = 'is-success';
    if (result.models?.length) {
      elements.detectedModels.replaceChildren();
      for (const model of result.models) {
        const option = document.createElement('option');
        option.value = model;
        elements.detectedModels.append(option);
      }
      if (!elements.localModel.value || elements.localModel.value === 'local-model') {
        elements.localModel.value = result.models[0];
      }
    }
  } catch (error) {
    elements.connectionTestStatus.textContent = readableError(error);
    elements.connectionTestStatus.className = 'is-error';
  } finally {
    elements.testModelConnection.disabled = false;
  }
}

let aboutLoaded = false;
async function loadAbout() {
  if (aboutLoaded) return;
  try {
    const about = await api.getAbout();
    elements.aboutVersion.textContent = `Version ${about.version}`;
    elements.runtimeElectron.textContent = about.electron;
    elements.runtimeChromium.textContent = about.chromium;
    elements.runtimeNode.textContent = about.node;
    elements.runtimePlatform.textContent = about.platform;
    aboutLoaded = true;
  } catch (error) {
    showToast(readableError(error), 'error');
  }
}

async function checkForUpdates() {
  elements.checkUpdates.disabled = true;
  elements.updateMessage.textContent = 'Checking GitHub Releases…';
  try {
    const result = await api.checkForUpdates();
    state.releaseUrl = result.releasesUrl;
    elements.viewRelease.hidden = false;
    if (result.state === 'available') {
      elements.updateMessage.textContent = `${result.releaseName} is available. You have ${result.currentVersion}.`;
      elements.viewRelease.textContent = 'View update';
    } else if (result.state === 'current') {
      elements.updateMessage.textContent = `You’re up to date on ${result.currentVersion}.`;
      elements.viewRelease.textContent = 'View releases';
    } else if (result.state === 'none') {
      elements.updateMessage.textContent = 'No packaged desktop release is published yet.';
      elements.viewRelease.textContent = 'View releases';
    } else {
      elements.updateMessage.textContent = `Could not check automatically: ${result.message}`;
      elements.viewRelease.textContent = 'Check GitHub';
    }
  } catch (error) {
    elements.updateMessage.textContent = readableError(error);
  } finally {
    elements.checkUpdates.disabled = false;
  }
}

function handleChatStatus(status) {
  const chatState = status?.state || 'ready';
  elements.chatStatus.className = `status-label${chatState === 'loading' ? ' is-loading' : chatState === 'error' ? ' is-error' : ''}`;
  const label = chatState === 'loading' ? 'Connecting' : chatState === 'error' ? 'Offline' : 'Connected';
  elements.chatStatus.lastChild.textContent = ` ${label}`;
  if (state.activeView === 'chat') setTitleStatus(label, chatState);
}

function bindEvents() {
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => void activateView(button.dataset.view));
  }
  elements.chooseProjectTop.addEventListener('click', chooseProject);
  elements.chooseProjectBanner.addEventListener('click', chooseProject);
  elements.projectMiniButton.addEventListener('click', () => void activateView('agent'));
  elements.agentTask.addEventListener('input', updateRunButton);
  elements.agentTask.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      elements.agentForm.requestSubmit();
    }
  });
  elements.agentForm.addEventListener('submit', runTask);
  elements.stopTask.addEventListener('click', stopTask);
  elements.grantApproval.addEventListener('click', () => resolveApproval(true));
  elements.denyApproval.addEventListener('click', () => resolveApproval(false));
  elements.clearActivity.addEventListener('click', () => {
    elements.activityList.replaceChildren();
    elements.activityEmpty.hidden = false;
    elements.clearActivity.hidden = true;
    elements.activitySubtitle.textContent = 'Your agent’s work will appear here.';
    resetReview();
  });
  for (const suggestion of document.querySelectorAll('[data-prompt]')) {
    suggestion.addEventListener('click', async () => {
      if (!state.project) await chooseProject();
      if (!state.project) return;
      elements.agentTask.value = suggestion.dataset.prompt;
      updateRunButton();
      elements.agentTask.focus();
    });
  }
  elements.reloadChat.addEventListener('click', () => api.reloadChat());
  elements.settingsForm.addEventListener('submit', saveSettings);
  for (const theme of document.querySelectorAll('input[name="theme"]')) {
    theme.addEventListener('change', () => applyTheme(theme.value));
  }
  for (const provider of document.querySelectorAll('input[name="agentProvider"]')) {
    provider.addEventListener('change', setProviderVisibility);
  }
  for (const preset of document.querySelectorAll('[data-local-preset]')) {
    preset.addEventListener('click', () => setPreset(preset.dataset.localPreset));
  }
  elements.localBaseUrl.addEventListener('input', () => setPreset('custom', false));
  elements.testModelConnection.addEventListener('click', testModelConnection);
  elements.clearApiKey.addEventListener('click', () => {
    state.clearApiKeyRequested = true;
    elements.localApiKey.value = '';
    updateCredentialUi();
  });
  elements.checkUpdates.addEventListener('click', checkForUpdates);
  elements.viewRelease.addEventListener('click', () => {
    if (state.releaseUrl) void api.openExternal(state.releaseUrl);
  });
  elements.openRepository.addEventListener('click', () =>
    api.openExternal('https://github.com/alivirgo/3aik-web2')
  );
  window.addEventListener('resize', queueChatBounds);
  new ResizeObserver(queueChatBounds).observe(elements.chatFrame);

  api.onAgentEvent(handleAgentEvent);
  api.onChatStatus(handleChatStatus);
  api.onNavigate((payload) => {
    const view = typeof payload === 'string' ? payload : payload?.view;
    if (payload?.project) updateProject(payload.project);
    if (view) void activateView(view);
    if (payload?.reason === 'window-resize') queueChatBounds();
  });
}

async function initialize() {
  if (!api) {
    document.body.textContent = '3aik Desktop could not initialize its secure bridge.';
    return;
  }
  bindEvents();
  try {
    const bootstrap = await api.getBootstrap();
    elements.sidebarVersion.textContent = `Version ${bootstrap.appVersion}`;
    state.credentials = bootstrap.credentials;
    state.adapter = bootstrap.adapter;
    populateSettings(bootstrap.settings, bootstrap.credentials);
    updateProject(bootstrap.project);
    await activateView(bootstrap.activeView || 'chat');
  } catch (error) {
    showToast(readableError(error), 'error');
    setTitleStatus('Startup error', 'error');
  }
}

void initialize();
