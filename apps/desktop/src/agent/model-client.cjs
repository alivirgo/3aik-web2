'use strict';

const { normalizeAgentBaseUrl, normalizeLocalModelBaseUrl } = require('../main/security.cjs');

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function localEndpoint(baseUrl, suffix) {
  return `${baseUrl.replace(/\/$/, '')}/${suffix.replace(/^\//, '')}`;
}

async function readJsonResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Model service returned ${response.status} without valid JSON.`);
  }
  if (!response.ok) {
    const message = payload && (payload.error?.message || payload.error || payload.message);
    throw new Error(typeof message === 'string' ? message : `Model service returned ${response.status}.`);
  }
  return payload;
}

function parseToolArguments(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { _raw: value };
  }
}

function normalizeOpenAiResponse(payload) {
  const message = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
  if (!message) throw new Error('The local model returned no assistant message.');
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return {
      type: 'tool_calls',
      calls: message.tool_calls.map((call, index) => ({
        id: String(call.id || `local-call-${index + 1}`),
        name: String(call.function?.name || ''),
        arguments: parseToolArguments(call.function?.arguments)
      })),
      model: String(payload.model || 'local model')
    };
  }
  return {
    type: 'message',
    content: typeof message.content === 'string' ? message.content : '',
    model: String(payload.model || 'local model')
  };
}

function toOpenAiTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} }
    }
  }));
}

function createModelClient({ fetchImplementation = fetch } = {}) {
  async function request(config, request) {
    if (!config || config.provider === '3aik-cloud') {
      const baseUrl = normalizeAgentBaseUrl(config && config.agentBaseUrl);
      if (!baseUrl) throw new Error('Invalid 3aik Cloud base URL.');
      const timeout = withTimeout(45_000);
      try {
        const response = await fetchImplementation(localEndpoint(baseUrl, 'api/agent'), {
          method: 'POST',
          redirect: 'error',
          signal: timeout.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-3aik-device': config.deviceId
          },
          body: JSON.stringify(request)
        });
        return readJsonResponse(response);
      } finally {
        timeout.clear();
      }
    }

    if (config.provider !== 'openai-compatible') throw new Error('Unknown model provider.');
    const baseUrl = normalizeLocalModelBaseUrl(config.localBaseUrl);
    if (!baseUrl) throw new Error('Local model URL must resolve to localhost or a private network address.');
    const timeout = withTimeout(45_000);
    const messages = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push(...request.messages);
    const tools = toOpenAiTools(request.tools);
    const body = {
      model: config.localModel,
      messages,
      stream: false,
      max_tokens: request.maxTokens || 2048
    };
    if (tools.length) body.tools = tools;

    try {
      const response = await fetchImplementation(localEndpoint(baseUrl, 'chat/completions'), {
        method: 'POST',
        redirect: 'error',
        signal: timeout.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(config.localApiKey ? { Authorization: `Bearer ${config.localApiKey}` } : {})
        },
        body: JSON.stringify(body)
      });
      return normalizeOpenAiResponse(await readJsonResponse(response));
    } finally {
      timeout.clear();
    }
  }

  async function testConnection(config) {
    const startedAt = Date.now();
    const timeout = withTimeout(8_000);
    try {
      if (config.provider === '3aik-cloud') {
        const baseUrl = normalizeAgentBaseUrl(config.agentBaseUrl);
        if (!baseUrl) throw new Error('Invalid 3aik Cloud base URL.');
        const response = await fetchImplementation(localEndpoint(baseUrl, 'api/health'), {
          redirect: 'error',
          signal: timeout.signal,
          headers: { 'x-3aik-device': config.deviceId }
        });
        if (!response.ok) throw new Error(`3aik Cloud returned ${response.status}.`);
        return { ok: true, provider: '3aik-cloud', latencyMs: Date.now() - startedAt, models: [] };
      }

      const baseUrl = normalizeLocalModelBaseUrl(config.localBaseUrl);
      if (!baseUrl) throw new Error('Local model URL must resolve to localhost or a private network address.');
      const response = await fetchImplementation(localEndpoint(baseUrl, 'models'), {
        redirect: 'error',
        signal: timeout.signal,
        headers: config.localApiKey ? { Authorization: `Bearer ${config.localApiKey}` } : {}
      });
      const payload = await readJsonResponse(response);
      const models = Array.isArray(payload.data)
        ? payload.data.map((model) => String(model.id || '')).filter(Boolean).slice(0, 20)
        : [];
      return {
        ok: true,
        provider: 'openai-compatible',
        latencyMs: Date.now() - startedAt,
        models
      };
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Connection timed out after 8 seconds.');
      throw error;
    } finally {
      timeout.clear();
    }
  }

  return { request, testConnection };
}

module.exports = {
  createModelClient,
  localEndpoint,
  normalizeOpenAiResponse,
  toOpenAiTools
};
