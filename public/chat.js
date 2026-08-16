"use strict";

const HISTORY_KEY = "3aik:history:v2";
const PREFERENCES_KEY = "3aik:preferences:v2";
const MEDIA_DB_NAME = "3aik-media-v2";
const MAX_THREADS = 30;

const MODES = {
  chat: {
    name: "Ask",
    model: "Llama 4 Scout",
    kicker: "Llama 4 Scout · fast and versatile",
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
    model: "GPT OSS 120B",
    kicker: "GPT OSS 120B · deliberate reasoning",
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
    model: "Qwen 2.5 Coder 32B",
    kicker: "Qwen 2.5 Coder · implementation focused",
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
    model: "FLUX.1 Schnell",
    kicker: "FLUX.1 Schnell · image generation",
    title: "Describe it.<br><em>See it.</em>",
    description: "Write a visual prompt with the subject, composition, light, mood, and style you want.",
    placeholder: "Describe the image you want to create…",
    context: "Square PNG · stored locally on this device",
    suggestions: [
      ["EDITORIAL", "A quiet editorial portrait with soft window light"],
      ["PRODUCT", "A premium product photo on a bold color field"],
      ["WORLD", "An impossible landscape at the edge of a storm"],
    ],
  },
};

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
  conversation: document.querySelector("#conversation"),
  emptyState: document.querySelector("#empty-state"),
  emptyKicker: document.querySelector("#empty-kicker"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  suggestionGrid: document.querySelector("#suggestion-grid"),
  messages: document.querySelector("#messages"),
  jumpBottom: document.querySelector("#jump-bottom"),
  activeModel: document.querySelector("#active-model"),
  composerContext: document.querySelector("#composer-context"),
  composerForm: document.querySelector("#composer-form"),
  prompt: document.querySelector("#prompt-input"),
  characterCount: document.querySelector("#character-count"),
  sendButton: document.querySelector("#send-button"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  systemPrompt: document.querySelector("#system-prompt"),
  temperature: document.querySelector("#temperature"),
  temperatureValue: document.querySelector("#temperature-value"),
  maxTokens: document.querySelector("#max-tokens"),
  rememberHistory: document.querySelector("#remember-history"),
  saveSettings: document.querySelector("#save-settings"),
  mediaDialog: document.querySelector("#media-dialog"),
  mediaPreview: document.querySelector("#media-preview"),
  mediaDownload: document.querySelector("#media-download"),
  mediaClose: document.querySelector("#media-close"),
  toast: document.querySelector("#toast"),
};

const defaultPreferences = {
  theme: window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark",
  systemPrompt: "",
  temperature: 0.6,
  maxTokens: 2048,
  rememberHistory: true,
};

const preferences = loadPreferences();
const history = loadHistory();
const state = {
  mode: MODES[history.mode] ? history.mode : "chat",
  activeThreadId: history.activeThreadId || null,
  threads: Array.isArray(history.threads) ? history.threads.filter(isValidThread).slice(0, MAX_THREADS) : [],
  busy: false,
  controller: null,
  renderVersion: 0,
  objectUrls: new Set(),
  preview: null,
};

if (!state.threads.some((thread) => thread.id === state.activeThreadId)) state.activeThreadId = null;

initialize();

function initialize() {
  applyTheme(preferences.theme);
  bindEvents();
  if (state.activeThreadId) state.mode = getActiveThread().mode;
  renderMode();
  renderThreads();
  renderConversation();
  resizePrompt();
  updateComposerState();
  checkHealth();
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

  elements.conversation.addEventListener("scroll", () => {
    const distance = elements.conversation.scrollHeight - elements.conversation.scrollTop - elements.conversation.clientHeight;
    elements.jumpBottom.hidden = distance < 180;
  }, { passive: true });
  elements.jumpBottom.addEventListener("click", () => scrollToBottom("smooth"));

  elements.settingsButton.addEventListener("click", openSettings);
  elements.temperature.addEventListener("input", () => {
    elements.temperatureValue.value = Number(elements.temperature.value).toFixed(1);
    elements.temperatureValue.textContent = Number(elements.temperature.value).toFixed(1);
  });
  elements.saveSettings.addEventListener("click", saveSettings);

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
  if (!MODES[mode] || mode === state.mode && !options.force) {
    closeSidebar();
    return;
  }

  if (state.busy) state.controller?.abort();
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
  elements.emptyKicker.textContent = mode.kicker;
  elements.emptyTitle.innerHTML = mode.title;
  elements.emptyDescription.textContent = mode.description;
  elements.prompt.placeholder = mode.placeholder;
  elements.composerContext.textContent = mode.context;
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
  trimThreads();
  return thread;
}

async function sendPrompt() {
  const prompt = elements.prompt.value.trim();
  if (!prompt || state.busy) return;

  const thread = ensureThread(prompt);
  const userMessage = { id: createId(), role: "user", kind: "text", content: prompt, createdAt: Date.now() };
  thread.messages.push(userMessage);
  thread.updatedAt = Date.now();
  elements.prompt.value = "";
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

async function generateText(thread, signal) {
  const placeholder = createAssistantShell({ streaming: true });
  elements.messages.append(placeholder.article);
  scrollToBottom("smooth");
  let fullResponse = "";
  let streamBuffer = "";

  try {
    const messages = thread.messages
      .filter((message) => message.kind === "text" && (message.role === "user" || message.role === "assistant"))
      .slice(-24)
      .map(({ role, content }) => ({ role, content }));

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        mode: thread.mode,
        temperature: preferences.temperature,
        maxTokens: preferences.maxTokens,
        systemPrompt: preferences.systemPrompt,
      }),
      signal,
    });

    if (!response.ok) throw new Error(await readError(response));
    if (!response.body) throw new Error("This browser could not read the response stream.");

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
    renderRichText(cleanResponse, placeholder.content, false);
    placeholder.actions.hidden = false;
    placeholder.copyButton.addEventListener("click", () => copyText(cleanResponse));
    thread.messages.push({ id: createId(), role: "assistant", kind: "text", content: cleanResponse, createdAt: Date.now() });
    thread.updatedAt = Date.now();
    saveHistory();
    renderThreads();
  } catch (error) {
    if (error.name === "AbortError") {
      if (fullResponse.trim()) {
        const cleanResponse = stripPrivateReasoning(fullResponse).trim();
        renderRichText(`${cleanResponse}\n\n_Response stopped._`, placeholder.content, false);
        thread.messages.push({ id: createId(), role: "assistant", kind: "text", content: cleanResponse, createdAt: Date.now() });
        saveHistory();
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal,
    });
    if (!response.ok) throw new Error(await readError(response));

    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0) throw new Error("The image response was invalid.");
    const message = { id: createId(), role: "assistant", kind: "image", prompt, createdAt: Date.now() };
    await putMedia(message.id, blob);
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    saveHistory();
    await replaceWithImage(shell.content, message, blob);
    renderThreads();
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
  elements.emptyState.classList.toggle("is-hidden", hasMessages);
  elements.messages.classList.toggle("has-messages", hasMessages);
  elements.threadTitle.textContent = thread?.title || "Untitled thread";
  updatePageTitle();
  if (!hasMessages) return;

  for (const message of thread.messages) {
    if (version !== state.renderVersion) return;
    if (message.role === "user") {
      elements.messages.append(renderUserMessage(message));
    } else if (message.kind === "image") {
      const shell = createAssistantShell({ image: true });
      const skeleton = document.createElement("div");
      skeleton.className = "image-skeleton";
      shell.content.append(skeleton);
      elements.messages.append(shell.article);
      const blob = await getMedia(message.id);
      if (version !== state.renderVersion) return;
      if (blob) await replaceWithImage(shell.content, message, blob);
      else renderExpiredImage(shell.content, message);
    } else {
      elements.messages.append(renderAssistantMessage(message));
    }
  }
  requestAnimationFrame(() => scrollToBottom("auto"));
}

