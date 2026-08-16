'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  WebContentsView
} = require('electron');
const { createCoreAgentAdapter } = require('../agent/core-adapter.cjs');
const { createModelClient } = require('../agent/model-client.cjs');
const { EVENT_CHANNELS, INVOKE_CHANNELS } = require('../shared/contracts.cjs');
const {
  APP_ORIGIN,
  PRODUCTION_ORIGIN,
  isAllowedChatNavigation,
  isAllowedExternalUrl,
  isAllowedPermission,
  isTrustedRendererUrl,
  isVersionNewer,
  normalizeAgentBaseUrl,
  normalizeLocalModelBaseUrl,
  normalizeViewBounds,
  resolveAssetPath
} = require('./security.cjs');
const { createSettingsStore } = require('./settings-store.cjs');
const { createCredentialStore } = require('./credential-store.cjs');

const APP_ID = 'com.3aik.desktop';
const RELEASES_URL = 'https://github.com/alivirgo/3aik-web2/releases';
const RELEASE_API_URL = 'https://api.github.com/repos/alivirgo/3aik-web2/releases?per_page=20';
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true
    }
  }
]);

let mainWindow = null;
let chatView = null;
let chatAttached = false;
let activeView = 'chat';
let selectedProject = null;
let activeTaskId = null;
let settingsStore = null;
let credentialStore = null;
let agentAdapter = null;
let agentAdapterInfo = null;
let modelClient = null;

function sendToShell(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function updateTitleBarColors() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setTitleBarOverlay({
    color: nativeTheme.shouldUseDarkColors ? '#0b1020' : '#eef1f7',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#d8def4' : '#26304a',
    height: 48
  });
}

function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    try {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const assetPath = resolveAssetPath(RENDERER_ROOT, request.url);
      const stat = await fs.stat(assetPath);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const body = await fs.readFile(assetPath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': MIME_TYPES[path.extname(assetPath).toLowerCase()] || 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function configureShellSession() {
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function configureChatSession(chatSession) {
  chatSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    isAllowedPermission(permission, requestingOrigin)
  );
  chatSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(isAllowedPermission(permission, details.requestingUrl));
  });
}

function configureNavigation(contents, kind) {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (kind === 'chat' && isAllowedChatNavigation(url)) {
      void contents.loadURL(url);
    } else if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const guardNavigation = (event, url) => {
    const allowed = kind === 'chat' ? isAllowedChatNavigation(url) : isTrustedRendererUrl(url);
    if (!allowed) event.preventDefault();
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
}

function createChatView() {
  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:3aik-chat',
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: true
    }
  });
  configureChatSession(view.webContents.session);
  configureNavigation(view.webContents, 'chat');
  view.setBackgroundColor('#0b1020');
  view.webContents.on('did-start-loading', () => {
    sendToShell(EVENT_CHANNELS.CHAT_STATUS, { state: 'loading' });
  });
  view.webContents.on('did-stop-loading', () => {
    sendToShell(EVENT_CHANNELS.CHAT_STATUS, { state: 'ready' });
  });
  view.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    sendToShell(EVENT_CHANNELS.CHAT_STATUS, {
      state: 'error',
      message: description,
      url: isAllowedChatNavigation(validatedUrl) ? validatedUrl : PRODUCTION_ORIGIN
    });
  });
  void view.webContents.loadURL(PRODUCTION_ORIGIN);
  return view;
}

function setChatAttached(shouldAttach) {
  if (!mainWindow || !chatView) return;
  if (shouldAttach && !chatAttached) {
    mainWindow.contentView.addChildView(chatView);
    chatAttached = true;
  } else if (!shouldAttach && chatAttached) {
    mainWindow.contentView.removeChildView(chatView);
    chatAttached = false;
  }
}

function navigateShell(view) {
  if (!['chat', 'agent', 'settings', 'about'].includes(view)) return;
  sendToShell(EVENT_CHANNELS.NAVIGATE, view);
}

