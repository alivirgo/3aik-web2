// DOM Elements
const messagesEl = document.getElementById("messages");
const messagesContainer = document.querySelector(".messages-container");
const promptInput = document.getElementById("prompt-input");
const btnSend = document.getElementById("send-btn");
const modelSelect = document.getElementById("model-select");
const imageModelSelect = document.getElementById("image-model-select");
const codingModelSelect = document.getElementById("coding-model-select");
const videoModelSelect = document.getElementById("video-model-select");
const systemPromptInput = document.getElementById("system-prompt");
const temperatureInput = document.getElementById("temperature");
const maxTokensInput = document.getElementById("max-tokens");
const sizeSelect = document.getElementById("size-select");
const searchToggle = document.getElementById("search-toggle");
const mobileModeSelect = document.getElementById("mobile-mode-select");
const mobileModelSelect = document.getElementById("mobile-model-select");
const loadingOverlay = document.getElementById("loading-overlay");

// Modals
const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const closeSettingsBtn = document.getElementById("close-settings");
const saveSettingsBtn = document.getElementById("save-settings-btn");

// State
let conversation = [];
let currentMode = "chat"; // text, image, video, gif, coding
let isAutoScrollEnabled = true;

const MODEL_INFO = {
  // Text Models
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "Llama 3.3 70B (Fast): High-speed, high-performance meta model.",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": "DeepSeek R1 32B: Specialized for deep reasoning and complex logic.",
  "@cf/meta/llama-3.1-8b-instruct": "Llama 3.1 8B: Balanced Meta AI for versatile everyday tasks.",
  "@cf/meta/llama-3.2-3b-instruct": "Llama 3.2 3B: Lightweight Meta model for quick, straightforward answers.",
  "@cf/qwen/qwen2.5-coder-32b-instruct": "Qwen 2.5 Coder 32B: Advanced programming assistant for debugging and logic.",
  "@cf/openai/gpt-oss-120b": "GPT OSS 120B: Ultra-large parameter model for complex creative and analytical text generation.",
  "@cf/meta/llama-3.1-70b-instruct": "Llama 3.1 70B: High-capacity Meta AI for deep comprehension and creative writing.",
  "@cf/google/gemma-3-12b-it": "Gemma 3 12B: Google's latest multimodal open model with high-performance reasoning.",
  "@cf/meta/llama-4-scout-17b-16e-instruct": "Llama 4 Scout 17B: Meta's next-gen efficient model for fast and accurate chat.",
  "pollinations-chat": "Pollinations AI: Advanced multimodal chat powered by various state-of-the-art models.",
  "pollinations-code": "Pollinations Coder: Specialized AI for high-quality code generation and technical problem solving.",

  // Coding Models
  "@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq": "DeepSeek Coder 6.7B: Fast and efficient AI for bug fixing, code optimization, and development.",

  // Image Models
  "pollinations-turbo": "GPT Image 1 Mini: High-speed, high-quality image generation via Pollinations Turbo.",
  "pollinations-flux": "Flux Pro (Pollinations): State-of-the-art HD image generation with superior detail.",
  "pollinations-any": "Anime & Art (Pollinations): Optimized for artistic styles and anime aesthetics.",
  "pollinations-dream": "Dream Artist (Pollinations): Surreal and imaginative creative image generation.",
  "pollinations-pixart": "PixArt 1024 (Pollinations): High-resolution transformer-based image model.",
  "pollinations-portrait": "Realistic Portrait (Pollinations): Specialized for human faces and realistic textures.",
  "@cf/black-forest-labs/flux-1-schnell": "Flux-1 Schnell: The fastest high-quality open-source layout model from Black Forest Labs.",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0": "SDXL 1.0: Professional-grade imagery with broad artistic control.",
  "@cf/leonardoai/phoenix-1.0": "Leonardo Phoenix: High-end artistic fidelity and innovative style coherence.",
  "@cf/bytedance/sdxl-lightning": "SDXL Lightning: Ultra-fast generation using ByteDance's advanced distillation."
};

