// DOM Elements
const messagesEl = document.getElementById("messages");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const modeTitle = document.getElementById("mode-title");
const modeSubtitle = document.getElementById("mode-subtitle");
const modelSelect = document.getElementById("model-select");
const clearBtn = document.getElementById("clear-btn");
const imageSize = document.getElementById("image-size");
const inputOptions = document.getElementById("input-options");
const loadingIndicator = document.getElementById("loading");
const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const imageModelSelect = document.getElementById("image-model-select");
const imageModelSection = document.getElementById("image-model-section");
const videoModelSection = document.getElementById("video-model-section");
const gifModelSection = document.getElementById("gif-model-section");
const codingModelSection = document.getElementById("coding-model-section");
const videoModelSelect = document.getElementById("video-model-select");
const gifModelSelect = document.getElementById("gif-model-select");
const codingModelSelect = document.getElementById("coding-model-select");
const modelSeoInfo = document.getElementById("model-seo-info");
const textModelSection = document.getElementById("text-model-section");
const closeModalBtn = document.getElementById("close-modal");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const systemPromptInput = document.getElementById("system-prompt");
const temperatureInput = document.getElementById("temperature");
const tempValueDisplay = document.getElementById("temp-value");
const maxTokensInput = document.getElementById("max-tokens");
const autoScrollCheck = document.getElementById("auto-scroll-check");
const navButtons = document.querySelectorAll(".nav-btn");

// State
let conversation = [];
let currentMode = "text";
let processing = false;

// SEO Model Descriptions
const MODEL_INFO = {
  // Chat Models
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "Llama 3.3 70B: High-performance Meta AI model for logical reasoning and fast chat responses.",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": "DeepSeek R1 32B: Specialized reasoning model with advanced chain-of-thought capabilities.",
  "@cf/meta/llama-3.1-8b-instruct": "Llama 3.1 8B: Meta's versatile AI assistant for creative writing and daily tasks.",
  "@cf/meta/llama-3.2-3b-instruct": "Llama 3.2 3B: Lightweight and efficient AI for mobile-friendly quick chat interactions.",
  "@cf/qwen/qwen2.5-coder-32b-instruct": "Qwen 2.5 Coder: Powerful Alibaba AI optimized for programming and technical analysis.",
  "@cf/openai/gpt-oss-120b": "GPT OSS 120B: Ultra-large parameter model for complex creative and analytical text generation.",

  // Coding Models
  "@cf/deepseek-ai/deepseek-coder-33b-instruct": "DeepSeek Coder: State-of-the-art AI for bug fixing, code optimization, and software development.",

  // Image Models
  "pollinations-flux": "Flux Pro AI: Generation of ultra-realistic 4K high-definition images with precision detail.",
  "pollinations-any": "Anime AI: specialized Stable Diffusion model for high-quality anime and digital art styles.",
  "pollinations-dream": "Dream Artist: Artistic AI model for creating stylized, imaginative, and surreal masterpieces.",
  "@cf/bytedance/sdxl-lightning": "SDXL Lightning: Zero-latency high-speed image generator powered by Bytedance AI tech.",
  "@cf/black-forest-labs/flux-1-schnell": "Flux Schnell: Efficient high-fidelity image generation for rapid creative prototyping.",
  "@cf/leonardoai/phoenix-1.0": "Phoenix 1.0: Advanced AI for cinematic lighting and high-contrast professional photography.",

  // Video & GIF
  "video-seedance": "Seedance AI Video: Transform text into 10-second high-motion cinematic video clips instantly.",
  "video-veo": "Google Veo: Next-gen video generation for high-consistency character and scene movements.",
  "gif-animate": "AI GIF Maker: Create looping animated memes and digital reaction GIFs from text descriptions."
};

// Configure Markdown
marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

function updateModelSEOInfo() {
  if (!modelSeoInfo) return;

  let selectedModel = (modelSelect && modelSelect.value) || "";
  if (currentMode === "image" && imageModelSelect) selectedModel = imageModelSelect.value;
  if (currentMode === "video" && videoModelSelect) selectedModel = videoModelSelect.value;
  if (currentMode === "gif" && gifModelSelect) selectedModel = gifModelSelect.value;
  if (currentMode === "coding" && codingModelSelect) selectedModel = codingModelSelect.value;

  const info = MODEL_INFO[selectedModel] || "3aikGPT: Advanced AI Studio for text, image, video, and code generation.";
  modelSeoInfo.textContent = info;
  modelSeoInfo.style.animation = "none";
  modelSeoInfo.offsetHeight; // trigger reflow
  modelSeoInfo.style.animation = "fadeIn 0.5s ease";
}

