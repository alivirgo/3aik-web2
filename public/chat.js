"use strict";

const HISTORY_KEY = "3aik:history:v2";
const PREFERENCES_KEY = "3aik:preferences:v2";
const DEVICE_KEY = "3aik:device:v1";
const MEDIA_DB_NAME = "3aik-media-v2";
const HISTORY_STORE_NAME = "history";
const MAX_THREADS = 30;
const MAX_MESSAGES_PER_THREAD = 200;
const MAX_THREAD_TEXT = 2_000_000;
const MAX_MESSAGE_TEXT = 1_000_000;
const MAX_TITLE_LENGTH = 200;
const MAX_ID_LENGTH = 160;
const MAX_MODEL_LENGTH = 300;
const MAX_FILES = 5;
const MAX_IMAGES = 4;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_EMBEDDED_TEXT = 38_000;
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "xml", "yaml", "yml", "html", "css",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp",
  "cs", "php", "sh", "ps1", "sql", "toml", "ini", "log",
]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_EXTENSIONS = new Map([["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]);
const TEXT_ATTACHMENT_ACCEPT = [...TEXT_EXTENSIONS].map((extension) => `.${extension}`).join(",");
const IMAGE_ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

const MODES = {
  chat: {
    name: "Ask",
    model: "3aik Auto",
    kicker: "3aik Auto · fast and versatile",
    title: "What can we<br><em>figure out?</em>",
    description: "Ask a question, untangle an idea, or turn a rough thought into something useful.",
    placeholder: "Message 3aik…",
    context: "Replies stream as they are written",
    suggestions: [
      ["EXPLAIN", "Explain a difficult idea in plain language"],
      ["WRITE", "Turn rough notes into a clear, polished draft"],
      ["PLAN", "Break a goal into a practical next-step plan"],
    ],
  },
  deep: {
    name: "Deep",
    model: "3aik Reasoning",
    kicker: "3aik Reasoning · deliberate analysis",
    title: "Bring me the<br><em>hard problem.</em>",
    description: "Use a larger reasoning model for decisions, analysis, and questions with several moving parts.",
    placeholder: "Describe the problem in detail…",
    context: "Best for difficult, multi-step questions",
    suggestions: [
      ["DECIDE", "Compare two options and challenge my assumptions"],
      ["ANALYZE", "Find the weak points in this argument"],
      ["STRATEGY", "Build a strategy from these constraints"],
    ],
  },
  code: {
    name: "Code",
    model: "3aik Code",
    kicker: "3aik Code · implementation focused",
    title: "Build it.<br><em>Fix it. Ship it.</em>",
    description: "Get implementation help, debug failures, review code, or turn a product idea into a technical plan.",
    placeholder: "Paste code or describe what you want to build…",
    context: "Code blocks include one-click copy",
    suggestions: [
      ["DEBUG", "Help me trace a bug from this error message"],
      ["BUILD", "Turn a feature idea into working code"],
      ["REVIEW", "Review this code for correctness and security"],
    ],
  },
  image: {
    name: "Image",
    model: "3aik Image",
    kicker: "3aik Image · visual generation",
    title: "Describe it.<br><em>See it.</em>",
    description: "Write a visual prompt with the subject, composition, light, mood, and style you want.",
    placeholder: "Describe the image you want to create…",
    context: "Square image · stored locally on this device",
    suggestions: [
      ["EDITORIAL", "A quiet editorial portrait with soft window light"],
      ["PRODUCT", "A premium product photo on a bold color field"],
      ["WORLD", "An impossible landscape at the edge of a storm"],
    ],
  },
};

function hasMode(value) {
  return typeof value === "string" && Object.hasOwn(MODES, value);
}

const elements = {
  sidebar: document.querySelector("#sidebar"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  sidebarClose: document.querySelector("#sidebar-close"),
  mobileMenu: document.querySelector("#mobile-menu"),
  newThread: document.querySelector("#new-thread"),
  clearThreads: document.querySelector("#clear-threads"),
  threadSearch: document.querySelector("#thread-search"),
  threadList: document.querySelector("#thread-list"),
  threadEmpty: document.querySelector("#thread-empty"),
  themeToggle: document.querySelector("#theme-toggle"),
  themeLabel: document.querySelector("#theme-label"),
  modeBreadcrumb: document.querySelector("#mode-breadcrumb"),
  threadTitle: document.querySelector("#thread-title"),
  statusPill: document.querySelector("#status-pill"),
  threadControls: document.querySelector("#thread-controls"),
  renameThread: document.querySelector("#rename-thread"),
  branchThread: document.querySelector("#branch-thread"),
  exportThread: document.querySelector("#export-thread"),
  conversation: document.querySelector("#conversation"),
  emptyState: document.querySelector("#empty-state"),
  emptyKicker: document.querySelector("#empty-kicker"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  suggestionGrid: document.querySelector("#suggestion-grid"),
  messages: document.querySelector("#messages"),
  jumpBottom: document.querySelector("#jump-bottom"),
  activeModel: document.querySelector("#active-model"),
  actualModel: document.querySelector("#actual-model"),
  composerContext: document.querySelector("#composer-context"),
  composerArea: document.querySelector(".composer-area"),
  composerForm: document.querySelector("#composer-form"),
  prompt: document.querySelector("#prompt-input"),
  attachmentInput: document.querySelector("#attachment-input"),
  attachButton: document.querySelector("#attach-button"),
  attachmentTray: document.querySelector("#attachment-tray"),
  characterCount: document.querySelector("#character-count"),
  sendButton: document.querySelector("#send-button"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  systemPrompt: document.querySelector("#system-prompt"),
  temperature: document.querySelector("#temperature"),
  temperatureValue: document.querySelector("#temperature-value"),
  temperatureAuto: document.querySelector("#temperature-auto"),
  maxTokens: document.querySelector("#max-tokens"),
  rememberHistory: document.querySelector("#remember-history"),
  saveSettings: document.querySelector("#save-settings"),
  exportWorkspace: document.querySelector("#export-workspace"),
  importWorkspace: document.querySelector("#import-workspace"),
  workspaceFile: document.querySelector("#workspace-file"),
  renameDialog: document.querySelector("#rename-dialog"),
  renameForm: document.querySelector("#rename-form"),
  renameInput: document.querySelector("#rename-input"),
  saveRename: document.querySelector("#save-rename"),
  appsButton: document.querySelector("#apps-button"),
  appsDialog: document.querySelector("#apps-dialog"),
  appsClose: document.querySelector("#apps-close"),
  cliCommand: document.querySelector("#cli-command"),
  copyCliCommand: document.querySelector("#copy-cli-command"),
  downloadCount: document.querySelector("#download-count"),
  sidebarDownloadCount: document.querySelector("#sidebar-download-count"),
  mediaDialog: document.querySelector("#media-dialog"),
  mediaModel: document.querySelector("#media-model"),
  mediaPreview: document.querySelector("#media-preview"),
  mediaDownload: document.querySelector("#media-download"),
  mediaClose: document.querySelector("#media-close"),
  toast: document.querySelector("#toast"),
};

const defaultPreferences = {
  theme: window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  systemPrompt: "",
  temperature: 0.7,
  temperatureCustomized: false,
  maxTokens: 4096,
  rememberHistory: true,
};

const preferences = loadPreferences();
const history = loadHistory();
const deviceId = loadDeviceId();
const state = {
  mode: hasMode(history.mode) ? history.mode : "chat",
  activeThreadId: history.activeThreadId || null,
  threads: history.threads || [],
  busy: false,
  controller: null,
  renderVersion: 0,
  objectUrls: new Set(),
  preview: null,
  attachments: [],
  dragDepth: 0,
  persistenceVersion: 0,
  lastSavedAt: history.savedAt || 0,
};

if (!state.threads.some((thread) => thread.id === state.activeThreadId)) state.activeThreadId = null;

initialize();
registerServiceWorker();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The online workspace remains fully usable when registration is unavailable.
    });
  }, { once: true });
}

function initialize() {
  applyTheme(preferences.theme);
  bindEvents();
  if (state.activeThreadId) state.mode = getActiveThread().mode;
  renderMode();
  renderThreads();
  renderConversation();
  renderAttachmentTray();
  resizePrompt();
  updateComposerState();
  checkHealth();
  checkDownloads();
  hydrateHistoryFromDatabase();
}

function bindEvents() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => switchMode(button.dataset.mode));
  });

  elements.newThread.addEventListener("click", () => startNewThread());
  elements.clearThreads.addEventListener("click", clearAllThreads);
  elements.threadSearch.addEventListener("input", renderThreads);
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.mobileMenu.addEventListener("click", openSidebar);
  elements.sidebarClose.addEventListener("click", closeSidebar);
  elements.sidebarScrim.addEventListener("click", closeSidebar);
  elements.appsButton.addEventListener("click", () => elements.appsDialog.showModal());
  elements.appsClose.addEventListener("click", () => elements.appsDialog.close());
  elements.appsDialog.addEventListener("click", (event) => {
    if (event.target === elements.appsDialog) elements.appsDialog.close();
  });
  elements.copyCliCommand.addEventListener("click", () => copyText(elements.cliCommand.textContent));

  elements.renameThread.addEventListener("click", openRenameDialog);
  elements.branchThread.addEventListener("click", () => branchThreadAt());
  elements.exportThread.addEventListener("click", exportThreadMarkdown);
  elements.renameForm.addEventListener("submit", saveThreadName);

  elements.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.busy) {
      state.controller?.abort();
      return;
    }
    sendPrompt();
  });

  elements.prompt.addEventListener("input", () => {
    resizePrompt();
    updateComposerState();
  });

  elements.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.innerWidth > 620) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  elements.prompt.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  elements.attachButton.addEventListener("click", () => elements.attachmentInput.click());
  elements.attachmentInput.addEventListener("change", () => {
    addFiles([...elements.attachmentInput.files]);
    elements.attachmentInput.value = "";
  });

  elements.composerArea.addEventListener("dragenter", (event) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    state.dragDepth += 1;
    elements.composerArea.classList.add("is-dragging");
  });
  elements.composerArea.addEventListener("dragover", (event) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  elements.composerArea.addEventListener("dragleave", (event) => {
    if (!hasFileTransfer(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) elements.composerArea.classList.remove("is-dragging");
  });
  elements.composerArea.addEventListener("drop", (event) => {
    if (!hasFileTransfer(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    elements.composerArea.classList.remove("is-dragging");
    addFiles([...(event.dataTransfer?.files || [])]);
  });

  elements.conversation.addEventListener("scroll", () => {
    const distance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
    elements.jumpBottom.hidden = distance < 180;
  }, { passive: true });
  elements.jumpBottom.addEventListener("click", () => scrollToBottom("smooth"));

  elements.settingsButton.addEventListener("click", openSettings);
  elements.temperature.addEventListener("input", () => {
    elements.temperature.dataset.customized = "true";
    elements.temperatureValue.value = Number(elements.temperature.value).toFixed(1);
    elements.temperatureValue.textContent = Number(elements.temperature.value).toFixed(1);
  });
  elements.temperatureAuto.addEventListener("click", () => {
    elements.temperature.dataset.customized = "false";
    elements.temperatureValue.value = "Auto";
    elements.temperatureValue.textContent = "Auto";
  });
  elements.saveSettings.addEventListener("click", saveSettings);
  elements.exportWorkspace.addEventListener("click", exportWorkspaceJson);
  elements.importWorkspace.addEventListener("click", () => elements.workspaceFile.click());
  elements.workspaceFile.addEventListener("change", () => {
    const file = elements.workspaceFile.files?.[0];
    elements.workspaceFile.value = "";
    if (file) importWorkspaceJson(file);
  });

  elements.mediaClose.addEventListener("click", () => elements.mediaDialog.close());
  elements.mediaDownload.addEventListener("click", () => {
    if (state.preview) downloadBlob(state.preview.blob, state.preview.name);
  });
  elements.mediaDialog.addEventListener("click", (event) => {
    if (event.target === elements.mediaDialog) elements.mediaDialog.close();
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (window.innerWidth <= 900) openSidebar();
      elements.threadSearch.focus();
    }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "o") {
      event.preventDefault();
      startNewThread();
    }
    if (event.key === "Escape" && elements.sidebar.classList.contains("is-open")) closeSidebar();
  });
}

function switchMode(mode, options = {}) {
  if (!hasMode(mode) || mode === state.mode && !options.force) {
    closeSidebar();
    return;
  }

  if (state.busy) state.controller?.abort();
  if (mode === "image" && state.attachments.length) {
    clearPendingAttachments();
    showToast("Attachments were removed because Image mode accepts prompts only");
  } else if (mode !== "chat" && state.attachments.some((attachment) => attachment.kind === "image")) {
    removePendingImageAttachments();
    showToast("Image attachments were removed because vision is available only in Ask mode");
  }
  const active = getActiveThread();
  if (active?.messages.length && active.mode !== mode) state.activeThreadId = null;
  state.mode = mode;
  const current = getActiveThread();
  if (current && current.messages.length === 0) current.mode = mode;
  saveHistory();
  renderMode();
  renderThreads();
  renderConversation();
  closeSidebar();
  elements.prompt.focus();
}

function renderMode() {
  const mode = MODES[state.mode];
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  });
  elements.modeBreadcrumb.textContent = mode.name;
  elements.activeModel.textContent = mode.model;
  const actualModel = latestModel(getActiveThread());
  elements.actualModel.textContent = actualModel ? compactModelName(actualModel) : "";
  elements.actualModel.title = actualModel || "";
  elements.actualModel.hidden = !actualModel;
  elements.emptyKicker.textContent = mode.kicker;
  elements.emptyTitle.innerHTML = mode.title;
  elements.emptyDescription.textContent = mode.description;
  elements.prompt.placeholder = mode.placeholder;
  elements.composerContext.textContent = mode.context;
  elements.attachButton.disabled = state.mode === "image";
  elements.attachButton.title = state.mode === "image"
    ? "Attachments are unavailable in Image mode"
    : state.mode === "chat" ? "Attach text, code, or images" : "Attach text or code files; images are available in Ask mode";
  elements.attachmentInput.accept = state.mode === "chat" ? `${TEXT_ATTACHMENT_ACCEPT},${IMAGE_ATTACHMENT_ACCEPT}` : TEXT_ATTACHMENT_ACCEPT;
  renderSuggestions(mode.suggestions);
  updatePageTitle();
}

