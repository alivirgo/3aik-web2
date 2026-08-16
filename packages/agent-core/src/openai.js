import { ApiError } from "./errors.js";
import { parseSseStream } from "./api.js";
import { normalizeToolCalls } from "./protocol.js";

function normalizeOpenAiBase(value) {
  let url;
  try { url = new URL(value); } catch (cause) {
    throw new ApiError("Local provider baseUrl must be a valid HTTP(S) URL.", { code: "invalid_api_base", cause });
  }
  if (!/^https?:$/.test(url.protocol)) throw new ApiError("Local provider baseUrl must use HTTP or HTTPS.", { code: "invalid_api_base" });
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function responseError(response) {
  let message = `${response.status} ${response.statusText || "local model request failed"}`.trim();
  try {
    const body = await response.json();
    message = body?.error?.message || body?.message || message;
  } catch { /* Non-JSON provider error. */ }
  return new ApiError(message, { status: response.status, code: "local_provider_error" });
}

function requestMessages(messages, systemPrompt) {
  const normalized = messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.tool_call_id, name: message.name, content: message.content };
    const output = { role: message.role, content: message.content || "" };
    if (message.tool_calls) output.tool_calls = message.tool_calls;
    return output;
  });
  return systemPrompt ? [{ role: "system", content: systemPrompt }, ...normalized] : normalized;
}

export class OpenAICompatibleClient {
  constructor({ baseUrl, model, apiKey = "", fetchImpl = globalThis.fetch, timeoutMs = 120_000, headers = {} } = {}) {
    if (typeof fetchImpl !== "function") throw new ApiError("A Fetch-compatible implementation is required.", { code: "missing_fetch" });
    this.baseUrl = normalizeOpenAiBase(baseUrl);
    this.model = model || "";
    this.apiKey = apiKey || "";
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.headers = { ...headers };
  }

  #headers(accept = "application/json") {
    return {
      "content-type": "application/json",
      accept,
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      ...this.headers,
    };
  }

  #requireModel() {
    if (!this.model) throw new ApiError("No local model is configured. Run `3aik models`, then `3aik config set model <id>`.", { code: "missing_model" });
  }

  async listModels({ signal } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/models`, {
        headers: this.#headers(),
        redirect: "error",
        signal: combinedSignal(signal, Math.min(this.timeoutMs, 20_000)),
      });
    } catch (cause) {
      throw new ApiError(`Could not reach the local model server at ${this.baseUrl}.`, { code: "network_error", cause });
    }
    if (!response.ok) throw await responseError(response);
    const body = await response.json();
    return Array.isArray(body?.data) ? body.data : [];
  }

  async health(options = {}) {
    const models = await this.listModels(options);
    return { status: "ready", service: "openai-compatible", models: models.map((model) => model.id).filter(Boolean) };
  }

  async *streamChat({ messages, systemPrompt = "", temperature = 0.25, maxTokens = 4_096, signal } = {}) {
    this.#requireModel();
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.#headers("text/event-stream, application/json"),
        body: JSON.stringify({
          model: this.model,
          messages: requestMessages(messages, systemPrompt),
          stream: true,
          temperature,
          max_tokens: maxTokens,
        }),
        redirect: "error",
        signal: combinedSignal(signal, this.timeoutMs),
      });
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new ApiError(`Could not reach the local model server at ${this.baseUrl}.`, { code: "network_error", cause });
    }
    if (!response.ok) throw await responseError(response);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/event-stream")) {
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ApiError("Local model returned an empty response.", { code: "empty_response" });
      yield content;
      return;
    }
    for await (const data of parseSseStream(response.body)) {
      if (data === "[DONE]") return;
      let body;
      try { body = JSON.parse(data); } catch { continue; }
      if (body?.error) throw new ApiError(body.error.message || String(body.error), { code: "local_provider_error" });
      const delta = body?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") yield delta;
    }
  }

  async chat(options) {
    let content = "";
    for await (const delta of this.streamChat(options)) content += delta;
    return content;
  }

  async agentTurn({ messages, tools, systemPrompt = "", maxTokens = 4_096, signal } = {}) {
    this.#requireModel();
    let response;
    const baseBody = {
      model: this.model,
      messages: requestMessages(messages, systemPrompt),
      stream: false,
      temperature: 0.2,
      max_tokens: maxTokens,
    };
    try {
      response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.#headers(),
        body: JSON.stringify({
          ...baseBody,
          tools,
          tool_choice: "auto",
        }),
        redirect: "error",
        signal: combinedSignal(signal, this.timeoutMs),
      });
      if ([400, 404, 422].includes(response.status) && tools?.length) {
        response = await this.fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: this.#headers(),
          body: JSON.stringify(baseBody),
          redirect: "error",
          signal: combinedSignal(signal, this.timeoutMs),
        });
      }
    } catch (cause) {
      if (cause?.name === "AbortError") throw cause;
      throw new ApiError(`Could not reach the local model server at ${this.baseUrl}.`, { code: "network_error", cause });
    }
    if (!response.ok) throw await responseError(response);
    const body = await response.json();
    const message = body?.choices?.[0]?.message;
    const calls = normalizeToolCalls(message?.tool_calls);
    if (calls.length) return { type: "tool_calls", calls, content: message?.content || "", model: body?.model || this.model };
    if (typeof message?.content !== "string" || !message.content) throw new ApiError("Local model returned neither text nor tool calls.", { code: "empty_response" });
    return { type: "message", content: message.content, model: body?.model || this.model };
  }
}

export { normalizeOpenAiBase };