function init() {
  try {
    loadSettings();
    setupEventListeners();
    updateModeUI();
    updateModelSEOInfo();
    loadConversationHistory();
  } catch (err) {
    console.error("Initialization failed:", err);
    // Safe attempt to show error to user
    const errorBanner = document.createElement("div");
    errorBanner.style.cssText = "position:fixed;top:0;left:0;width:100%;background:red;color:white;padding:10px;z-index:9999;text-align:center;font-size:12px;";
    errorBanner.textContent = "Application Error: Please check console or contact support. " + err.message;
    document.body.appendChild(errorBanner);
  }
}

function setupEventListeners() {
  // Mode buttons
  if (navButtons) {
    navButtons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const mode = e.currentTarget.dataset.mode;
        setMode(mode);
      });
    });
  }

  // Send button and input
  if (sendBtn) sendBtn.addEventListener("click", handleSend);
  if (promptInput) {
    promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
  }

  // Clear history
  if (clearBtn) clearBtn.addEventListener("click", clearHistory);

  // Settings
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      if (settingsModal) settingsModal.style.display = "flex";
    });
  }
  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
      if (settingsModal) settingsModal.style.display = "none";
    });
  }

  // Image size selector
  if (imageSize) imageSize.addEventListener("change", saveSettings);

  // Model selectors
  const selectors = [
    { el: modelSelect, trigger: true },
    { el: imageModelSelect, trigger: true },
    { el: videoModelSelect, trigger: true },
    { el: gifModelSelect, trigger: true },
    { el: codingModelSelect, trigger: true }
  ];

  selectors.forEach(sel => {
    if (sel.el) {
      sel.el.addEventListener("change", () => {
        saveSettings();
        if (sel.trigger) updateModelSEOInfo();
      });
    }
  });

  // Settings modal controls
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      saveSettings();
      if (settingsModal) settingsModal.style.display = "none";
    });
  }

  if (temperatureInput) {
    temperatureInput.addEventListener("input", (e) => {
      if (tempValueDisplay) tempValueDisplay.textContent = e.target.value;
    });
  }

  // Close modal on background click
  if (settingsModal) {
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = "none";
      }
    });
  }
}

function setMode(mode) {
  currentMode = mode;

  // Update nav buttons
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  updateModeUI();
  updateModelSEOInfo();
}

function updateModeUI() {
  const allSections = [textModelSection, imageModelSection, videoModelSection, gifModelSection, codingModelSection];
  allSections.forEach(s => {
    if (s) s.style.display = "none";
  });
  if (inputOptions) inputOptions.style.display = "none";

  if (currentMode === "image") {
    modeTitle.textContent = "Image Generation";
    modeSubtitle.textContent = "Create stunning images with AI";
    inputOptions.style.display = "flex";
    imageModelSection.style.display = "block";
  } else if (currentMode === "video") {
    modeTitle.textContent = "Video Generation";
    modeSubtitle.textContent = "Generate short AI video clips";
    inputOptions.style.display = "flex";
    videoModelSection.style.display = "block";
  } else if (currentMode === "gif") {
    modeTitle.textContent = "GIF Generation";
    modeSubtitle.textContent = "Create animated AI GIFs";
    inputOptions.style.display = "flex";
    gifModelSection.style.display = "block";
  } else if (currentMode === "coding") {
    modeTitle.textContent = "AI Coding";
    modeSubtitle.textContent = "Expert code generation and debugging";
    codingModelSection.style.display = "block";
  } else {
    modeTitle.textContent = "Chat";
    modeSubtitle.textContent = "Ask anything, get instant answers";
    textModelSection.style.display = "block";
  }
  promptInput.focus();
}