function renderSuggestions(suggestions) {
  elements.suggestionGrid.replaceChildren();
  suggestions.forEach(([label, prompt]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-button";
    const tag = document.createElement("span");
    tag.textContent = label;
    const text = document.createElement("strong");
    text.textContent = prompt;
    button.append(tag, text);
    button.addEventListener("click", () => {
      elements.prompt.value = prompt;
      resizePrompt();
      updateComposerState();
      elements.prompt.focus();
    });
    elements.suggestionGrid.append(button);
  });
}

function startNewThread(mode = state.mode) {
  if (state.busy) state.controller?.abort();
  state.activeThreadId = null;
  state.mode = mode;
  elements.threadSearch.value = "";
  saveHistory();
  renderMode();
  renderThreads();
  renderConversation();
  closeSidebar();
  elements.prompt.focus();
}

function ensureThread(prompt) {
  let thread = getActiveThread();
  if (thread) return thread;

  thread = {
    id: createId(),
    title: makeTitle(prompt),
    mode: state.mode,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.threads.unshift(thread);
  state.activeThreadId = thread.id;
  trimThreads([thread.id]);
  return thread;
}

async function sendPrompt() {
  const typedPrompt = elements.prompt.value.trim();
  if ((!typedPrompt && !state.attachments.length) || state.busy) return;
  if (state.mode === "image" && !typedPrompt) return;
  const prompt = typedPrompt || "Help me with the attached files.";

  const thread = ensureThread(prompt);
  const userMessage = {
    id: createId(),
    role: "user",
    kind: "text",
    content: prompt,
    attachments: state.mode === "image" ? [] : state.attachments.map(({ id, name, type, size, kind }) => ({ id, name, type, size, kind })),
    createdAt: Date.now(),
  };
  appendThreadMessage(thread, userMessage);
  touchThread(thread);
  elements.prompt.value = "";
  state.attachments = [];
  renderAttachmentTray();
  resizePrompt();
  saveHistory();
  renderThreads();
  await renderConversation();
  scrollToBottom("smooth");

  setBusy(true, state.mode === "image" ? "Creating" : "Thinking");
  state.controller = new AbortController();
  if (state.mode === "image") await generateImage(thread, prompt, state.controller.signal);
  else await generateText(thread, state.controller.signal);
  state.controller = null;
  setBusy(false, "Ready");
  updateComposerState();
}

function hasFileTransfer(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

async function addFiles(files) {
  if (state.mode === "image") {
    showToast("Switch to Ask for images, or Ask, Deep, or Code for text files");
    return;
  }
  let added = 0;
  for (const file of files) {
    if (!(file instanceof Blob)) continue;
    if (state.attachments.length >= MAX_FILES) {
      showToast(`You can attach up to ${MAX_FILES} files`);
      break;
    }
    const name = String(file.name || "pasted-image").slice(0, 160);
    if (isSensitiveFilename(name)) {
      showToast(`For safety, ${name} was not attached because it may contain secrets`);
      continue;
    }
    const extension = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const imageType = IMAGE_TYPES.has(file.type) ? file.type : IMAGE_EXTENSIONS.get(extension);
    const kind = imageType ? "image" : file.type.startsWith("text/") || TEXT_EXTENSIONS.has(extension) ? "text" : null;
    if (!kind) {
      showToast(`${name} is not a supported text, code, PNG, JPEG, or WebP file`);
      continue;
    }
    if (kind === "image" && state.mode !== "chat") {
      showToast("Image attachments are available only in Ask mode");
      continue;
    }
    if (kind === "image" && state.attachments.filter((attachment) => attachment.kind === "image").length >= MAX_IMAGES) {
      showToast(`You can attach up to ${MAX_IMAGES} images`);
      continue;
    }
    const perFileLimit = kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
    if (file.size > perFileLimit) {
      showToast(`${name} is too large (max ${formatBytes(perFileLimit)})`);
      continue;
    }
    if (state.attachments.reduce((total, attachment) => total + attachment.size, 0) + file.size > MAX_ATTACHMENT_BYTES) {
      showToast(`Attachments can total up to ${formatBytes(MAX_ATTACHMENT_BYTES)}`);
      break;
    }
    const id = createId();
    try {
      const type = imageType || file.type || textMimeFor(extension);
      const blob = file.type === type ? file : new Blob([file], { type });
      await putMedia(id, blob);
      state.attachments.push({ id, name, type, size: file.size, kind });
      added += 1;
    } catch {
      showToast(`Could not store ${name} in this browser`);
    }
  }
  renderAttachmentTray();
  updateComposerState();
  if (added) showToast(`${added} ${added === 1 ? "file" : "files"} attached`);
}

function renderAttachmentTray() {
  elements.attachmentTray.replaceChildren();
  elements.attachmentTray.hidden = state.attachments.length === 0;
  state.attachments.forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "attachment-pill";
    const kind = document.createElement("span");
    kind.className = "attachment-kind";
    kind.textContent = attachment.kind === "image" ? "IMG" : fileLabel(attachment.name);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = attachment.name;
    const size = document.createElement("small");
    size.textContent = formatBytes(attachment.size);
    copy.append(name, size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.append(createIcon("close"));
    remove.addEventListener("click", () => removePendingAttachment(attachment.id));
    item.append(kind, copy, remove);
    elements.attachmentTray.append(item);
  });
}

async function removePendingAttachment(id) {
  state.attachments = state.attachments.filter((attachment) => attachment.id !== id);
  await deleteMedia(id);
  renderAttachmentTray();
  updateComposerState();
}

function clearPendingAttachments() {
  const ids = state.attachments.map((attachment) => attachment.id);
  state.attachments = [];
  renderAttachmentTray();
  ids.forEach(deleteMedia);
  updateComposerState();
}

function removePendingImageAttachments() {
  const removed = state.attachments.filter((attachment) => attachment.kind === "image");
  state.attachments = state.attachments.filter((attachment) => attachment.kind !== "image");
  renderAttachmentTray();
  updateComposerState();
  removed.forEach((attachment) => deleteMedia(attachment.id));
}

async function buildApiMessages(allMessages, mode = state.mode) {
  const messages = allMessages
    .filter((message) => message.kind === "text" && (message.role === "user" || message.role === "assistant"))
    .slice(-24);
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const output = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      output.push({ role: "assistant", content: message.content });
      continue;
    }
    let content = message.content;
    const attachments = message.attachments || [];
    if (message !== latestUser && attachments.length) {
      content += `\n\n[Earlier attachments: ${attachments.map((attachment) => attachment.name).join(", ")}]`;
      output.push({ role: "user", content });
      continue;
    }
    let remainingText = Math.max(0, Math.min(MAX_EMBEDDED_TEXT, 49_000 - content.length));
    let truncated = false;
    const images = [];
    for (const attachment of attachments) {
      const blob = await getMedia(attachment.id);
      if (!blob) {
        content += `\n\n[Attachment unavailable: ${attachment.name}]`;
      } else if (attachment.kind === "text") {
        const raw = await blob.text();
        const prefix = `\n\n--- Attached file: ${attachment.name} ---\n`;
        const suffix = "\n--- End attached file ---";
        const available = Math.max(0, remainingText - prefix.length - suffix.length);
        const excerpt = raw.slice(0, available);
        remainingText -= prefix.length + excerpt.length + suffix.length;
        truncated ||= excerpt.length < raw.length;
        content += `${prefix}${excerpt}${suffix}`;
      } else if (mode === "chat" && images.length < MAX_IMAGES) {
        images.push({ type: "image_url", image_url: { url: await blobToDataUrl(blob) } });
      } else {
        content += `\n\n[Image attachment omitted: ${attachment.name}; vision is available only in Ask mode.]`;
      }
    }
    if (truncated) content += "\n\n[Attachment text was truncated to fit the safe request limit.]";
    output.push(images.length ? { role: "user", content: [{ type: "text", text: content }, ...images] } : { role: "user", content });
  }
  return output;
}

