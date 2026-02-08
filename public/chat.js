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
const mobileModelSelect = document.getElementById("mobile-model-select");
const loadingOverlay = document.getElementById("loading-overlay");

// Modals
const settingsModal = document.getElementById("settings-modal");
const settingsBtn = document.getElementById("settings-btn");
const closeSettingsBtn = document.getElementById("close-settings");
const saveSettingsBtn = document.getElementById("save-settings-btn");

// State
let conversation = [];
let currentMode = "text"; // text, image, video, gif, coding
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
function addMediaMessage(mediaSrc, caption, type = "image") {
  const el = document.createElement("div");
  el.className = "message assistant-msg";

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
  messagesEl.appendChild(el);

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
  loadingOverlay.style.display = "flex";

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
    addMediaMessage(mediaSrc, prompt, type);
  } catch (error) {
    console.error("[Media] Error:", error);
    addTextMessage("assistant", `⚠️ Failed to generate: ${error.message}`);
  } finally {
    loadingOverlay.style.display = "none";
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
  if (currentMode === "text" || currentMode === "coding") generateText();
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

// Mode Switches
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    document.getElementById("text-model-section").style.display = (currentMode === "text") ? "block" : "none";
    document.getElementById("coding-model-section").style.display = (currentMode === "coding") ? "block" : "none";
    document.getElementById("image-model-section").style.display = (currentMode === "image") ? "block" : "none";
    document.getElementById("video-model-section").style.display = (currentMode === "video") ? "block" : "none";
    document.getElementById("media-size-section").style.display = (currentMode === "image" || currentMode === "video" || currentMode === "gif") ? "block" : "none";

    if (window.innerWidth <= 768) {
      document.querySelector(".sidebar").classList.remove("open");
    }
  });
});

// Mobile Menu Toggle
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.querySelector(".sidebar");
if (menuToggle) {
  menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });
}

if (mobileModelSelect) {
  mobileModelSelect.addEventListener("change", () => {
    modelSelect.value = mobileModelSelect.value;
  });
}

// Initializations
hljs.configure({ ignoreUnescapedHTML: true });
scrollToBottom(true);