function saveSettings() {
  const settings = {
    imageSize: imageSize.value,
    textModel: modelSelect.value,
    imageModel: imageModelSelect.value,
    videoModel: videoModelSelect.value,
    gifModel: gifModelSelect.value,
    codingModel: codingModelSelect.value,
    systemPrompt: systemPromptInput.value,
    temperature: temperatureInput.value,
    maxTokens: maxTokensInput.value,
    autoScroll: autoScrollCheck.checked
  };
  localStorage.setItem("3aik-settings", JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem("3aik-settings");
  if (saved) {
    const settings = JSON.parse(saved);
    if (settings.imageSize) imageSize.value = settings.imageSize;
    if (settings.textModel) modelSelect.value = settings.textModel;
    if (settings.imageModel) imageModelSelect.value = settings.imageModel;
    if (settings.videoModel) videoModelSelect.value = settings.videoModel;
    if (settings.gifModel) gifModelSelect.value = settings.gifModel;
    if (settings.codingModel) codingModelSelect.value = settings.codingModel;
    if (settings.systemPrompt) systemPromptInput.value = settings.systemPrompt;
    if (settings.temperature) {
      temperatureInput.value = settings.temperature;
      tempValueDisplay.textContent = settings.temperature;
    }
    if (settings.maxTokens) maxTokensInput.value = settings.maxTokens;
    if (settings.autoScroll !== undefined) autoScrollCheck.checked = settings.autoScroll;
  }
}

function loadConversationHistory() {
  const saved = localStorage.getItem("3aik-conversation");
  if (saved) {
    conversation = JSON.parse(saved);
    renderMessages();
  }
}

function saveConversationHistory() {
  localStorage.setItem("3aik-conversation", JSON.stringify(conversation));
}

function clearHistory() {
  if (confirm("Clear all conversation history? This cannot be undone.")) {
    conversation = [];
    messagesEl.innerHTML = "";
    addAssistantMessage("History cleared. Hello. I can generate text and images. Start image prompts with image:");
    saveConversationHistory();
  }
}

function renderMessages() {
  messagesEl.innerHTML = "";
  conversation.forEach((msg) => {
    if (msg.role === "user") {
      addUserMessage(msg.content);
    } else if (msg.role === "assistant") {
      if (msg.isImage) {
        addImageMessage(msg.imageSrc, msg.imageCaption);
      } else {
        addAssistantMessage(msg.content);
      }
    }
  });
  scrollToBottom();
}

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "message user-msg";

  const msgContent = document.createElement("div");
  msgContent.className = "msg-content";
  msgContent.innerHTML = marked.parse(text);

  el.appendChild(msgContent);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addAssistantMessage(text) {
  const el = document.createElement("div");
  el.className = "message assistant-msg";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "🤖";

  const content = document.createElement("div");
  content.className = "msg-content";

  // Check for reasoning blocks <think>...</think>
  const reasoningMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (reasoningMatch) {
    const reasoning = reasoningMatch[1].trim();
    const cleanText = text.replace(/<think>[\s\S]*?<\/think>/, "").trim();

    const reasoningEl = document.createElement("div");
    reasoningEl.className = "reasoning-block collapsed";

    const header = document.createElement("div");
    header.className = "reasoning-header";
    header.textContent = "Thought Process";
    header.onclick = () => reasoningEl.classList.toggle("collapsed");

    const reasoningContent = document.createElement("div");
    reasoningContent.className = "reasoning-content";
    reasoningContent.innerHTML = marked.parse(reasoning);

    reasoningEl.appendChild(header);
    reasoningEl.appendChild(reasoningContent);
    content.appendChild(reasoningEl);

    text = cleanText;
  }

  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  textEl.innerHTML = marked.parse(text);

  content.appendChild(textEl);
  el.appendChild(avatar);
  el.appendChild(content);
  messagesEl.appendChild(el);
  scrollToBottom();
}

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
    mediaEl.src = mediaSrc;
    mediaEl.controls = true;
    mediaEl.autoplay = true;
    mediaEl.loop = true;
    mediaEl.muted = true;
  } else {
    mediaEl = document.createElement("img");
    mediaEl.className = "msg-image";
    mediaEl.src = mediaSrc;
    mediaEl.alt = caption;
    mediaEl.loading = "lazy";
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
  scrollToBottom();
}

function scrollToBottom() {
  if (autoScrollCheck && autoScrollCheck.checked) {
    setTimeout(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 50);
  }
}

function sanitizeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setLoading(isLoading) {
  loadingIndicator.style.display = isLoading ? "flex" : "none";
  sendBtn.disabled = isLoading;
  promptInput.disabled = isLoading;
}