async function generateText(thread, signal) {
  const placeholder = createAssistantShell({ streaming: true });
  elements.messages.append(placeholder.article);
  scrollToBottom("smooth");
  let fullResponse = "";
  let streamBuffer = "";
  let actualModel = "";

  try {
    const messages = await buildApiMessages(thread.messages, thread.mode);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-3aik-device": deviceId },
      body: JSON.stringify({
        messages,
        mode: thread.mode,
        temperature: preferences.temperatureCustomized ? preferences.temperature : undefined,
        maxTokens: preferences.maxTokens,
        systemPrompt: preferences.systemPrompt,
      }),
      signal,
    });

    if (!response.ok) throw new Error(await readError(response));
    if (!response.body) throw new Error("This browser could not read the response stream.");
    actualModel = response.headers.get("x-3aik-model") || "";
    if (actualModel) updateActualModel(actualModel);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      streamBuffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const parsed = parseSse(streamBuffer);
      streamBuffer = parsed.remainder;
      for (const data of parsed.events) {
        if (data === "[DONE]") continue;
        try {
          const delta = extractDelta(JSON.parse(data));
          if (delta) {
            fullResponse += delta;
            renderRichText(stripPrivateReasoning(fullResponse), placeholder.content, true);
            maybeFollowStream();
          }
        } catch {
          // Ignore malformed heartbeat events while keeping the stream alive.
        }
      }
      if (done) break;
    }

    if (!fullResponse.trim()) throw new Error("The model returned an empty response. Please try again.");
    const cleanResponse = stripPrivateReasoning(fullResponse).trim();
    appendThreadMessage(thread, { id: createId(), role: "assistant", kind: "text", content: cleanResponse, model: actualModel, createdAt: Date.now() });
    touchThread(thread);
    saveHistory();
    renderThreads();
    await renderConversation();
  } catch (error) {
    if (error.name === "AbortError") {
      if (fullResponse.trim()) {
        const cleanResponse = stripPrivateReasoning(fullResponse).trim();
        appendThreadMessage(thread, { id: createId(), role: "assistant", kind: "text", content: cleanResponse, model: actualModel, createdAt: Date.now() });
        touchThread(thread);
        saveHistory();
        await renderConversation();
      } else {
        placeholder.article.remove();
      }
      showToast("Response stopped");
      return;
    }
    renderError(placeholder.content, error.message || "The request failed.");
    setStatus("Unavailable", "error");
  }
}

async function generateImage(thread, prompt, signal) {
  const shell = createAssistantShell({ image: true });
  const skeleton = document.createElement("div");
  skeleton.className = "image-skeleton";
  shell.content.append(skeleton);
  elements.messages.append(shell.article);
  scrollToBottom("smooth");

  try {
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "content-type": "application/json", "x-3aik-device": deviceId },
      body: JSON.stringify({ prompt }),
      signal,
    });
    if (!response.ok) throw new Error(await readError(response));

    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0) throw new Error("The image response was invalid.");
    const actualModel = response.headers.get("x-3aik-model") || "";
    if (actualModel) updateActualModel(actualModel);
    const message = { id: createId(), role: "assistant", kind: "image", prompt, model: actualModel, createdAt: Date.now() };
    await putMedia(message.id, blob);
    appendThreadMessage(thread, message);
    touchThread(thread);
    saveHistory();
    renderThreads();
    await renderConversation();
  } catch (error) {
    if (error.name === "AbortError") {
      shell.article.remove();
      showToast("Image generation stopped");
      return;
    }
    renderError(shell.content, error.message || "Image generation failed.");
    setStatus("Unavailable", "error");
  }
}

async function renderConversation() {
  const version = ++state.renderVersion;
  revokeObjectUrls();
  elements.messages.replaceChildren();
  const thread = getActiveThread();
  const hasMessages = Boolean(thread?.messages.length);
  elements.threadControls.hidden = !thread;
  elements.emptyState.classList.toggle("is-hidden", hasMessages);
  elements.messages.classList.toggle("has-messages", hasMessages);
  elements.threadTitle.textContent = thread?.title || "Untitled thread";
  const actualModel = latestModel(thread);
  if (actualModel) updateActualModel(actualModel);
  else {
    elements.actualModel.hidden = true;
    elements.actualModel.textContent = "";
    elements.actualModel.title = "";
  }
  updatePageTitle();
  if (!hasMessages) return;

  for (let index = 0; index < thread.messages.length; index += 1) {
    const message = thread.messages[index];
    if (version !== state.renderVersion) return;
    if (message.role === "user") {
      const rendered = await renderUserMessage(message, index);
      if (version !== state.renderVersion || state.activeThreadId !== thread.id) return;
      elements.messages.append(rendered);
    } else if (message.kind === "image") {
      const shell = createAssistantShell({ image: true, model: message.model, createdAt: message.createdAt });
      const skeleton = document.createElement("div");
      skeleton.className = "image-skeleton";
      shell.content.append(skeleton);
      elements.messages.append(shell.article);
      const blob = await getMedia(message.id);
      if (version !== state.renderVersion) return;
      if (blob) await replaceWithImage(shell.content, message, blob);
      else renderExpiredImage(shell.content, message);
      wireAssistantActions(shell, message, index);
    } else {
      elements.messages.append(renderAssistantMessage(message, index));
    }
  }
  requestAnimationFrame(() => scrollToBottom("auto"));
}