function renderUserMessage(message) {
  const article = document.createElement("article");
  article.className = "message user";
  const bubble = document.createElement("div");
  bubble.className = "user-bubble";
  bubble.textContent = message.content;
  article.append(bubble);
  return article;
}

function renderAssistantMessage(message) {
  const shell = createAssistantShell({ createdAt: message.createdAt });
  renderRichText(message.content, shell.content, false);
  shell.actions.hidden = false;
  shell.copyButton.addEventListener("click", () => copyText(message.content));
  return shell.article;
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

async function replaceWithImage(container, message, blob) {
  const url = URL.createObjectURL(blob);
  state.objectUrls.add(url);
  const card = document.createElement("div");
  card.className = "image-card";
  const image = document.createElement("img");
  image.src = url;
  image.alt = message.prompt;
  image.loading = "lazy";
  image.addEventListener("click", () => previewImage(blob, message.prompt));
  const footer = document.createElement("div");
  footer.className = "image-card-footer";
  const caption = document.createElement("span");
  caption.textContent = message.prompt;
  const download = document.createElement("button");
  download.type = "button";
  download.className = "secondary-button";
  download.textContent = "Download PNG";
  download.addEventListener("click", () => downloadBlob(blob, `3aik-${message.id}.png`));
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

  lines.forEach((line) => {
    const fence = line.match(/^```\s*([\w.+#-]*)\s*$/);
    if (fence) {
      flushParagraph();
      closeList();
      if (code === null) {
        code = [];
        language = fence[1] || "text";
      } else flushCode();
      return;
    }
    if (code !== null) {
      code.push(line);
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      closeList();
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const h = document.createElement(`h${Math.min(heading[1].length + 1, 4)}`);
      appendInline(h, heading[2]);
      container.append(h);
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = numbered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = document.createElement(tag);
        container.append(list);
      }
      const item = document.createElement("li");
      appendInline(item, (bullet || numbered)[1]);
      list.append(item);
      return;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      const blockquote = document.createElement("blockquote");
      appendInline(blockquote, quote[1]);
      container.append(blockquote);
      return;
    }

    paragraph.push(line.trim());
  });

  flushParagraph();
  flushCode();
  if (streaming) {
    const cursor = document.createElement("span");
    cursor.className = "typing-cursor";
    cursor.setAttribute("aria-hidden", "true");
    container.append(cursor);
  }
}

function appendInline(parent, text) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g;
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
  state.activeThreadId = id;
  state.mode = thread.mode;
  saveHistory();
  renderMode();
  renderThreads();
  renderConversation();
  closeSidebar();
}

async function deleteThread(id) {
  const thread = state.threads.find((candidate) => candidate.id === id);
  if (!thread || !window.confirm(`Delete “${thread.title}”?`)) return;
  state.threads = state.threads.filter((candidate) => candidate.id !== id);
  if (state.activeThreadId === id) state.activeThreadId = null;
  await Promise.all(thread.messages.filter((message) => message.kind === "image").map((message) => deleteMedia(message.id)));
  saveHistory();
  renderThreads();
  renderConversation();
}

async function clearAllThreads() {
  if (!state.threads.length || !window.confirm("Delete every local conversation and generated image?")) return;
  state.threads = [];
  state.activeThreadId = null;
  await clearMedia();
  saveHistory();
  renderThreads();
  renderConversation();
  showToast("Local history cleared");
}

function trimThreads() {
  if (state.threads.length <= MAX_THREADS) return;
  const removed = state.threads.splice(MAX_THREADS);
  removed.flatMap((thread) => thread.messages).filter((message) => message.kind === "image").forEach((message) => deleteMedia(message.id));
}

function openSettings() {
  elements.systemPrompt.value = preferences.systemPrompt;
  elements.temperature.value = String(preferences.temperature);
  elements.temperatureValue.value = Number(preferences.temperature).toFixed(1);
  elements.temperatureValue.textContent = Number(preferences.temperature).toFixed(1);
  elements.maxTokens.value = String(preferences.maxTokens);
  elements.rememberHistory.checked = preferences.rememberHistory;
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  preferences.systemPrompt = elements.systemPrompt.value.trim().slice(0, 2000);
  preferences.temperature = clamp(Number(elements.temperature.value), 0, 1.2);
  preferences.maxTokens = Math.round(clamp(Number(elements.maxTokens.value), 256, 4096));
  preferences.rememberHistory = elements.rememberHistory.checked;
  savePreferences();
  saveHistory();
  elements.settingsDialog.close();
  showToast("Preferences saved");
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
  elements.sendButton.disabled = !state.busy && elements.prompt.value.trim().length === 0;
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

function previewImage(blob, prompt) {
  const url = URL.createObjectURL(blob);
  state.objectUrls.add(url);
  elements.mediaPreview.src = url;
  elements.mediaPreview.alt = prompt;
  state.preview = { blob, name: `3aik-${Date.now()}.png` };
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function isValidThread(thread) {
  return thread && typeof thread.id === "string" && typeof thread.title === "string" && MODES[thread.mode] && Array.isArray(thread.messages);
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null");
    return { ...defaultPreferences, ...(saved && typeof saved === "object" ? saved : {}) };
  } catch {
    return { ...defaultPreferences };
  }
}

function savePreferences() {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Storage can be disabled. */ }
}

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function saveHistory() {
  try {
    if (!preferences.rememberHistory) {
      localStorage.removeItem(HISTORY_KEY);
      return;
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      version: 2,
      mode: state.mode,
      activeThreadId: state.activeThreadId,
      threads: state.threads,
    }));
  } catch {
    showToast("Local storage is full; this thread may not persist");
  }
}

let mediaDatabase;
function openMediaDatabase() {
  if (mediaDatabase) return mediaDatabase;
  mediaDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("media");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return mediaDatabase;
}

async function putMedia(id, blob) {
  const database = await openMediaDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("media", "readwrite");
    transaction.objectStore("media").put(blob, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getMedia(id) {
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

async function deleteMedia(id) {
  try {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      transaction.objectStore("media").delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* The text thread can still be deleted. */ }
}

async function clearMedia() {
  try {
    const database = await openMediaDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("media", "readwrite");
      transaction.objectStore("media").clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* IndexedDB may be unavailable in private browsing. */ }
}