/**
 * UI: Scroll chat to bottom with improved reliability
 */
function scrollToBottom(force = false) {
  if (!isAutoScrollEnabled && !force) return;

  // Use requestAnimationFrame to ensure DOM is updated
  requestAnimationFrame(() => {
    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: force ? "auto" : "smooth"
    });
  });
}

// User scroll detection to toggle auto-scroll
messagesContainer.addEventListener("scroll", () => {
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
  // If user scrolls up significantly, disable auto-scroll
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
  isAutoScrollEnabled = isAtBottom;
});

/**
 * UI: Render a text message
 */
function addTextMessage(role, content) {
  const el = document.createElement("div");
  el.className = `message ${role}-msg`;

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = role === "user" ? "👤" : "✨";

  const contentEl = document.createElement("div");
  contentEl.className = "msg-content";

  const textEl = document.createElement("div");
  textEl.className = "msg-text";

  // Check for reasoning blocks <think>...</think>
  const rtMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (rtMatch) {
    const reasoning = rtMatch[1].trim();
    const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();

    const reasoningBlock = document.createElement("div");
    reasoningBlock.className = "reasoning-block collapsed";

    const header = document.createElement("div");
    header.className = "reasoning-header";
    header.textContent = "Thought Process";
    header.onclick = () => {
      reasoningBlock.classList.toggle("collapsed");
      scrollToBottom();
    };

    const reasoningContent = document.createElement("div");
    reasoningContent.className = "reasoning-content";
    reasoningContent.textContent = reasoning;

    reasoningBlock.appendChild(header);
    reasoningBlock.appendChild(reasoningContent);
    contentEl.appendChild(reasoningBlock);

    textEl.innerHTML = marked.parse(cleanContent || "Thinking complete. Generating response...");
  } else {
    textEl.innerHTML = marked.parse(content);
  }

  contentEl.appendChild(textEl);
  el.appendChild(avatar);
  el.appendChild(contentEl);
  messagesEl.appendChild(el);

  // Wait for animations/rendering before scrolling
  setTimeout(() => scrollToBottom(), 50);
  return textEl;
}

/**
 * UI: Render a media message (image/video/gif)
 */
