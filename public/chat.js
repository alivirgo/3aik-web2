const messagesEl = document.getElementById("messages");
const promptInput = document.getElementById("prompt-input");
const sendBtn = document.getElementById("send");
const imageModeBtn = document.getElementById("image-mode");
const textModeBtn = document.getElementById("text-mode");
const modelSelect = document.getElementById("model-select");
const newConvoBtn = document.getElementById("new-convo");
const imageSize = document.getElementById("image-size");

let conversation = [{ role: "assistant", content: "Welcome — try a prompt." }];
let mode = "text"; // or 'image'
let processing = false;

function setMode(m) {
  mode = m;
  if (m === "image") {
    imageModeBtn.classList.add("active");
    textModeBtn.classList.remove("active");
  } else {
    textModeBtn.classList.add("active");
    imageModeBtn.classList.remove("active");
  }
}

imageModeBtn.addEventListener("click", () => setMode("image"));
textModeBtn.addEventListener("click", () => setMode("text"));
newConvoBtn.addEventListener("click", () => {
  conversation = [];
  messagesEl.innerHTML = "";
  appendAssistant("New conversation started.");
});

sendBtn.addEventListener("click", () => {
  void onSend();
});

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void onSend();
  }
});

function appendUser(text) {
  const el = document.createElement("div");
  el.className = "msg user";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollBottom();
}

function appendAssistant(text) {
  const el = document.createElement("div");
  el.className = "msg assistant";
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollBottom();
}

function appendImage(b64, mime, caption) {
  const el = document.createElement("div");
  el.className = "msg assistant";
  const img = document.createElement("img");
  img.src = `data:${mime};base64,${b64}`;
  img.alt = caption || "generated image";
  el.appendChild(img);
  if (caption) {
    const c = document.createElement("div");
    c.style.opacity = "0.7";
    c.style.marginTop = "6px";
    c.textContent = caption;
    el.appendChild(c);
  }

  // download button
  const dl = document.createElement("button");
  dl.textContent = "Download";
  dl.style.marginTop = "8px";
  dl.style.padding = "6px 8px";
  dl.style.borderRadius = "6px";
  dl.style.border = "none";
  dl.style.cursor = "pointer";
  dl.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = img.src;
    a.download = "3aik-image.png";
    a.click();
  });
  el.appendChild(dl);

  messagesEl.appendChild(el);
  scrollBottom();
}

function scrollBottom() {
  setTimeout(() => (messagesEl.scrollTop = messagesEl.scrollHeight), 50);
}

async function onSend() {
  const prompt = promptInput.value.trim();
  if (!prompt || processing) return;
  processing = true;
  promptInput.disabled = true;
  sendBtn.disabled = true;

  appendUser(prompt);
  conversation.push({ role: "user", content: prompt });
  promptInput.value = "";

  try {
    if (mode === "image") {
      await generateImage(prompt);
    } else {
      await generateText();
    }
  } catch (e) {
    appendAssistant("Error: " + (e instanceof Error ? e.message : String(e)));
  } finally {
    processing = false;
    promptInput.disabled = false;
    sendBtn.disabled = false;
    promptInput.focus();
  }
}

async function generateImage(prompt) {
  const size = parseInt(imageSize.value || "1024", 10);
  const res = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size }),
  });
  if (!res.ok) {
    appendAssistant("Image generation failed.");
    return;
  }
  const data = await res.json();
  if (!Array.isArray(data.images) || !data.images.length) {
    appendAssistant("No image returned by backend.");
    return;
  }
  for (const img of data.images) {
    appendImage(img.b64, img.mime || "image/png", prompt);
  }
  conversation.push({ role: "assistant", content: `[Image generated: ${prompt}]` });
}

async function generateText() {
  const placeholder = document.createElement("div");
  placeholder.className = "msg assistant";
  const p = document.createElement("div");
  p.textContent = "...";
  placeholder.appendChild(p);
  messagesEl.appendChild(placeholder);
  scrollBottom();

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: conversation }),
  });

  if (!res.ok) {
    p.textContent = "No response from backend.";
    return;
  }

  if (!res.body) {
    p.textContent = await res.text();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parsed = parseSSE(buf);
    buf = parsed.buffer;
    for (const ev of parsed.events) {
      if (ev === "[DONE]") continue;
      try {
        const j = JSON.parse(ev);
        const delta = j.response || j.choices?.[0]?.delta?.content || j.content || "";
        if (delta) {
          full += delta;
          p.textContent = full;
          scrollBottom();
        }
      } catch (e) {
        // ignore parse
      }
    }
  }

  conversation.push({ role: "assistant", content: full });
}

function parseSSE(buffer) {
  const events = [];
  buffer = buffer.replace(/\r/g, "");
  let idx;
  while ((idx = buffer.indexOf("\n\n")) !== -1) {
    const raw = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const lines = raw.split("\n");
    const data = lines.filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    if (data.length) events.push(data.join("\n"));
  }
  return { events, buffer };