async function renderUserMessage(message, index) {
  const article = document.createElement("article");
  article.className = "message user";
  const stack = document.createElement("div");
  stack.className = "user-message-stack";
  if (message.attachments?.length) {
    const attachments = document.createElement("div");
    attachments.className = "message-attachments";
    for (const attachment of message.attachments) attachments.append(await createStoredAttachmentCard(attachment));
    stack.append(attachments);
  }
  const bubble = document.createElement("div");
  bubble.className = "user-bubble";
  bubble.textContent = message.content;
  const actions = document.createElement("div");
  actions.className = "user-message-actions";
  const edit = createMessageAction("Edit & branch", "edit");
  edit.addEventListener("click", () => beginEditMessage(article, message, index));
  const branch = createMessageAction("Branch here", "branch");
  branch.addEventListener("click", () => branchThreadAt(index));
  actions.append(edit, branch);
  stack.append(bubble, actions);
  article.append(stack);
  return article;
}

async function createStoredAttachmentCard(attachment) {
  const card = document.createElement("div");
  card.className = "message-attachment";
  if (attachment.kind === "image") {
    const blob = await getMedia(attachment.id);
    if (blob) {
      const image = document.createElement("img");
      const url = URL.createObjectURL(blob);
      state.objectUrls.add(url);
      image.src = url;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("click", () => previewImage(blob, attachment.name));
      card.append(image);
    } else {
      const missing = document.createElement("span");
      missing.className = "message-attachment-icon";
      missing.textContent = "?";
      card.append(missing);
    }
  } else {
    const icon = document.createElement("span");
    icon.className = "message-attachment-icon";
    icon.textContent = fileLabel(attachment.name);
    card.append(icon);
  }
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = attachment.name;
  const size = document.createElement("small");
  size.textContent = formatBytes(attachment.size);
  copy.append(name, size);
  card.append(copy);
  return card;
}

function renderAssistantMessage(message, index) {
  const shell = createAssistantShell({ createdAt: message.createdAt, model: message.model });
  renderRichText(message.content, shell.content, false);
  wireAssistantActions(shell, message, index);
  return shell.article;
}

function wireAssistantActions(shell, message, index) {
  shell.actions.hidden = false;
  shell.copyButton.addEventListener("click", () => copyText(message.kind === "image" ? message.prompt : message.content));
  const regenerate = createMessageAction("Regenerate", "regenerate");
  regenerate.addEventListener("click", () => regenerateFrom(index));
  const branch = createMessageAction("Branch here", "branch");
  branch.addEventListener("click", () => branchThreadAt(index));
  shell.actions.append(regenerate, branch);
}

