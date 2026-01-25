/**
 * 3aikGPT Frontend Logic
 * Bulletproof image handling + debug visibility
 */

const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

let chatHistory = [
  {
    role: "assistant",
    content:
      "Hello. I can generate text and images. Start image prompts with `image:`.",
  },
];

let isProcessing = false;

function isImagePrompt(text) {
  return text.trim().toLowerCase().startsWith("image:");
}

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = userInput.scrollHeight + "px";
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || isProcessing) return;

  const imageMode = isImagePrompt(message);

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;

  addTextMessage("user", message);
  userInput.value = "";
  userInput.style.height = "auto";

  typingIndicator.classList.add("visible");
  chatHistory.push({ role: "user", content: message });

  try {
    if (imageMode) {
      await handleImageGeneration(message);
    } else {
      await handleTextGeneration();
    }
  } catch (error) {
    // Show full backend error JSON in chat
    addDebugMessage(error);
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    userInput.focus();
  }
}

/* ================= IMAGE HANDLING ================= */

async function handleImageGeneration(message) {
  const prompt = message.replace(/^image:\s*/i, "");

  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    addDebugMessage({ error: "Invalid JSON response from backend" });
    throw err;
  }

  // If backend returned an error, show it in chat
  if (!res.ok || data.error) {
    addDebugMessage(data);
    throw new Error(data.error || "Image generation failed");
  }

  let imageSrc = null;

  // Known formats
  if (Array.isArray(data.images) && data.images[0]) {
    imageSrc = `data:image/png;base64,${data.images[0]}`;
  } else if (data.image) {
    imageSrc = `data:image/png;base64,${data.image}`;
  } else if (data.output?.image) {
    imageSrc = `data:image/png;base64,${data.output.image}`;
  } else if (data.data?.[0]?.b64_json) {
    imageSrc = `data:image/png;base64,${data.data[0].b64_json}`;
  } else if (data.data?.[0]?.url) {
    imageSrc = data.data[0].url;
  }

  if (!imageSrc) {
    addDebugMessage(data);
    throw new Error("No usable image returned by backend");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "message assistant-message";

  const img = document.createElement("img");
  img.src = imageSrc;
  img.alt = prompt;
  img.loading = "lazy";

  const caption = document.createElement("div");
  caption.className = "image-caption";
  caption.textContent = prompt;

  wrapper.appendChild(img);
  wrapper.appendChild(caption);
  chatMessages.appendChild(wrapper);

  scrollToBottom();

  chatHistory.push({
    role: "assistant",
    content: `[Image generated: ${prompt}]`,
  });
}

/* ================= TEXT HANDLING ================= */

async function handleTextGeneration() {
  const msgEl = document.createElement("div");
  msgEl.className = "message assistant-message";
  const p = document.createElement("p");
  msgEl.appendChild(p);
  chatMessages.appendChild(msgEl);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: chatHistory }),
  });

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = consumeSseEvents(buffer);
    buffer = parsed.buffer;

    for (const event of parsed.events) {
      if (event === "[DONE]") continue;
      try {
        const json = JSON.parse(event);
        const delta =
          json.response ||
          json.choices?.[0]?.delta?.content ||
          json.content ||
          "";

        if (delta) {
          fullText += delta;
          p.textContent = fullText;
          scrollToBottom();
        }
      } catch {}
    }
  }

  if (fullText) {
    chatHistory.push({ role: "assistant", content: fullText });
  }
}

/* ================= DEBUG HELPERS ================= */

function addDebugMessage(data) {
  const el = document.createElement("div");
  el.className = "message assistant-message";
  el.innerHTML = `<strong>Backend Response / Error:</strong>\n<pre>${JSON.stringify(
    data,
    null,
    2
  )}</pre>`;
  chatMessages.appendChild(el);
  scrollToBottom();
}

function addTextMessage(role, text) {
  const el = document.createElement("div");
  el.className = `message ${role}-message`;
  el.textContent = text;
  chatMessages.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() {
  setTimeout(() => {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }, 30);
}

function consumeSseEvents(buffer) {
  const events = [];
  let index;

  buffer = buffer.replace(/\r/g, "");

  while ((index = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);

    const lines = raw.split("\n");
    const data = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());

    if (data.length) events.push(data.join("\n"));
  }

  return { events, buffer };
}