async function chooseProject() {
  if (!mainWindow) return null;
  if (activeTaskId) throw new Error('Stop the current agent task before switching projects.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a project for 3aik Agent',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const candidate = await fs.realpath(result.filePaths[0]);
  const stat = await fs.stat(candidate);
  if (!stat.isDirectory()) throw new Error('The selected project is not a directory.');
  selectedProject = candidate;
  settingsStore.setLastProject(candidate);
  return { path: candidate, name: path.basename(candidate) || candidate };
}

function createModelConfiguration() {
  const settings = settingsStore.get();
  if (settings.agentProvider === 'openai-compatible') {
    return {
      provider: 'openai-compatible',
      localBaseUrl: settings.localBaseUrl,
      localModel: settings.localModel,
      localApiKey: credentialStore.getLocalApiKey(),
      deviceId: settingsStore.getDeviceId()
    };
  }
  return {
    provider: '3aik-cloud',
    agentBaseUrl: settings.agentBaseUrl,
    deviceId: settingsStore.getDeviceId()
  };
}

function isTrustedIpcEvent(event) {
  return Boolean(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame &&
    isTrustedRendererUrl(event.senderFrame.url)
  );
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedIpcEvent(event)) throw new Error('Blocked IPC from an untrusted renderer.');
    return handler(...args);
  });
}