function createAssistantShell(options = {}) {
  const article = document.createElement("article");
  article.className = "message assistant";
  const heading = document.createElement("div");
  heading.className = "message-heading";
  const mark = document.createElement("span");
  mark.className = "assistant-mark";
  mark.textContent = "3";
  const name = document.createElement("strong");
  name.textContent = options.image ? "3aik image" : "3aik";
  const time = document.createElement("time");
  time.textContent = formatTime(options.createdAt || Date.now());
  heading.append(mark, name, time);
  if (options.model) {
    const model = document.createElement("span");
    model.className = "message-model";
    model.textContent = compactModelName(options.model);
    model.title = options.model;
    heading.append(model);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  if (options.streaming) {
    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.setAttribute("aria-label", "Generating response");
    content.append(cursor);
  }

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.hidden = true;
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "message-action";
  copyButton.append(createIcon("copy"), document.createTextNode("Copy"));
  actions.append(copyButton);
  article.append(heading, content, actions);
  return { article, content, actions, copyButton };
}

function createMessageAction(label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action";
  button.append(createIcon(icon), document.createTextNode(label));
  return button;
}

async function replaceWithImage(container, message, blob) {
  const url = URL.createObjectURL(blob);
  state.objectUrls.add(url);
  const card = document.createElement("div");
  card.className = "image-card";
  const image = document.createElement("img");
  image.src = url;
  image.alt = message.prompt;
  image.loading = "lazy";
  image.addEventListener("click", () => previewImage(blob, message.prompt, message.model));
  const footer = document.createElement("div");
  footer.className = "image-card-footer";
  const caption = document.createElement("span");
  caption.textContent = message.prompt;
  const download = document.createElement("button");
  download.type = "button";
  download.className = "secondary-button";
  const extension = imageExtension(blob.type);
  download.textContent = `Download ${extension.toUpperCase()}`;
  download.addEventListener("click", () => downloadBlob(blob, `3aik-${message.id}.${extension}`));
  footer.append(caption, download);
  card.append(image, footer);
  container.replaceChildren(card);
}

function renderExpiredImage(container, message) {
  const card = document.createElement("div");
  card.className = "error-card";
  card.textContent = "This locally stored image is no longer available. Your prompt is still here.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "secondary-button";
  retry.textContent = "Use prompt again";
  retry.addEventListener("click", () => {
    elements.prompt.value = message.prompt;
    resizePrompt();
    updateComposerState();
    elements.prompt.focus();
  });
  container.replaceChildren(card, retry);
}

function renderError(container, message) {
  const card = document.createElement("div");
  card.className = "error-card";
  card.textContent = message;
  container.replaceChildren(card);
}

function renderRichText(markdown, container, streaming) {
  container.replaceChildren();
  const source = String(markdown || "").replace(/\r/g, "");
  const lines = source.split("\n");
  let paragraph = [];
  let list = null;
  let code = null;
  let language = "text";

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" "));
    container.append(p);
    paragraph = [];
  };
  const closeList = () => { list = null; };
  const flushCode = () => {
    if (code === null) return;
    container.append(createCodeBlock(code.join("\n"), language));
    code = null;
    language = "text";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```\s*([\w.+#-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      if (code === null) {
        code = [];
        language = fence[1] || "text";
      } else flushCode();
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1])) {
      flushParagraph();
      closeList();
      const headers = splitTableRow(line);
      const alignments = splitTableRow(lines[index + 1]).map((cell) => {
        const value = cell.trim();
        if (value.startsWith(":") && value.endsWith(":")) return "center";
        if (value.endsWith(":")) return "right";
        return "left";
      });
      const tableWrap = document.createElement("div");
      tableWrap.className = "table-scroll";
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      headers.forEach((header, cellIndex) => {
        const cell = document.createElement("th");
        cell.style.textAlign = alignments[cellIndex] || "left";
        appendInline(cell, header.trim());
        headRow.append(cell);
      });
      head.append(headRow);
      const body = document.createElement("tbody");
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const row = document.createElement("tr");
        splitTableRow(lines[index]).forEach((value, cellIndex) => {
          const cell = document.createElement("td");
          cell.style.textAlign = alignments[cellIndex] || "left";
          appendInline(cell, value.trim());
          row.append(cell);
        });
        body.append(row);
        index += 1;
      }
      index -= 1;
      table.append(head, body);
      tableWrap.append(table);
      container.append(tableWrap);
      continue;
    }

    if (/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushParagraph();
      closeList();
      container.append(document.createElement("hr"));
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const h = document.createElement(`h${Math.min(heading[1].length + 1, 4)}`);
      appendInline(h, heading[2]);
      container.append(h);
      continue;
    }

    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (task || bullet || numbered) {
      flushParagraph();
      const tag = numbered ? "ol" : "ul";
      const taskList = Boolean(task);
      if (!list || list.tagName.toLowerCase() !== tag || list.classList.contains("task-list") !== taskList) {
        list = document.createElement(tag);
        if (taskList) list.className = "task-list";
        container.append(list);
      }
      const item = document.createElement("li");
      if (task) {
        item.className = "task-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task[1].toLowerCase() === "x";
        checkbox.disabled = true;
        checkbox.setAttribute("aria-label", checkbox.checked ? "Completed" : "Not completed");
        const text = document.createElement("span");
        appendInline(text, task[2]);
        item.append(checkbox, text);
      } else appendInline(item, (bullet || numbered)[1]);
      list.append(item);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      const blockquote = document.createElement("blockquote");
      appendInline(blockquote, quote[1]);
      container.append(blockquote);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushCode();
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.setAttribute("aria-hidden", "true");
    container.append(cursor);
  }
}

function isTableDivider(line) {
  if (!line || !line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|"));
}

function appendInline(parent, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("~~")) {
      const del = document.createElement("del");
      del.textContent = token.slice(2, -2);
      parent.append(del);
    } else if (token.startsWith("*") || token.startsWith("_")) {
      const em = document.createElement("em");
      em.textContent = token.slice(1, -1);
      parent.append(em);
    } else {
      const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      const link = document.createElement("a");
      link.href = markdownLink ? markdownLink[2] : token;
      link.textContent = markdownLink ? markdownLink[1] : token;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      parent.append(link);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function createCodeBlock(code, language) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  const toolbar = document.createElement("div");
  toolbar.className = "code-toolbar";
  const label = document.createElement("span");
  label.textContent = language;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy code";
  button.addEventListener("click", () => copyText(code));
  const pre = document.createElement("pre");
  const codeElement = document.createElement("code");
  codeElement.textContent = code;
  toolbar.append(label, button);
  pre.append(codeElement);
  wrapper.append(toolbar, pre);
  return wrapper;
}

function renderThreads() {
  const query = elements.threadSearch.value.trim().toLowerCase();
  const threads = [...state.threads]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((thread) => !query || thread.title.toLowerCase().includes(query));
  elements.threadList.replaceChildren();
  elements.threadEmpty.hidden = threads.length > 0;
  elements.clearThreads.hidden = state.threads.length === 0;

  threads.forEach((thread) => {
    const row = document.createElement("div");
    row.className = `thread-item${thread.id === state.activeThreadId ? " is-active" : ""}`;
    const open = document.createElement("button");
    open.type = "button";
    open.className = "thread-open";
    open.setAttribute("aria-current", thread.id === state.activeThreadId ? "page" : "false");
    const title = document.createElement("strong");
    title.textContent = thread.title;
    const meta = document.createElement("small");
    meta.textContent = `${MODES[thread.mode]?.name || "Ask"} · ${formatRelativeTime(thread.updatedAt)}`;
    open.append(title, meta);
    open.addEventListener("click", () => openThread(thread.id));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "thread-delete";
    remove.disabled = state.busy;
    remove.setAttribute("aria-label", `Delete ${thread.title}`);
    remove.append(createIcon("trash"));
    remove.addEventListener("click", () => deleteThread(thread.id));
    row.append(open, remove);
    elements.threadList.append(row);
  });
}

function openThread(id) {
  const thread = state.threads.find((candidate) => candidate.id === id);
  if (!thread) return;
  if (state.busy) state.controller?.abort();
  touchThread(thread);
  state.activeThreadId = id;
  state.mode = thread.mode;
  saveHistory();
  renderMode();
  renderThreads();
  renderConversation();
  closeSidebar();
}

function openRenameDialog() {
  const thread = getActiveThread();
  if (!thread) return;
  elements.renameInput.value = thread.title;
  elements.renameDialog.showModal();
  requestAnimationFrame(() => elements.renameInput.select());
}

function saveThreadName(event) {
  event.preventDefault();
  const thread = getActiveThread();
  const title = elements.renameInput.value.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!thread || !title) return;
  thread.title = title;
  touchThread(thread);
  saveHistory();
  renderThreads();
  renderConversation();
  elements.renameDialog.close();
  showToast("Thread renamed");
}

async function branchThreadAt(index = null, options = {}) {
  if (state.busy) return null;
  const source = getActiveThread();
  if (!source?.messages.length) return null;
  const endIndex = index === null ? source.messages.length - 1 : clamp(index, 0, source.messages.length - 1);
  const messages = [];
  const createdMedia = [];
  try {
    for (const original of source.messages.slice(0, endIndex + 1)) {
      const copy = { ...original, id: createId() };
      if (original.kind === "image" && await copyMedia(original.id, copy.id)) createdMedia.push(copy.id);
      if (original.attachments?.length) {
        copy.attachments = [];
        for (const attachment of original.attachments) {
          const clonedAttachment = { ...attachment, id: createId() };
          if (await copyMedia(attachment.id, clonedAttachment.id)) createdMedia.push(clonedAttachment.id);
          copy.attachments.push(clonedAttachment);
        }
      }
      messages.push(copy);
    }
  } catch {
    await Promise.all(createdMedia.map(deleteMedia));
    showToast("The branch could not be created because local file storage is unavailable");
    return null;
  }
  const now = Date.now();
  const branch = {
    id: createId(),
    title: `${source.title.replace(/ \(branch\)$/i, "")} (branch)`.slice(0, 80),
    mode: source.mode,
    createdAt: now,
    updatedAt: now,
    parentThreadId: source.id,
    messages,
  };
  state.threads.unshift(branch);
  state.activeThreadId = branch.id;
  state.mode = branch.mode;
  trimThreads([source.id, branch.id]);
  saveHistory();
  renderMode();
  renderThreads();
  await renderConversation();
  if (!options.silent) showToast("Created a new branch");
  return branch;
}

function beginEditMessage(article, message, index) {
  if (state.busy) return;
  const form = document.createElement("form");
  form.className = "edit-message-form";
  const label = document.createElement("label");
  label.className = "sr-only";
  label.textContent = "Edit message and create a branch";
  const textarea = document.createElement("textarea");
  textarea.maxLength = 12_000;
  textarea.value = message.content;
  label.append(textarea);
  const actions = document.createElement("div");
  actions.className = "edit-message-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary-button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => renderConversation());
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "primary-button";
  save.textContent = "Send in new branch";
  actions.append(cancel, save);
  form.append(label, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = textarea.value.trim();
    if (value) editAndBranch(index, value);
  });
  article.replaceChildren(form);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

async function editAndBranch(index, content) {
  const branch = await branchThreadAt(index, { silent: true });
  if (!branch) return;
  const edited = branch.messages.at(-1);
  edited.content = content;
  edited.editedAt = Date.now();
  branch.title = makeTitle(content);
  touchThread(branch);
  saveHistory();
  renderThreads();
  await renderConversation();
  await regenerateForThread(branch, edited);
}

async function regenerateFrom(index) {
  const thread = getActiveThread();
  if (!thread || state.busy) return;
  let userIndex = index - 1;
  while (userIndex >= 0 && thread.messages[userIndex]?.role !== "user") userIndex -= 1;
  if (userIndex < 0) return;
  const branch = await branchThreadAt(userIndex, { silent: true });
  if (!branch) return;
  await regenerateForThread(branch, branch.messages.at(-1));
}

async function regenerateForThread(thread, userMessage) {
  setBusy(true, thread.mode === "image" ? "Creating" : "Thinking");
  state.controller = new AbortController();
  try {
    if (thread.mode === "image") await generateImage(thread, userMessage.content, state.controller.signal);
    else await generateText(thread, state.controller.signal);
  } finally {
    state.controller = null;
    setBusy(false, "Ready");
  }
}

async function exportThreadMarkdown() {
  const thread = getActiveThread();
  if (!thread) return;
  const lines = [`# ${thread.title}`, "", `- Mode: ${MODES[thread.mode]?.name || thread.mode}`, `- Exported: ${new Date().toISOString()}`, ""];
  for (const message of thread.messages) {
    lines.push(`## ${message.role === "user" ? "You" : "3aik"}${message.model ? ` · ${compactModelName(message.model)}` : ""}`, "");
    if (message.kind === "image") lines.push(`Generated image: ${message.prompt}`);
    else lines.push(message.content || "");
    if (message.attachments?.length) {
      lines.push("", ...message.attachments.map((attachment) => `- Attachment: ${attachment.name} (${formatBytes(attachment.size)})`));
    }
    lines.push("");
  }
  const filename = `3aik-${safeFilename(thread.title)}.md`;
  downloadBlob(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }), filename);
  showToast("Markdown export ready");
}

async function deleteThread(id) {
  if (state.busy) {
    showToast("Stop generation before deleting a conversation");
    return;
  }
  const thread = state.threads.find((candidate) => candidate.id === id);
  if (!thread || !window.confirm(`Delete “${thread.title}”?`)) return;
  state.threads = state.threads.filter((candidate) => candidate.id !== id);
  if (state.activeThreadId === id) state.activeThreadId = null;
  await Promise.all(threadMediaIds(thread).map(deleteMedia));
  saveHistory();
  renderThreads();
  renderConversation();
}

async function clearAllThreads() {
  if (state.busy) {
    showToast("Stop generation before clearing local history");
    return;
  }
  if (!state.threads.length || !window.confirm("Delete every local conversation and generated image?")) return;
  state.threads = [];
  state.activeThreadId = null;
  state.attachments = [];
  await clearMedia();
  saveHistory();
  renderThreads();
  renderAttachmentTray();
  renderConversation();
  showToast("Local history cleared");
}

function touchThread(thread) {
  thread.updatedAt = Date.now();
  const index = state.threads.indexOf(thread);
  if (index > 0) state.threads.unshift(...state.threads.splice(index, 1));
}

function trimThreads(protectedIds = []) {
  if (state.threads.length <= MAX_THREADS) return;
  const protectedSet = new Set([state.activeThreadId, ...protectedIds].filter(Boolean));
  const ordered = [...state.threads].sort((left, right) => right.updatedAt - left.updatedAt);
  const keepIds = new Set([...protectedSet].filter((id) => ordered.some((thread) => thread.id === id)));
  for (const thread of ordered) {
    if (keepIds.size >= MAX_THREADS) break;
    keepIds.add(thread.id);
  }
  const removed = state.threads.filter((thread) => !keepIds.has(thread.id));
  state.threads = ordered.filter((thread) => keepIds.has(thread.id));
  removed.flatMap(threadMediaIds).forEach((id) => deleteMedia(id));
}

function appendThreadMessage(thread, message) {
  thread.messages.push(message);
  const removed = [];
  const textLength = () => thread.messages.reduce(
    (total, item) => total + (item.content?.length || item.prompt?.length || 0),
    0,
  );
  while ((thread.messages.length > MAX_MESSAGES_PER_THREAD || textLength() > MAX_THREAD_TEXT) && thread.messages.length > 1) {
    removed.push(...thread.messages.splice(0, Math.min(2, thread.messages.length - 1)));
  }
  removed.flatMap((item) => [
    ...(item.kind === "image" ? [item.id] : []),
    ...(item.attachments || []).map((attachment) => attachment.id),
  ]).forEach((id) => deleteMedia(id));
}

