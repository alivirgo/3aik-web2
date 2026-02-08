// DOM Elements
const messagesEl = document.getElementById("messages");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send-btn");
const modeTitle = document.getElementById("mode-title");
const modeSubtitle = document.getElementById("mode-subtitle");
const imageModelSelect = document.getElementById("image-model-select");
const imageModelSection = document.getElementById("image-model-section");
const textModelSection = document.querySelector(".sidebar-section:not(#image-model-section)");
const closeModalBtn = document.getElementById("close-modal");
const navButtons = document.querySelectorAll(".nav-btn");

// State
let conversation = [];
let currentMode = "text";
let processing = false;

// Initialize
init();

function init() {
  setupEventListeners();
  updateModeUI();
  loadConversationHistory();
}

function setupEventListeners() {
  // Mode buttons
  navButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const mode = e.currentTarget.dataset.mode;
      setMode(mode);
    });
  });

  // Send button and input
  sendBtn.addEventListener("click", handleSend);
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Clear history
  clearBtn.addEventListener("click", clearHistory);

  // Settings
  settingsBtn.addEventListener("click", () => {
    settingsModal.style.display = "flex";
  });
  closeModalBtn.addEventListener("click", () => {
    settingsModal.style.display = "none";
  });

  // Image size selector
  imageSize.addEventListener("change", saveSettings);

  // Model selectors
  modelSelect.addEventListener("change", saveSettings);
  imageModelSelect.addEventListener("change", saveSettings);

  // Close modal on background click
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = "none";
    }
  });
}

function setMode(mode) {
  currentMode = mode;

  // Update nav buttons
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  updateModeUI();
}

if (currentMode === "image") {
  modeTitle.textContent = "Image Generation";
  modeSubtitle.textContent = "Create stunning images with AI";
  inputOptions.style.display = "flex";
  imageModelSection.style.display = "block";
  textModelSection.style.display = "none";
} else {
  modeTitle.textContent = "Chat";
  modeSubtitle.textContent = "Ask anything, get instant answers";
  inputOptions.style.display = "none";
  imageModelSection.style.display = "none";
  textModelSection.style.display = "block";
}
promptInput.focus();
}

function saveSettings() {
  localStorage.setItem("3aik-settings", JSON.stringify({
    imageSize: imageSize.value,
    textModel: modelSelect.value,
    imageModel: imageModelSelect.value
  }));
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
    addAssistantMessage("Conversation cleared. Start a new chat! 🚀");
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
  msgContent.innerHTML = sanitizeHTML(text);

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

  const textEl = document.createElement("div");
  textEl.className = "msg-text";
  textEl.innerHTML = sanitizeHTML(text);

  content.appendChild(textEl);
  el.appendChild(avatar);
  el.appendChild(content);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function addImageMessage(imageSrc, caption) {
  const el = document.createElement("div");
  el.className = "message assistant-msg";

  const avatar = document.createElement("div");
  avatar.className = "msg-avatar";
  avatar.textContent = "🎨";

  const content = document.createElement("div");
  content.className = "msg-content";

  const img = document.createElement("img");
  img.className = "msg-image";
  img.src = imageSrc;
  img.alt = caption;
  img.loading = "lazy";

  const captionEl = document.createElement("div");
  captionEl.className = "msg-subtext";
  captionEl.textContent = caption;

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "msg-download";
  downloadBtn.textContent = "⬇️ Download";
  downloadBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = imageSrc;
    a.download = `3aik-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  content.appendChild(img);
  content.appendChild(captionEl);
  content.appendChild(downloadBtn);
  el.appendChild(avatar);
  el.appendChild(content);
  messagesEl.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  setTimeout(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }, 50);
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
    if (currentMode === "image") {
      await generateImage(prompt);
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

async function generateImage(prompt) {
  const sizeVal = parseInt(imageSize.value || "1024", 10);

  try {
    console.log(`[Image Gen] Generating image with prompt: "${prompt}" (${sizeVal}x${sizeVal})`);

    const response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        width: sizeVal,
        height: sizeVal,
        model: imageModelSelect.value
      }),
    });

    console.log("[Image Gen] Response status:", response.status);

    const data = await response.json();
    console.log("[Image Gen] Response data keys:", Object.keys(data).join(", "));
    console.log("[Image Gen] Full response:", JSON.stringify(data).slice(0, 500));

    if (data.error) {
      throw new Error(data.error);
    }

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    // Try multiple response shapes
    const images = data.images || (data.image ? [data.image] : []);
    console.log("[Image Gen] Images array length:", images.length);

    if (!images || !Array.isArray(images) || images.length === 0) {
      console.error("[Image Gen] No images found. Response was:", data);
      throw new Error("No images returned by the backend. Check console for response structure.");
    }

    const img = data.images[0];
    console.log("[Image Gen] Image keys:", img ? Object.keys(img).join(", ") : "null");

    if (!img || !img.b64) {
      console.error("[Image Gen] Image data invalid:", img);
      throw new Error(`Image data missing (b64 field empty). Image keys: ${img ? Object.keys(img).join(", ") : "none"}`);
    }

    const imageSrc = `data:${img.mime || "image/png"};base64,${img.b64}`;
    console.log("[Image Gen] Image data URI created, length:", imageSrc.length);

    addImageMessage(imageSrc, prompt);
    conversation.push({
      role: "assistant",
      content: prompt,
      isImage: true,
      imageSrc,
      imageCaption: prompt,
    });
    console.log("[Image Gen] Image successfully added to conversation");
  } catch (error) {
    console.error("[Image Gen] Error:", error);
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
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation,
        model: modelSelect.value
      }),
    });

    console.log("[Chat] Response status:", response.status);

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.status} ${response.statusText}`);
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
            textEl.textContent = fullResponse;
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