function registerIpcHandlers() {
  registerHandler(INVOKE_CHANNELS.GET_BOOTSTRAP, async () => ({
    settings: settingsStore.get(),
    project: selectedProject
      ? { path: selectedProject, name: path.basename(selectedProject) || selectedProject }
      : null,
    activeView,
    appVersion: app.getVersion(),
    adapter: agentAdapterInfo,
    credentials: {
      hasLocalApiKey: credentialStore.hasLocalApiKey(),
      secureStorageAvailable: credentialStore.encryptionAvailable()
    }
  }));

  registerHandler(INVOKE_CHANNELS.SET_ACTIVE_VIEW, async (view) => {
    if (!['chat', 'agent', 'settings', 'about'].includes(view)) {
      throw new Error('Unknown desktop view.');
    }
    activeView = view;
    setChatAttached(view === 'chat');
    return { activeView };
  });

  registerHandler(INVOKE_CHANNELS.SET_CHAT_BOUNDS, async (bounds) => {
    if (!mainWindow || !chatView || activeView !== 'chat') return false;
    const normalized = normalizeViewBounds(bounds, mainWindow.getContentBounds());
    if (!normalized) throw new Error('Invalid chat view bounds.');
    chatView.setBounds(normalized);
    return true;
  });

  registerHandler(INVOKE_CHANNELS.RELOAD_CHAT, async () => {
    if (!chatView) return false;
    if (chatView.webContents.isLoading()) chatView.webContents.stop();
    chatView.webContents.reload();
    return true;
  });

  registerHandler(INVOKE_CHANNELS.SELECT_PROJECT, chooseProject);

  registerHandler(INVOKE_CHANNELS.RUN_AGENT_TASK, async (request) => {
    if (!selectedProject) throw new Error('Choose a project folder first.');
    if (activeTaskId) throw new Error('Finish or stop the current task first.');
    const result = await agentAdapter.startTask({
      projectRoot: selectedProject,
      prompt: request && request.prompt,
      approvalMode: settingsStore.get().approvalMode,
      model: createModelConfiguration()
    });
    activeTaskId = result.taskId;
    return result;
  });

  registerHandler(INVOKE_CHANNELS.CANCEL_AGENT_TASK, async (taskId) => {
    if (typeof taskId !== 'string' || taskId !== activeTaskId) return false;
    return agentAdapter.cancelTask(taskId);
  });

  registerHandler(INVOKE_CHANNELS.RESOLVE_APPROVAL, async (approvalId, approved) => {
    if (typeof approvalId !== 'string') return false;
    return agentAdapter.resolveApproval(approvalId, Boolean(approved));
  });

  registerHandler(INVOKE_CHANNELS.GET_SETTINGS, async () => settingsStore.get());

  registerHandler(INVOKE_CHANNELS.SET_SETTINGS, async (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Settings update must be an object.');
    }
    if (
      Object.hasOwn(patch, 'agentProvider') &&
      !['3aik-cloud', 'openai-compatible'].includes(patch.agentProvider)
    ) {
      throw new Error('Unknown agent provider.');
    }
    const effectiveProvider = patch.agentProvider || settingsStore.get().agentProvider;
    if (
      effectiveProvider === '3aik-cloud' &&
      Object.hasOwn(patch, 'agentBaseUrl') &&
      !normalizeAgentBaseUrl(patch.agentBaseUrl)
    ) {
      throw new Error('Agent base URL must be a secure HTTPS origin without credentials, query, or hash.');
    }
    if (
      effectiveProvider === 'openai-compatible' &&
      Object.hasOwn(patch, 'localBaseUrl') &&
      !normalizeLocalModelBaseUrl(patch.localBaseUrl)
    ) {
      throw new Error('Local model URL must use HTTP(S) on localhost or a private network address.');
    }
    if (effectiveProvider === 'openai-compatible' && Object.hasOwn(patch, 'localModel')) {
      if (typeof patch.localModel !== 'string' || !patch.localModel.trim() || patch.localModel.length > 160) {
        throw new Error('Choose a valid local model name.');
      }
    }
    let credentialResult = null;
    if (Object.hasOwn(patch, 'localApiKey')) {
      credentialResult = credentialStore.setLocalApiKey(patch.localApiKey, Boolean(patch.rememberLocalApiKey));
    } else if (patch.clearLocalApiKey === true) {
      credentialResult = credentialStore.setLocalApiKey('', false);
    }
    const {
      localApiKey: _localApiKey,
      rememberLocalApiKey: _rememberLocalApiKey,
      clearLocalApiKey: _clearLocalApiKey,
      ...safePatch
    } = patch;
    const updated = settingsStore.update(safePatch);
    nativeTheme.themeSource = updated.theme;
    updateTitleBarColors();
    if (updated.openLastProject === false) settingsStore.setLastProject(null);
    else if (selectedProject) settingsStore.setLastProject(selectedProject);
    return {
      settings: updated,
      credentials: {
        hasLocalApiKey: credentialStore.hasLocalApiKey(),
        secureStorageAvailable: credentialStore.encryptionAvailable(),
        persistence: credentialResult ? credentialResult.persistence : undefined
      }
    };
  });

  registerHandler(INVOKE_CHANNELS.TEST_MODEL_CONNECTION, async (candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Provider settings are required.');
    const stored = settingsStore.get();
    const provider = candidate.agentProvider || stored.agentProvider;
    if (!['3aik-cloud', 'openai-compatible'].includes(provider)) {
      throw new Error('Unknown agent provider.');
    }
    if (typeof candidate.localApiKey === 'string' && candidate.localApiKey.length > 8192) {
      throw new Error('API key must be 8,192 characters or fewer.');
    }
    const configuration = {
      provider,
      agentBaseUrl: candidate.agentBaseUrl || stored.agentBaseUrl,
      localBaseUrl: candidate.localBaseUrl || stored.localBaseUrl,
      localModel: candidate.localModel || stored.localModel,
      localApiKey:
        typeof candidate.localApiKey === 'string' && candidate.localApiKey.trim()
          ? candidate.localApiKey.trim()
          : credentialStore.getLocalApiKey(),
      deviceId: settingsStore.getDeviceId()
    };
    return modelClient.testConnection(configuration);
  });

  registerHandler(INVOKE_CHANNELS.GET_ABOUT, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    repositoryUrl: 'https://github.com/alivirgo/3aik-web2'
  }));

  registerHandler(INVOKE_CHANNELS.CHECK_FOR_UPDATES, async () => {
    try {
      const response = await net.fetch(RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `3aik-desktop/${app.getVersion()}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (response.status === 404) {
        return { state: 'none', currentVersion: app.getVersion(), releasesUrl: RELEASES_URL };
      }
      if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
      const releases = await response.json();
      const release = Array.isArray(releases)
        ? releases.find((candidate) => /^(?:desktop-)?v\d/i.test(String(candidate.tag_name || '')) && !candidate.draft && !candidate.prerelease)
        : null;
      if (!release) {
        return { state: 'none', currentVersion: app.getVersion(), releasesUrl: RELEASES_URL };
      }
      const latestVersion = String(release.tag_name || '').replace(/^desktop-v|^v/, '');
      return {
        state: isVersionNewer(latestVersion, app.getVersion()) ? 'available' : 'current',
        currentVersion: app.getVersion(),
        latestVersion: latestVersion || app.getVersion(),
        releaseName: release.name || release.tag_name || 'Latest release',
        releasesUrl: isAllowedExternalUrl(release.html_url) ? release.html_url : RELEASES_URL
      };
    } catch (error) {
      return {
        state: 'error',
        currentVersion: app.getVersion(),
        message: error instanceof Error ? error.message : 'Could not check for updates.',
        releasesUrl: RELEASES_URL
      };
    }
  });

  registerHandler(INVOKE_CHANNELS.OPEN_EXTERNAL, async (url) => {
    if (!isAllowedExternalUrl(url)) throw new Error('That external destination is not allowed.');
    await shell.openExternal(url);
    return true;
  });
}

function buildApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Choose project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            try {
              const project = await chooseProject();
              if (project) {
                navigateShell('agent');
                sendToShell(EVENT_CHANNELS.NAVIGATE, { view: 'agent', project });
              }
            } catch (error) {
              void dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'Could not open project',
                message: error instanceof Error ? error.message : 'Unknown project error.'
              });
            }
          }
        },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' }
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Chat', accelerator: 'CmdOrCtrl+1', click: () => navigateShell('chat') },
        { label: 'Coding Agent', accelerator: 'CmdOrCtrl+2', click: () => navigateShell('agent') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => navigateShell('settings') }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload chat',
          accelerator: 'F5',
          click: () => {
            if (chatView) chatView.webContents.reload();
          }
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About 3aik', click: () => navigateShell('about') },
        { label: 'View releases', click: () => void shell.openExternal(RELEASES_URL) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function restoreProject() {
  if (!settingsStore.get().openLastProject) return;
  const lastProject = settingsStore.getLastProject();
  if (!lastProject) return;
  try {
    const realPath = await fs.realpath(lastProject);
    const stat = await fs.stat(realPath);
    if (stat.isDirectory()) selectedProject = realPath;
  } catch {
    selectedProject = null;
  }
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b1020',
    title: '3aik',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: '#0b1020', symbolColor: '#d8def4', height: 48 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      spellcheck: true
    }
  });

  configureNavigation(mainWindow.webContents, 'shell');
  chatView = createChatView();
  setChatAttached(true);

  mainWindow.on('closed', () => {
    if (chatView && !chatView.webContents.isDestroyed()) chatView.webContents.close();
    chatView = null;
    mainWindow = null;
    chatAttached = false;
  });
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  updateTitleBarColors();
}

function installGlobalWebContentsGuard() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  installGlobalWebContentsGuard();
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerAppProtocol();
    configureShellSession();
    settingsStore = createSettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    settingsStore.load();
    credentialStore = createCredentialStore(
      path.join(app.getPath('userData'), 'credentials.json'),
      safeStorage
    );
    nativeTheme.themeSource = settingsStore.get().theme;
    nativeTheme.on('updated', updateTitleBarColors);
    modelClient = createModelClient({ fetchImplementation: (url, options) => net.fetch(url, options) });
    agentAdapter = await createCoreAgentAdapter({
      fetchImplementation: (url, options) => net.fetch(url, options)
    });
    agentAdapterInfo = {
      id: 'agent-core',
      name: '3aik Agent Core',
      canWrite: true,
      canExecute: true,
      fallback: false
    };
    agentAdapter.onEvent((event) => {
      if (['task.completed', 'task.cancelled', 'task.failed'].includes(event.type)) {
        activeTaskId = null;
      }
      sendToShell(EVENT_CHANNELS.AGENT_EVENT, event);
    });
    await restoreProject();
    registerIpcHandlers();
    buildApplicationMenu();
    await createMainWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
    });
  }).catch((error) => {
    console.error('3aik Desktop failed to start:', error);
    dialog.showErrorBox(
      '3aik Desktop could not start',
      error instanceof Error ? error.message : 'An unknown startup error occurred.'
    );
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (agentAdapter) void agentAdapter.dispose();
});