function openSettings() {
  elements.systemPrompt.value = preferences.systemPrompt;
  elements.temperature.value = String(preferences.temperature);
  elements.temperature.dataset.customized = String(Boolean(preferences.temperatureCustomized));
  const temperatureLabel = preferences.temperatureCustomized ? Number(preferences.temperature).toFixed(1) : "Auto";
  elements.temperatureValue.value = temperatureLabel;
  elements.temperatureValue.textContent = temperatureLabel;
  elements.maxTokens.value = String(preferences.maxTokens);
  elements.rememberHistory.checked = preferences.rememberHistory;
  elements.settingsDialog.showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  const rememberedBefore = preferences.rememberHistory;
  preferences.systemPrompt = elements.systemPrompt.value.trim().slice(0, 2000);
  preferences.temperature = clamp(Number(elements.temperature.value), 0, 1.2);
  preferences.temperatureCustomized = elements.temperature.dataset.customized === "true";
  preferences.maxTokens = Math.round(clamp(Number(elements.maxTokens.value), 256, 8192));
  preferences.rememberHistory = elements.rememberHistory.checked;
  if (rememberedBefore !== preferences.rememberHistory) {
    try {
      if (preferences.rememberHistory) await persistEphemeralMedia();
      else await movePersistentMediaToMemory();
    } catch {
      preferences.rememberHistory = rememberedBefore;
      elements.rememberHistory.checked = rememberedBefore;
      showToast("The local-history setting could not be changed because browser storage is unavailable");
      return;
    }
  }
  savePreferences();
  saveHistory();
  elements.settingsDialog.close();
  showToast("Preferences saved");
}

async function exportWorkspaceJson() {
  elements.exportWorkspace.disabled = true;
  setStatus("Exporting", "busy");
  try {
    const mediaEntries = await getAllMedia();
    const media = [];
    for (const entry of mediaEntries) media.push({ id: String(entry.id), type: entry.blob.type || "application/octet-stream", data: await blobToDataUrl(entry.blob) });
    const backup = {
      format: "3aik-workspace",
      version: 3,
      exportedAt: new Date().toISOString(),
      preferences: { ...preferences },
      workspace: {
        mode: state.mode,
        activeThreadId: state.activeThreadId,
        threads: state.threads,
        draft: { content: elements.prompt.value, attachments: state.attachments },
      },
      media,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(backup)], { type: "application/json" }), `3aik-workspace-${stamp}.json`);
    showToast(`Workspace exported with ${media.length} local ${media.length === 1 ? "file" : "files"}`);
  } catch {
    showToast("Workspace export failed");
  } finally {
    elements.exportWorkspace.disabled = false;
    setStatus("Ready", "ready");
  }
}

async function importWorkspaceJson(file) {
  if (state.busy) {
    showToast("Stop generation before importing a workspace");
    return;
  }
  if (file.size > 128 * 1024 * 1024) {
    showToast("That backup is larger than the 128 MB import limit");
    return;
  }
  elements.importWorkspace.disabled = true;
  setStatus("Importing", "busy");
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "3aik-workspace" || backup.version !== 3 || !backup.workspace || !Array.isArray(backup.workspace.threads)) {
      throw new Error("This is not a supported 3aik workspace backup.");
    }
    if (backup.workspace.threads.length > MAX_THREADS) {
      throw new Error("The backup contains invalid or too many threads.");
    }
    const importedThreads = backup.workspace.threads.map(sanitizeThread);
    if (importedThreads.some((thread) => !thread) || new Set(importedThreads.map((thread) => thread.id)).size !== importedThreads.length) {
      throw new Error("The backup contains invalid or duplicate threads.");
    }
    const draft = sanitizeDraft(backup.workspace.draft);
    if (!draft) throw new Error("The backup contains an invalid draft.");
    const media = Array.isArray(backup.media) ? backup.media : [];
    const importedPreferences = backup.preferences && typeof backup.preferences === "object" ? backup.preferences : {};
    const importedRememberHistory = importedPreferences.rememberHistory !== false;
    if (media.length > 500) throw new Error("The backup contains too many local files.");
    if ((state.threads.length || state.attachments.length) && !window.confirm("Replace this browser's current 3aik workspace with the imported backup?")) return;

    const decoded = [];
    let totalBytes = 0;
    for (const entry of media) {
      if (!entry || typeof entry.id !== "string" || typeof entry.data !== "string") throw new Error("The backup contains an invalid file record.");
      const blob = dataUrlToBlob(entry.data, entry.type);
      totalBytes += blob.size;
      if (totalBytes > 100 * 1024 * 1024) throw new Error("The backup's local files exceed the 100 MB import limit.");
      decoded.push({ id: entry.id, blob });
    }

    await replaceAllMedia(decoded, { remember: importedRememberHistory });
    preferences.theme = importedPreferences.theme === "light" ? "light" : defaultPreferences.theme;
    preferences.systemPrompt = typeof importedPreferences.systemPrompt === "string"
      ? importedPreferences.systemPrompt.slice(0, 2000)
      : defaultPreferences.systemPrompt;
    preferences.temperature = clamp(Number(importedPreferences.temperature ?? defaultPreferences.temperature), 0, 1.2);
    preferences.temperatureCustomized = Boolean(importedPreferences.temperatureCustomized);
    preferences.maxTokens = Math.round(clamp(Number(importedPreferences.maxTokens ?? defaultPreferences.maxTokens), 256, 8192));
    preferences.rememberHistory = importedRememberHistory;
    state.threads = importedThreads;
    state.activeThreadId = state.threads.some((thread) => thread.id === backup.workspace.activeThreadId) ? backup.workspace.activeThreadId : null;
    state.mode = hasMode(backup.workspace.mode) ? backup.workspace.mode : state.activeThreadId ? getActiveThread().mode : "chat";
    elements.prompt.value = draft.content;
    state.attachments = draft.attachments;
    if (state.mode === "image" && state.attachments.length) clearPendingAttachments();
    else if (state.mode !== "chat" && state.attachments.some((attachment) => attachment.kind === "image")) removePendingImageAttachments();
    applyTheme(preferences.theme);
    savePreferences();
    saveHistory();
    renderMode();
    renderThreads();
    renderAttachmentTray();
    resizePrompt();
    updateComposerState();
    await renderConversation();
    elements.settingsDialog.close();
    showToast(`Imported ${state.threads.length} ${state.threads.length === 1 ? "thread" : "threads"}`);
  } catch (error) {
    showToast(error.message || "Workspace import failed");
  } finally {
    elements.importWorkspace.disabled = false;
    setStatus("Ready", "ready");
  }
}

function toggleTheme() {
  preferences.theme = preferences.theme === "dark" ? "light" : "dark";
  applyTheme(preferences.theme);
  savePreferences();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0d100f" : "#f2f2eb";
  elements.themeLabel.textContent = theme === "dark" ? "Light theme" : "Dark theme";
}

function openSidebar() {
  elements.sidebar.classList.add("is-open");
  elements.sidebarScrim.hidden = false;
  elements.mobileMenu.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  elements.sidebar.classList.remove("is-open");
  elements.sidebarScrim.hidden = true;
  elements.mobileMenu.setAttribute("aria-expanded", "false");
}

function setBusy(busy, label) {
  state.busy = busy;
  elements.clearThreads.disabled = busy;
  elements.importWorkspace.disabled = busy;
  document.querySelectorAll(".thread-delete").forEach((button) => { button.disabled = busy; });
  elements.sendButton.classList.toggle("is-stopping", busy);
  elements.sendButton.setAttribute("aria-label", busy ? "Stop generation" : "Send message");
  setStatus(label, busy ? "busy" : "ready");
  updateComposerState();
}

function setStatus(label, status) {
  elements.statusPill.querySelector("span").textContent = label;
  elements.statusPill.classList.toggle("is-busy", status === "busy");
  elements.statusPill.classList.toggle("is-error", status === "error");
}

function updateComposerState() {
  const count = elements.prompt.value.length;
  elements.characterCount.textContent = `${count.toLocaleString()} / 12,000`;
  elements.characterCount.classList.toggle("is-visible", count > 9000);
  elements.sendButton.disabled = !state.busy && elements.prompt.value.trim().length === 0 && state.attachments.length === 0;
}