function addMediaMessage(mediaSrc, caption, type = "image", replaceTarget = null) {
  const el = replaceTarget || document.createElement("div");
  el.className = "message assistant-msg";
  el.innerHTML = ""; // Clear existing content if replacing

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = type === "video" ? "🎬" : (type === "gif" ? "🎞️" : "🎨");

  const content = document.createElement("div");
  content.className = "msg-content";

  let mediaEl;
  if (type === "video") {
    mediaEl = document.createElement("video");
    mediaEl.className = "msg-video";
    mediaEl.controls = true;
    mediaEl.autoplay = true;
    mediaEl.loop = true;
    mediaEl.muted = true;
    mediaEl.playsInline = true;
    mediaEl.onloadedmetadata = () => scrollToBottom(true);

    const source = document.createElement("source");
    source.src = mediaSrc;
    source.type = "video/mp4";
    mediaEl.appendChild(source);
  } else {
    mediaEl = document.createElement("img");
    mediaEl.className = "msg-image";
    mediaEl.src = mediaSrc;
    mediaEl.alt = caption;
    mediaEl.loading = "lazy";
    mediaEl.onload = () => scrollToBottom(true);
  }

  const captionEl = document.createElement("div");
  captionEl.className = "msg-subtext";
  captionEl.textContent = caption;

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "msg-download";
  downloadBtn.textContent = "⬇️ Download";
  downloadBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = mediaSrc;
    a.download = `3aik-${Date.now()}.${type === "video" ? "mp4" : (type === "gif" ? "gif" : "png")}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  content.appendChild(mediaEl);
  content.appendChild(captionEl);
  content.appendChild(downloadBtn);
  el.appendChild(avatar);
  el.appendChild(content);

  if (!replaceTarget) {
    messagesEl.appendChild(el);
  }

  scrollToBottom(true);
}

/**
 * API: Handle Text Generation (Streaming)
 */
async function generateText() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  promptInput.value = "";
  promptInput.style.height = "auto";
  addTextMessage("user", prompt);
  conversation.push({ role: "user", content: prompt });

  const textEl = addTextMessage("assistant", "...");
  let fullResponse = "";

  // Enable auto-scroll for streaming
  isAutoScrollEnabled = true;

  try {
    const isCoding = currentMode === "coding";
    const isSearch = searchToggle && searchToggle.checked;

    // Sync mobile and desktop model selectors if both exist
    let selectedModel = isCoding ? codingModelSelect.value : modelSelect.value;
    if (window.innerWidth <= 768 && mobileModelSelect && !isCoding) {
      selectedModel = mobileModelSelect.value;
    }
    const systemPromptText = isCoding
      ? (systemPromptInput.value || "You are an expert software engineer. Provide high-quality, efficient, and well-documented code. Always use markdown for code blocks.")
      : systemPromptInput.value;

    const MAX_HISTORY = 12;
    const messagesToSend = conversation
      .slice(-MAX_HISTORY)
      .map(m => ({
        role: m.role,
        content: m.content ? m.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : ""
      }))
      .filter(m => m.content);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messagesToSend,
        model: selectedModel,
        systemPrompt: systemPromptText,
        temperature: parseFloat(temperatureInput.value),
        max_tokens: parseInt(maxTokensInput.value, 10),
        search: isSearch
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to fetch response");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, buffer: remaining } = parseSSE(buffer);
      buffer = remaining;

      for (const event of events) {
        try {
          const json = JSON.parse(event);
          const delta = json.response || json.delta?.content || (json.choices?.[0]?.delta?.content) || json.content || "";

          if (delta) {
            fullResponse += delta;
            let displayResponse = fullResponse;
            const rtMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
            if (rtMatch) {
              displayResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/, "").trim() || "Thinking complete. Generating response...";
            } else if (fullResponse.includes("<think>")) {
              displayResponse = "Thinking...";
            } else if (fullResponse.length === 0 && isSearch) {
              displayResponse = "🔍 *Searching the web for updated information...*";
            }
            textEl.innerHTML = marked.parse(displayResponse);

            // Continuous auto-scroll during stream
            scrollToBottom();
          }
        } catch (e) {
          console.warn("[Chat] SSE Parse error:", e);
        }
      }
    }

    if (!fullResponse) {
      textEl.textContent = "⚠️ No response received from the model.";
    } else {
      conversation.push({ role: "assistant", content: fullResponse });
    }
  } catch (error) {
    console.error("[Chat] Error:", error);
    textEl.textContent = `Error: ${error.message}`;
  } finally {
    // Highlight any new code blocks
    textEl.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  }
}

/**
 * API: Handle Media Generation
 */
async function generateMedia() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  promptInput.value = "";
  promptInput.style.height = "auto";
  addTextMessage("user", prompt);

  // Create an inline text message that acts as the loading indicator
  // We'll target its parent container for replacement
  const loadingTextEl = addTextMessage("assistant", "🎨 We are generating your image...");
  const loadingContainer = loadingTextEl.parentElement.parentElement;

  try {
    const dimensions = sizeSelect.value.split("x");
    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: imageModelSelect.value,
        width: parseInt(dimensions[0]),
        height: parseInt(dimensions[1]),
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || "Failed to generate media");
    }

    const { images: mediaList } = await response.json();
    if (!mediaList || mediaList.length === 0) throw new Error("No media returned.");

    const media = mediaList[0];
    let mediaSrc = media.url || (media.b64 ? `data:${media.mime || "image/png"};base64,${media.b64}` : "");
    if (!mediaSrc) throw new Error("Invalid media response format.");

    const type = currentMode === "video" ? "video" : (currentMode === "gif" ? "gif" : "image");

    // Replace the loading message with the final media
    addMediaMessage(mediaSrc, prompt, type, loadingContainer);
  } catch (error) {
    console.error("[Media] Error:", error);

    // Replace the loading message with an error message
    loadingContainer.innerHTML = "";
    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.textContent = "✨";

    const contentEl = document.createElement("div");
    contentEl.className = "msg-content";

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = `⚠️ Failed to generate: ${error.message}`;

    contentEl.appendChild(textEl);
    loadingContainer.appendChild(avatar);
    loadingContainer.appendChild(contentEl);
  }
}

/**
 * Logic: Parse SSE (Server-Sent Events)
 */
function parseSSE(buffer) {
  const events = [];
  buffer = buffer.replace(/\r/g, "");
  let index;
  while ((index = buffer.indexOf("\n\n")) !== -1) {
    const chunk = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const lines = chunk.split("\n");
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (data.length) events.push(data.join("\n"));
  }
  return { events, buffer };
}

/**
 * Event Listeners
 */
btnSend.addEventListener("click", () => {
  if (currentMode === "chat" || currentMode === "coding") generateText();
  else generateMedia();
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    btnSend.click();
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = promptInput.scrollHeight + "px";
});

// Settings Logic
if (settingsBtn) {
  settingsBtn.addEventListener("click", () => {
    console.log("[UI] Opening Settings Modal");
    settingsModal.style.display = "flex";
  });
}

if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener("click", () => settingsModal.style.display = "none");
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", () => {
    settingsModal.style.display = "none";
  });
}

temperatureInput.addEventListener("input", () => {
  document.getElementById("temp-value").textContent = temperatureInput.value;
});

// Clear History
const btnClear = document.getElementById("clear-btn");
if (btnClear) {
  btnClear.addEventListener("click", () => {
    if (confirm("Clear all history?")) {
      conversation = [];
      messagesEl.innerHTML = `
        <div class="message assistant-msg">
          <div class="msg-avatar">🤖</div>
          <div class="msg-content">
            <div class="msg-text">History cleared.</div>
          </div>
        </div>
      `;
      scrollToBottom(true);
    }
  });
}

// Mode Switching Logic (Centralized)
function switchMode(mode) {
  currentMode = mode;

  // Update active state in sidebar
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    if (btn.dataset.mode === mode) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  // Toggle Visibility
  const textModelSection = document.getElementById("text-model-section");
  const codingModelSection = document.getElementById("coding-model-section");
  const imageModelSection = document.getElementById("image-model-section");
  const videoModelSection = document.getElementById("video-model-section");
  const mediaSizeSection = document.getElementById("media-size-section");

  if (textModelSection) textModelSection.style.display = (mode === "chat") ? "block" : "none";
  if (codingModelSection) codingModelSection.style.display = (mode === "coding") ? "block" : "none";
  if (imageModelSection) imageModelSection.style.display = (mode === "image") ? "block" : "none";
  if (videoModelSection) videoModelSection.style.display = (mode === "video") ? "block" : "none";
  if (mediaSizeSection) mediaSizeSection.style.display = (mode === "image" || mode === "video" || mode === "gif") ? "block" : "none";

  // Toggle Containers
  const gamesContainer = document.getElementById("games-container");
  if (messagesContainer) messagesContainer.style.display = (mode === "games") ? "none" : "flex";
  if (gamesContainer) gamesContainer.style.display = (mode === "games") ? "block" : "none";

  // Hide input area for games mode
  const inputArea = document.querySelector(".input-area");
  if (inputArea) inputArea.style.display = (mode === "games") ? "none" : "block";

  if (mode === "games") {
    initGamesLogic();
  }

  // Sync mobile selectors
  if (mobileModeSelect) mobileModeSelect.value = mode;
  updateMobileModelOptions();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    document.querySelector(".sidebar").classList.remove("open");
  }
}

// Sidebar Buttons
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchMode(btn.dataset.mode));
});

// Mobile Menu Toggle
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");
if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });
}

if (mobileModeSelect) {
  mobileModeSelect.addEventListener("change", (e) => {
    switchMode(e.target.value);
  });
}

const updateMobileModelOptions = () => {
  if (!mobileModelSelect) return;

  let options = [];
  if (currentMode === "chat") {
    options = Array.from(modelSelect.options).map(o => ({ value: o.value, text: o.text }));
    if (searchToggle && searchToggle.checked) {
      options.unshift({ value: "gemini-search", text: "Live Search AI" });
    }
  } else if (currentMode === "coding") {
    options = Array.from(codingModelSelect.options).map(o => ({ value: o.value, text: o.text }));
  } else if (currentMode === "image") {
    options = Array.from(imageModelSelect.options).map(o => ({ value: o.value, text: o.text }));
  } else if (currentMode === "video" || currentMode === "gif") {
    options = [{ value: "pollinations-any", text: "Standard Gen" }];
  }

  mobileModelSelect.innerHTML = options.map(o => `<option value="${o.value}">${o.text}</option>`).join('');

  // Set initial value to match sidebar
  if (currentMode === "chat") mobileModelSelect.value = modelSelect.value;
  else if (currentMode === "coding") mobileModelSelect.value = codingModelSelect.value;
  else if (currentMode === "image") mobileModelSelect.value = imageModelSelect.value;
};

if (mobileModelSelect) {
  mobileModelSelect.addEventListener("change", () => {
    if (currentMode === "chat") modelSelect.value = mobileModelSelect.value;
    else if (currentMode === "coding") codingModelSelect.value = mobileModelSelect.value;
    else if (currentMode === "image") imageModelSelect.value = mobileModelSelect.value;
  });
}

if (searchToggle) {
  searchToggle.addEventListener("change", updateMobileModelOptions);
}

// Sidebar selects also sync to mobile
modelSelect.addEventListener("change", () => { if (currentMode === "chat") mobileModelSelect.value = modelSelect.value; });
codingModelSelect.addEventListener("change", () => { if (currentMode === "coding") mobileModelSelect.value = codingModelSelect.value; });
imageModelSelect.addEventListener("change", () => { if (currentMode === "image") mobileModelSelect.value = imageModelSelect.value; });

/**
 * Games Tab Logic: AI or Not Detector
 */
let gamesInitialized = false;
function initGamesLogic() {
  if (gamesInitialized) return;
  gamesInitialized = true;

  const detTabBtns = document.querySelectorAll(".det-tab-btn");
  const detAreas = document.querySelectorAll(".det-area");
  const detCheckBtn = document.getElementById("det-check-btn");
  const detResult = document.getElementById("det-result");
  const dropZone = document.getElementById("drop-zone");
  const detImageInput = document.getElementById("det-image-input");
  const detTextInput = document.getElementById("det-text-input");

  // Overlay Elements
  const gameOverlay = document.getElementById("game-overlay");
  const gameIframe = document.getElementById("game-iframe");
  const overlayTitle = document.getElementById("overlay-title");
  const closeOverlayBtn = document.getElementById("close-overlay");
  const refreshOverlayBtn = document.getElementById("refresh-overlay");

  if (closeOverlayBtn) {
    closeOverlayBtn.addEventListener("click", () => {
      gameOverlay.style.display = "none";
      gameIframe.src = ""; // Stop the site when closing
    });
  }

  if (refreshOverlayBtn) {
    refreshOverlayBtn.addEventListener("click", () => {
      const currentSrc = gameIframe.src;
      gameIframe.src = ""; // Clear
      setTimeout(() => { gameIframe.src = currentSrc; }, 50); // Restore to trigger reload
    });
  }

  // Intercept all game links/buttons
  document.querySelectorAll(".game-card").forEach(card => {
    const title = card.querySelector("h3")?.textContent || "Game";
    const actionBtn = card.querySelector(".btn-game, a");

    if (actionBtn && !card.classList.contains("wide-card")) { // Don't intercept the AI or Not detector
      actionBtn.addEventListener("click", (e) => {
        // If it's a link, prevent default
        const url = actionBtn.getAttribute("href") || (actionBtn.onclick ? null : "");
        if (url || actionBtn.dataset.url) {
          e.preventDefault();
          const targetUrl = url || actionBtn.dataset.url;
          if (targetUrl) {
            overlayTitle.textContent = title;
            gameIframe.src = targetUrl;
            gameOverlay.style.display = "flex";
          }
        } else if (actionBtn.getAttribute("onclick")) {
          // Special case for ThisPersonDoesNotExist which might use onclick
          const match = actionBtn.getAttribute("onclick").match(/'([^']+)'/);
          if (match) {
            e.preventDefault();
            overlayTitle.textContent = title;
            gameIframe.src = match[1];
            gameOverlay.style.display = "flex";
          }
        }
      });
    }
  });

  let currentDetType = "image";
  let selectedFile = null;

  // Tab switching
  detTabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      currentDetType = btn.dataset.detType;
      detTabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      detAreas.forEach(area => area.style.display = "none");
      document.getElementById(`det-${currentDetType}-area`).style.display = "block";
      detResult.style.display = "none";
    });
  });

  // Drop zone events
  if (dropZone) {
    dropZone.addEventListener("click", () => detImageInput.click());
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        dropZone.querySelector("span").textContent = `Selected: ${selectedFile.name}`;
      }
    });
  }

  if (detImageInput) {
    detImageInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        selectedFile = e.target.files[0];
        dropZone.querySelector("span").textContent = `Selected: ${selectedFile.name}`;
      }
    });
  }

  // Check button logic
  if (detCheckBtn) {
    detCheckBtn.addEventListener("click", async () => {
      detResult.style.display = "block";
      detResult.className = "det-result";
      detResult.textContent = "Analyzing... 🕵️";

      try {
        let response;
        if (currentDetType === "image") {
          if (!selectedFile) throw new Error("Please select an image first.");

          const formData = new FormData();
          formData.append("image", selectedFile);

          response = await fetch("/api/aiornot", {
            method: "POST",
            body: formData
          });
        } else {
          const text = detTextInput.value.trim();
          if (text.length < 250) throw new Error("Text must be at least 250 characters.");

          response = await fetch("/api/aiornot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
          });
        }

        if (!response.ok) {
          const errData = await response.json();
          const detailStr = errData.details ? (errData.details.error?.message || JSON.stringify(errData.details)) : "";
          throw new Error(errData.error + (detailStr ? `: ${detailStr}` : ""));
        }

        const data = await response.json();
        const isAI = data.report?.is_ai || data.is_ai;
        const confidence = data.report?.confidence || data.confidence || 0;

        if (isAI) {
          detResult.classList.add("ai");
          detResult.textContent = `❌ AI Detected (${Math.round(confidence * 100)}% confidence)`;
        } else {
          detResult.classList.add("human");
          detResult.textContent = `✅ Likely Human (${Math.round((1 - confidence) * 100)}% confidence)`;
        }
      } catch (err) {
        detResult.style.display = "block";
        detResult.textContent = `Error: ${err.message}`;
      }
    });
  }
}

/**
 * UI: Fetch and update visitor count
 */
async function updateVisitorCount() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    const countEl = document.getElementById("visitor-count");
    if (countEl && data.count) {
      countEl.textContent = data.count.toLocaleString();
    }
  } catch (e) {
    console.warn("[Stats] Failed to fetch visitor count:", e);
  }
}

// Initializations
hljs.configure({ ignoreUnescapedHTML: true });
scrollToBottom(true);
switchMode("chat");
updateVisitorCount();