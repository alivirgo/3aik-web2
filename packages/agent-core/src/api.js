import { ApiError } from "./errors.js";
import { normalizeToolCalls } from "./protocol.js";

const DEFAULT_API_BASE = "https://3aik.com";

function normalizeBase(value) {
  let url;
  try { url = new URL(value || DEFAULT_API_BASE); } catch (cause) {
    throw new ApiError("API base must be a valid HTTP(S) URL.", { code: "invalid_api_base", cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError("API base must use HTTP or HTTPS.", { code: "invalid_api_base" });
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function errorFromResponse(response) {
  let message = `${response.status} ${response.statusText || "request failed"}`.trim();
  let code = "api_error";
  try {
    const payload = await response.json();
    message = payload?.error?.message || payload?.message || message;
    code = payload?.error?.code || payload?.code || code;
  } catch { /* The response was not JSON. */ }
  return new ApiError(message, { status: response.status, code });
}

function extractDelta(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.delta === "string") return value.delta;
  if (typeof value.response === "string") return value.response;
  if (typeof value.content === "string") return value.content;
  return value.choices?.[0]?.delta?.content || value.choices?.[0]?.message?.content || "";
}

export async function* parseSseStream(stream) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = function* (flush = false) {
    const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const events = normalized.split("\n\n");
    buffer = flush ? "" : events.pop() || "";
    if (flush && events.at(-1) !== "") events.push("");
    for (const event of events) {
      const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data) yield data;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      if (done) break;
      yield* consume(false);
    }
    yield* consume(true);
  } finally {
    reader.releaseLock();
  }
}

function messagesForChat(messages) {
  return messages.flatMap((message) => {
    if (message.role === "user" || message.role === "assistant") {
      const content = typeof message.content === "string" && message.content.trim()
        ? message.content
        : message.tool_calls?.length
          ? message.tool_calls.map((call) => `\`\`\`3aik-tool\n${JSON.stringify({
              id: call.id,
              name: call.name || call.function?.name,
              arguments: call.arguments ?? call.function?.arguments,
            })}\n\`\`\``).join("\n")
          : "[continued]";
      return [{ role: message.role, content: content.slice(0, 12_000) }];
    }
    if (message.role === "tool") {
      return [{ role: "user", content: `LOCAL TOOL RESULT (${message.name}, id ${message.tool_call_id}):\n${message.content}`.slice(0, 12_000) }];
    }
    return [];
  }).slice(-24);
}

export class ThreeAikClient {
  constructor({ apiBase = DEFAULT_API_BASE, fetchImpl = globalThis.fetch, timeoutMs = 120_000, headers = {} } = {}) {
    if (typeof fetchImpl !== "function") throw new ApiError("A Fetch-compatible implementation is required.", { code: "missing_fetch" });
    this.apiBase = normalizeBase(apiBase);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.headers = { ...headers };
  }

  async health({ signal } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.apiBase}/api/health`, {
        headers: { accept: "application/json", ...this.headers },
        redirect: "error",
        signal: requestSignal(signal, Math.min(this.timeoutMs, 20_000)),
      });
    } catch (cause) {
      throw new ApiError(`Could not reach ${this.apiBase}.`, { code: "network_error", cause });
    }
    if (!response.ok) throw await errorFromResponse(response);
    return response.json();
  }

  async *streamChat({ messages, mode = "code", systemPrompt = "", temperature, maxTokens = 4_096, signal } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.apiBase}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream, application/json", ...this.headers },
        body: JSON.stringify({ messages, mode, systemPrompt, temperature, maxTokens }),
        redirect: "error",
        signal: requestSignal(signal, this.timeoutMs),
      });
    } catch (cause) {
      if (cause?.name === "TimeoutError") throw new ApiError("The API request timed out.", { code: "timeout", cause });
      if (cause?.name === "AbortError") throw cause;
      throw new ApiError(`Could not reach ${this.apiBase}.`, { code: "network_error", cause });
    }
    if (!response.ok) throw await errorFromResponse(response);

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      for await (const data of parseSseStream(response.body)) {
        if (data === "[DONE]") return;
        try {
          const value = JSON.parse(data);
          const delta = extractDelta(value);
          if (delta) yield delta;
          if (value?.error) throw new ApiError(value.error.message || String(value.error), { code: value.error.code || "stream_error" });
        } catch (error) {
          if (error instanceof ApiError) throw error;
          // Heartbeats and provider-specific non-JSON events are ignored.
        }
      }
      return;
    }

    let value;
    try { value = await response.json(); } catch (cause) {
      throw new ApiError("The API returned an unreadable response.", { code: "invalid_response", cause });
    }
    const content = extractDelta(value);
    if (!content) throw new ApiError("The API returned an empty response.", { code: "empty_response" });
    yield content;
  }

  async chat(options) {
    let content = "";
    for await (const delta of this.streamChat(options)) content += delta;
    return content;
  }

  async agentTurn({ messages, tools, systemPrompt, maxTokens = 4_096, signal, fallback = true } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.apiBase}/api/agent`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...this.headers },
        body: JSON.stringify({ messages, tools, systemPrompt, maxTokens }),
        redirect: "error",
        signal: requestSignal(signal, this.timeoutMs),
      });
    } catch (cause) {
      if (cause?.name === "TimeoutError") throw new ApiError("The agent request timed out.", { code: "timeout", cause });
      if (cause?.name === "AbortError") throw cause;
      throw new ApiError(`Could not reach ${this.apiBase}.`, { code: "network_error", cause });
    }

    if ((response.status === 404 || response.status === 405 || response.status === 501) && fallback) {
      const content = await this.chat({ messages: messagesForChat(messages), mode: "code", systemPrompt, maxTokens, signal });
      return { type: "message", content, model: "code-fallback", fallback: true };
    }
    if (!response.ok) throw await errorFromResponse(response);

    let value;
    try { value = await response.json(); } catch (cause) {
      throw new ApiError("The agent API returned invalid JSON.", { code: "invalid_response", cause });
    }
    if (value?.type === "tool_calls" || Array.isArray(value?.calls) || Array.isArray(value?.tool_calls)) {
      return { type: "tool_calls", calls: normalizeToolCalls(value.calls || value.tool_calls), content: value.content || "", model: value.model };
    }
    const content = typeof value?.content === "string" ? value.content : extractDelta(value);
    if (!content) throw new ApiError("The agent API returned neither text nor tool calls.", { code: "empty_response" });
    return { type: "message", content, model: value.model };
  }
}

export { DEFAULT_API_BASE, extractDelta, normalizeBase };