function resizePrompt() {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 180)}px`;
}

function maybeFollowStream() {
  const distance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
  if (distance < 220) scrollToBottom("auto");
}

function scrollToBottom(behavior = "smooth") {
  elements.conversation.scrollTo({ top: elements.conversation.scrollHeight, behavior });
}

function parseSse(buffer) {
  const normalized = buffer.replace(/\r/g, "");
  const chunks = normalized.split("\n\n");
  const remainder = chunks.pop() || "";
  const events = chunks
    .map((chunk) => chunk.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"))
    .filter(Boolean);
  return { events, remainder };
}

function extractDelta(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.delta === "string") return value.delta;
  if (typeof value.response === "string") return value.response;
  if (typeof value.content === "string") return value.content;
  return value.choices?.[0]?.delta?.content || value.choices?.[0]?.message?.content || "";
}

function stripPrivateReasoning(value) {
  return String(value)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/<\/think>/gi, "")
    .trimStart();
}

async function readError(response) {
  try {
    const body = await response.json();
    return body?.error?.message || body?.error || "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error();
    setStatus("Ready", "ready");
  } catch {
    setStatus("Offline", "error");
    elements.composerContext.textContent = "Cloud AI is offline · local history is still available";
  }
}

async function checkDownloads() {
  try {
    const response = await fetch("/api/downloads", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Number.isSafeInteger(data.total) || data.total < 0 || data.source !== "github_releases") throw new Error();
    const total = new Intl.NumberFormat().format(data.total);
    elements.downloadCount.textContent = total;
    elements.downloadCount.title = `${data.total} downloads counted from published GitHub release assets`;
    elements.sidebarDownloadCount.textContent = `${total} verified GitHub release downloads`;
    elements.sidebarDownloadCount.title = elements.downloadCount.title;
  } catch {
    elements.downloadCount.textContent = "Unavailable";
    elements.downloadCount.title = "GitHub download count is temporarily unavailable";
    elements.sidebarDownloadCount.textContent = "Verified download count unavailable";
    elements.sidebarDownloadCount.title = elements.downloadCount.title;
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied to clipboard");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    showToast("Copied to clipboard");
  }
}

function previewImage(blob, prompt, model = "") {
  const url = URL.createObjectURL(blob);
  state.objectUrls.add(url);
  elements.mediaPreview.src = url;
  elements.mediaPreview.alt = prompt;
  elements.mediaModel.textContent = model ? `Generated by ${compactModelName(model)}` : "Generated by 3aik Image";
  elements.mediaModel.title = model || "";
  state.preview = { blob, name: `3aik-${Date.now()}.${imageExtension(blob.type)}` };
  elements.mediaDialog.showModal();
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageExtension(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function revokeObjectUrls() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls.clear();
  state.preview = null;
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 2400);
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const paths = {
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    edit: '<path d="m4 20 4-.9L18.5 6.6a2 2 0 0 0-3-2.7L5 16.2 4 20Z"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 9c5 0 5-2 8-2"/>',
    regenerate: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.4 9A7 7 0 0 0 6.2 6.2L4 9m16 6-2.2 2.8A7 7 0 0 1 5.6 15"/>',
  };
  svg.innerHTML = paths[name] || "";
  return svg;
}

function updatePageTitle() {
  const thread = getActiveThread();
  document.title = thread ? `${thread.title} — 3aik` : `${MODES[state.mode].name} — 3aik`;
}

function getActiveThread() {
  return state.threads.find((thread) => thread.id === state.activeThreadId) || null;
}

function makeTitle(prompt) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 47).trim()}…` : clean;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatRelativeTime(timestamp) {
  const difference = Date.now() - timestamp;
  if (difference < 60_000) return "now";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function latestModel(thread) {
  if (!thread) return "";
  return [...thread.messages].reverse().find((message) => message.role === "assistant" && message.model)?.model || "";
}

function updateActualModel(model) {
  elements.actualModel.textContent = compactModelName(model);
  elements.actualModel.title = model;
  elements.actualModel.hidden = false;
}

function compactModelName(model) {
  return String(model || "").replace(/^@cf\//, "").replace(/^.*\//, "");
}

function fileLabel(name) {
  const extension = String(name).includes(".") ? String(name).split(".").pop() : "TXT";
  return extension.slice(0, 4).toUpperCase();
}

function textMimeFor(extension) {
  if (extension === "json" || extension === "jsonl") return "application/json";
  if (extension === "csv") return "text/csv";
  return "text/plain";
}

function isSensitiveFilename(name) {
  const lower = String(name).toLowerCase().split(/[\\/]/).pop();
  return /^\.env(?:\.|$)/.test(lower)
    || /^\.dev\.vars(?:\.|$)/.test(lower)
    || lower === ".npmrc"
    || [".pypirc", ".netrc", "_netrc", ".envrc", ".git-credentials", ".gitmodules", ".dockercfg", "gradle.properties", "keystore.properties", "signing.properties"].includes(lower)
    || /\.(?:pem|key|p12|pfx|jks|keystore|kdbx|tfvars)$/.test(lower)
    || /\.tfstate(?:\..+)?$/.test(lower)
    || /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:\.pub)?$/.test(lower)
    || /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/.test(lower);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFilename(value) {
  return String(value || "3aik-thread").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "3aik-thread";
}

function isValidAttachment(attachment) {
  return Boolean(sanitizeAttachment(attachment));
}

function isSafeId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isValidTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000;
}

function sanitizeAttachment(attachment) {
  if (!attachment || typeof attachment !== "object" || !isSafeId(attachment.id)) return null;
  if (typeof attachment.name !== "string" || attachment.name.length < 1 || attachment.name.length > 160) return null;
  if (/[\u0000-\u001f\u007f\\/]/.test(attachment.name) || isSensitiveFilename(attachment.name)) return null;
  if (attachment.kind !== "text" && attachment.kind !== "image") return null;
  if (typeof attachment.type !== "string" || attachment.type.length < 1 || attachment.type.length > 100) return null;
  if (!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(attachment.type)) return null;
  if (attachment.kind === "image" && !IMAGE_TYPES.has(attachment.type)) return null;
  const limit = attachment.kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  if (!Number.isInteger(attachment.size) || attachment.size < 0 || attachment.size > limit) return null;
  return { id: attachment.id, name: attachment.name, type: attachment.type, size: attachment.size, kind: attachment.kind };
}

function threadMediaIds(thread) {
  return thread.messages.flatMap((message) => [
    ...(message.kind === "image" ? [message.id] : []),
    ...(message.attachments || []).map((attachment) => attachment.id),
  ]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function isValidThread(thread) {
  return Boolean(sanitizeThread(thread));
}

function isValidMessage(message) {
  return Boolean(sanitizeMessage(message));
}

function sanitizeMessage(message) {
  if (!message || typeof message !== "object" || !isSafeId(message.id)) return null;
  if (message.role !== "user" && message.role !== "assistant") return null;
  if (message.kind !== "text" && message.kind !== "image") return null;
  if (!isValidTimestamp(message.createdAt) || message.editedAt !== undefined && !isValidTimestamp(message.editedAt)) return null;
  if (message.model !== undefined && (typeof message.model !== "string" || message.model.length > MAX_MODEL_LENGTH)) return null;

  const rawAttachments = message.attachments === undefined ? [] : message.attachments;
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_FILES) return null;
  const attachments = rawAttachments.map(sanitizeAttachment);
  if (attachments.some((attachment) => !attachment)) return null;
  if (new Set(attachments.map((attachment) => attachment.id)).size !== attachments.length) return null;
  if (attachments.reduce((total, attachment) => total + attachment.size, 0) > MAX_ATTACHMENT_BYTES) return null;
  if (attachments.filter((attachment) => attachment.kind === "image").length > MAX_IMAGES) return null;

  const sanitized = { id: message.id, role: message.role, kind: message.kind, createdAt: message.createdAt };
  if (message.kind === "image") {
    if (message.role !== "assistant" || typeof message.prompt !== "string" || message.prompt.length > 12_000 || attachments.length) return null;
    sanitized.prompt = message.prompt;
  } else {
    const limit = message.role === "user" ? 12_000 : MAX_MESSAGE_TEXT;
    if (typeof message.content !== "string" || message.content.length > limit) return null;
    sanitized.content = message.content;
    if (attachments.length) {
      if (message.role !== "user") return null;
      sanitized.attachments = attachments;
    }
  }
  if (message.model) sanitized.model = message.model;
  if (message.editedAt !== undefined) sanitized.editedAt = message.editedAt;
  return sanitized;
}

function sanitizeThread(thread) {
  if (!thread || typeof thread !== "object" || !isSafeId(thread.id) || !hasMode(thread.mode)) return null;
  if (typeof thread.title !== "string" || thread.title.length < 1 || thread.title.length > MAX_TITLE_LENGTH) return null;
  if (!isValidTimestamp(thread.createdAt) || !isValidTimestamp(thread.updatedAt) || thread.updatedAt < thread.createdAt) return null;
  if (thread.parentThreadId !== undefined && !isSafeId(thread.parentThreadId)) return null;
  if (!Array.isArray(thread.messages) || thread.messages.length > MAX_MESSAGES_PER_THREAD) return null;
  const messages = thread.messages.map(sanitizeMessage);
  if (messages.some((message) => !message) || new Set(messages.map((message) => message.id)).size !== messages.length) return null;
  const textSize = messages.reduce((total, message) => total + (message.content?.length || message.prompt?.length || 0), 0);
  if (textSize > MAX_THREAD_TEXT) return null;
  if (thread.mode !== "chat" && messages.some((message) => message.attachments?.some((attachment) => attachment.kind === "image"))) return null;
  const sanitized = {
    id: thread.id,
    title: thread.title,
    mode: thread.mode,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messages,
  };
  if (thread.parentThreadId) sanitized.parentThreadId = thread.parentThreadId;
  return sanitized;
}

function sanitizeDraft(draft) {
  if (draft === undefined || draft === null) return { content: "", attachments: [] };
  if (typeof draft !== "object" || typeof draft.content !== "string" || draft.content.length > 12_000) return null;
  const rawAttachments = draft.attachments === undefined ? [] : draft.attachments;
  if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_FILES) return null;
  const attachments = rawAttachments.map(sanitizeAttachment);
  if (attachments.some((attachment) => !attachment)) return null;
  if (new Set(attachments.map((attachment) => attachment.id)).size !== attachments.length) return null;
  if (attachments.reduce((total, attachment) => total + attachment.size, 0) > MAX_ATTACHMENT_BYTES) return null;
  if (attachments.filter((attachment) => attachment.kind === "image").length > MAX_IMAGES) return null;
  return { content: draft.content, attachments };
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null");
    if (!saved || typeof saved !== "object") return { ...defaultPreferences };
    const temperature = Number(saved.temperature);
    const maxTokens = Number(saved.maxTokens);
    return {
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : defaultPreferences.theme,
      systemPrompt: typeof saved.systemPrompt === "string" ? saved.systemPrompt.slice(0, 2000) : defaultPreferences.systemPrompt,
      temperature: clamp(Number.isFinite(temperature) ? temperature : defaultPreferences.temperature, 0, 1.2),
      temperatureCustomized: typeof saved.temperatureCustomized === "boolean"
        ? saved.temperatureCustomized
        : defaultPreferences.temperatureCustomized,
      maxTokens: Math.round(clamp(Number.isFinite(maxTokens) ? maxTokens : defaultPreferences.maxTokens, 256, 8192)),
      rememberHistory: typeof saved.rememberHistory === "boolean" ? saved.rememberHistory : defaultPreferences.rememberHistory,
    };
  } catch {
    return { ...defaultPreferences };
  }
}

function loadDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[a-zA-Z0-9-]{12,80}$/.test(existing)) return existing;
    const id = createId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return createId();
  }
}

function savePreferences() {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Storage can be disabled. */ }
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "null");
    return sanitizeHistory(saved);
  } catch {
    return {};
  }
}

function sanitizeHistory(saved) {
  if (!saved || typeof saved !== "object") return {};
  const rawThreads = Array.isArray(saved.threads) ? saved.threads.slice(0, MAX_THREADS) : [];
  const threads = [];
  const ids = new Set();
  for (const rawThread of rawThreads) {
    const thread = sanitizeThread(rawThread);
    if (!thread || ids.has(thread.id)) continue;
    ids.add(thread.id);
    threads.push(thread);
  }
  const activeThreadId = isSafeId(saved.activeThreadId) && ids.has(saved.activeThreadId) ? saved.activeThreadId : null;
  return {
    mode: hasMode(saved.mode) ? saved.mode : activeThreadId ? threads.find((thread) => thread.id === activeThreadId)?.mode : "chat",
    activeThreadId,
    threads,
    savedAt: isValidTimestamp(saved.savedAt) ? saved.savedAt : 0,
  };
}

function historyPayload() {
  state.lastSavedAt = Math.max(Date.now(), state.lastSavedAt + 1);
  return {
    version: 3,
    savedAt: state.lastSavedAt,
    mode: state.mode,
    activeThreadId: state.activeThreadId,
    threads: state.threads.map((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => ({
        ...message,
        ...(message.attachments ? { attachments: message.attachments.map((attachment) => ({ ...attachment })) } : {}),
      })),
    })),
  };
}

function saveHistory() {
  state.persistenceVersion += 1;
  if (!preferences.rememberHistory) {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch { /* IndexedDB remains the authoritative deletion path. */ }
    queueHistoryDelete().catch(() => showToast("Local history could not be cleared from browser storage"));
    return;
  }

  const payload = historyPayload();
  let localStorageFailed = false;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
  } catch {
    localStorageFailed = true;
  }
  queueHistoryWrite(payload).catch(() => {
    if (localStorageFailed) showToast("Local history could not be saved; export this workspace before closing");
  });
}

async function hydrateHistoryFromDatabase() {
  if (!preferences.rememberHistory) {
    queueHistoryDelete();
    clearPersistentMedia();
    return;
  }
  const observedVersion = state.persistenceVersion;
  try {
    const record = await getHistoryRecord();
    if (state.persistenceVersion !== observedVersion) return;
    if (!record) {
      if (state.threads.length && preferences.rememberHistory) queueHistoryWrite(historyPayload());
      return;
    }
    const persisted = sanitizeHistory(record);
    if (persisted.savedAt <= state.lastSavedAt) return;
    state.mode = persisted.mode;
    state.activeThreadId = persisted.activeThreadId;
    state.threads = persisted.threads;
    state.lastSavedAt = persisted.savedAt;
    renderMode();
    renderThreads();
    await renderConversation();
  } catch {
    // localStorage remains a bounded compatibility fallback when IndexedDB is unavailable.
  }
}

let mediaDatabase;
const ephemeralMedia = new Map();
function openMediaDatabase() {
  if (mediaDatabase) return mediaDatabase;
  mediaDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("media")) request.result.createObjectStore("media");
      if (!request.result.objectStoreNames.contains(HISTORY_STORE_NAME)) request.result.createObjectStore(HISTORY_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return mediaDatabase;
}

let historyWriteQueue = Promise.resolve();

function queueHistoryWrite(payload) {
  historyWriteQueue = historyWriteQueue.catch(() => {}).then(async () => {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(HISTORY_STORE_NAME, "readwrite");
      transaction.objectStore(HISTORY_STORE_NAME).put(payload, "workspace");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Local history write was aborted."));
    });
  });
  return historyWriteQueue;
}

function queueHistoryDelete() {
  historyWriteQueue = historyWriteQueue.catch(() => {}).then(async () => {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(HISTORY_STORE_NAME, "readwrite");
      transaction.objectStore(HISTORY_STORE_NAME).delete("workspace");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Local history deletion was aborted."));
    });
  });
  return historyWriteQueue;
}

async function getHistoryRecord() {
  const database = await openMediaDatabase();
  return await new Promise((resolve, reject) => {
    const request = database.transaction(HISTORY_STORE_NAME).objectStore(HISTORY_STORE_NAME).get("workspace");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function putMedia(id, blob) {
  if (!preferences.rememberHistory) {
    ephemeralMedia.set(id, blob);
    return;
  }
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("media", "readwrite");
    transaction.objectStore("media").put(blob, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Local storage transaction was aborted."));
  });
}

async function getMedia(id) {
  if (ephemeralMedia.has(id)) return ephemeralMedia.get(id);
  try {
    const database = await openMediaDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction("media").objectStore("media").get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function copyMedia(sourceId, targetId) {
  const blob = await getMedia(sourceId);
  if (!blob) return false;
  await putMedia(targetId, blob);
  return true;
}

async function getPersistentMedia() {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const entries = [];
    const request = database.transaction("media").objectStore("media").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      entries.push({ id: cursor.key, blob: cursor.value });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

async function getAllMedia() {
  const combined = new Map();
  try {
    for (const entry of await getPersistentMedia()) combined.set(entry.id, entry.blob);
  } catch { /* Ephemeral media can still be exported. */ }
  for (const [id, blob] of ephemeralMedia) combined.set(id, blob);
  return [...combined].map(([id, blob]) => ({ id, blob }));
}

async function replaceAllMedia(entries, { remember = preferences.rememberHistory } = {}) {
  ephemeralMedia.clear();
  if (!remember) {
    await clearPersistentMedia();
    entries.forEach((entry) => ephemeralMedia.set(entry.id, entry.blob));
    return;
  }
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("media", "readwrite");
    const store = transaction.objectStore("media");
    store.clear();
    entries.forEach((entry) => store.put(entry.blob, entry.id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Local file import was aborted."));
  });
}

async function movePersistentMediaToMemory() {
  try {
    for (const entry of await getPersistentMedia()) ephemeralMedia.set(entry.id, entry.blob);
  } catch { /* No persistent media exists when IndexedDB is unavailable. */ }
  await clearPersistentMedia();
}

async function persistEphemeralMedia() {
  if (!ephemeralMedia.size) return;
  const entries = [...ephemeralMedia].map(([id, blob]) => ({ id, blob }));
  const database = await openMediaDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("media", "readwrite");
    const store = transaction.objectStore("media");
    entries.forEach((entry) => store.put(entry.blob, entry.id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Local media persistence was aborted."));
  });
  ephemeralMedia.clear();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl, fallbackType = "application/octet-stream") {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error("The backup contains malformed local file data.");
  const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1] || fallbackType });
}

async function deleteMedia(id) {
  ephemeralMedia.delete(id);
  try {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      transaction.objectStore("media").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Local storage transaction was aborted."));
    });
  } catch { /* The text thread can still be deleted. */ }
}

async function clearMedia() {
  ephemeralMedia.clear();
  await clearPersistentMedia();
}

async function clearPersistentMedia() {
  try {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      transaction.objectStore("media").clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Local storage transaction was aborted."));
    });
  } catch { /* IndexedDB may be unavailable in private browsing. */ }
}