async function handleSend() {
  const prompt = promptInput.value.trim();
  if (!prompt || processing) return;

  processing = true;
  setLoading(true);

  // Add user message immediately
  addUserMessage(prompt);
  conversation.push({ role: "user", content: prompt });

  promptInput.value = "";
  promptInput.focus();

  try {
    if (["image", "video", "gif"].includes(currentMode) || prompt.toLowerCase().startsWith("image:")) {
      let cleanPrompt = prompt;
      if (prompt.toLowerCase().startsWith("image:")) {
        cleanPrompt = prompt.slice(6).trim();
        if (currentMode !== "image") setMode("image");
      }

      if (!cleanPrompt) throw new Error("Please provide a prompt");
      await generateMedia(cleanPrompt);
    } else {
      await generateText(prompt);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    addAssistantMessage(`❌ Error: ${errorMsg}`);
    conversation.push({ role: "assistant", content: `❌ Error: ${errorMsg}` });
  } finally {
    processing = false;
    setLoading(false);
    saveConversationHistory();
  }
}

async function generateMedia(prompt) {
  const sizeVal = parseInt(imageSize.value || "1024", 10);
  let modelToUse = imageModelSelect.value;
  if (currentMode === "video") modelToUse = videoModelSelect.value;
  if (currentMode === "gif") modelToUse = gifModelSelect.value;

  try {
    console.log(`[Media Gen] Generating ${currentMode} with prompt: "${prompt}"`);

    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        width: sizeVal,
        height: sizeVal,
        model: modelToUse
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);
    if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);

    const mediaList = data.images || [];
    if (mediaList.length === 0) throw new Error("No media returned by the backend.");

    const media = mediaList[0];
    if (!media || !media.b64) throw new Error("Media data missing (b64 field empty).");

    const mediaSrc = `data:${media.mime || "image/png"};base64,${media.b64}`;
    const type = currentMode === "video" ? "video" : (currentMode === "gif" ? "gif" : "image");

    addMediaMessage(mediaSrc, prompt, type);
    conversation.push({
      role: "assistant",
      content: prompt,
      isImage: true,
      imageSrc: mediaSrc,
      imageCaption: prompt,
      mediaType: type
    });
  } catch (error) {
    console.error("[Media Gen] Error:", error);
    throw error;
  }
}

async function generateText(prompt) {
  // Add placeholder message for assistant response
  const placeholderId = `msg-${Date.now()}`;
  const placeholder = document.createElement("div");
  placeholder.id = placeholderId;
  placeholder.className = "message assistant-msg";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "🤖";

  const content = document.createElement("div");
  content.className = "msg-content";

  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  textEl.textContent = "Thinking...";

  content.appendChild(textEl);
  placeholder.appendChild(avatar);
  placeholder.appendChild(content);
  messagesEl.appendChild(placeholder);
  scrollToBottom();

  try {
    const isCoding = currentMode === "coding";
    const selectedModel = isCoding ? codingModelSelect.value : modelSelect.value;
    const systemPrompt = isCoding
      ? (systemPromptInput.value || "You are an expert software engineer. Provide high-quality, efficient, and well-documented code. Always use markdown for code blocks.")
      : systemPromptInput.value;

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation,
        model: selectedModel,
        systemPrompt: systemPrompt,
        temperature: parseFloat(temperatureInput.value),
        max_tokens: parseInt(maxTokensInput.value, 10)
      }),
    });

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errJson = await response.json();
        errorDetail = errJson.error || errJson.message || "";
      } catch (e) {
        errorDetail = await response.text();
      }
      throw new Error(errorDetail || `Chat failed: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      const text = await response.text();
      throw new Error(text || "No response from backend");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullResponse = "";
    let eventCount = 0;

    // Update placeholder with streaming text
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSSE(buffer);
      buffer = parsed.buffer;

      for (const event of parsed.events) {
        eventCount++;
        if (event === "[DONE]") continue;

        try {
          const json = JSON.parse(event);
          const delta =
            json.response ||
            json.choices?.[0]?.delta?.content ||
            json.content ||
            "";

          if (delta) {
            fullResponse += delta;

            // Check for reasoning during stream
            let displayResponse = fullResponse;
            const rtMatch = fullResponse.match(/<think>([\s\S]*?)<\/think>/);
            if (rtMatch) {
              displayResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/, "").trim() || "Thinking complete. Generating response...";
            } else if (fullResponse.includes("<think>")) {
              displayResponse = "Thinking...";
            }

            textEl.innerHTML = marked.parse(displayResponse);
            scrollToBottom();
          }
        } catch (e) {
          console.warn("[Chat] Failed to parse event:", e, "Event:", event.slice(0, 100));
        }
      }
    }

    console.log(`[Chat] Received ${eventCount} events, final response length: ${fullResponse.length}`);

    // If no response received at all, show error
    if (!fullResponse || fullResponse.length === 0) {
      textEl.textContent = "⚠️ No response received from the model. This may mean the model is not properly configured in your Cloudflare account.";
    } else {
      conversation.push({ role: "assistant", content: fullResponse });
    }
  } catch (error) {
    console.error("[Chat] Error:", error);
    textEl.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

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

    if (data.length) {
      events.push(data.join("\n"));
    }
  }

  return { events, buffer };
}