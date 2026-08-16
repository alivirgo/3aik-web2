import path from "node:path";
import { AgentError } from "./errors.js";
import {
  FALLBACK_AGENT_PROMPT,
  formatToolError,
  formatToolResult,
  parseToolEnvelopes,
} from "./protocol.js";
import { TOOL_DEFINITIONS } from "./workspace.js";

const MUTATING_TOOLS = new Set(["write_file", "apply_patch", "run_command"]);

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

function compactMessages(messages, maxChars = 52_000, maxMessages = 60) {
  if (JSON.stringify(messages).length <= maxChars && messages.length <= maxMessages) return messages;
  const groups = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    if (message.role === "tool") {
      // Never retain an already-orphaned tool result.
      index += 1;
      continue;
    }
    const group = [message];
    index += 1;
    if (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const ids = new Set(message.tool_calls.map((call) => call.id));
      while (index < messages.length && messages[index].role === "tool" && ids.has(messages[index].tool_call_id)) {
        group.push(messages[index]);
        index += 1;
      }
    }
    groups.push(group);
  }
  if (!groups.length) return [];

  const first = groups[0][0]?.role === "user" ? groups.shift() : [];
  const summary = { role: "user", content: "Earlier complete exchanges were compacted locally. Re-inspect anything needed before acting." };
  const tail = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const candidate = [...first, summary, ...groups[index], ...tail];
    if (JSON.stringify(candidate).length > maxChars || candidate.length > maxMessages) {
      if (!tail.length) throw new AgentError("Most recent complete exchange exceeds the API context limit.", { code: "context_too_large" });
      break;
    }
    tail.unshift(...groups[index]);
  }
  const compacted = [...first, summary, ...tail];
  if (JSON.stringify(compacted).length > maxChars || compacted.length > maxMessages) {
    throw new AgentError("Conversation cannot be compacted below the API context limit.", { code: "context_too_large" });
  }
  return compacted;
}

function openAiToolCalls(calls) {
  return calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
  }));
}

function uniqueCallIds(calls, messages, iteration) {
  const used = new Set(messages.flatMap((message) => (message.tool_calls || []).map((call) => call.id)));
  return calls.map((call, index) => {
    const original = String(call.id || `call-${iteration}-${index + 1}`).slice(0, 160);
    let id = original;
    let suffix = 1;
    while (used.has(id)) {
      id = `${original.slice(0, 150)}-${iteration}-${index + 1}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { ...call, id };
  });
}

function systemPromptFor(workspace, extra = "") {
  const workspaceName = path.basename(workspace.root);
  const suffix = extra ? `\nProject instructions:\n${String(extra).trim()}` : "";
  return `${FALLBACK_AGENT_PROMPT}\nWorkspace: ${workspaceName}.${suffix}`.slice(0, 1_980);
}

export class CodingAgent {
  constructor({ client, workspace, maxIterations = 12, maxToolCallsPerTurn = 8, maxTokens = 4_096, systemPrompt = "" } = {}) {
    if (!client) throw new AgentError("CodingAgent requires an API client.", { code: "missing_client" });
    if (!workspace) throw new AgentError("CodingAgent requires a local workspace.", { code: "missing_workspace" });
    this.client = client;
    this.workspace = workspace;
    this.maxIterations = Math.max(1, Math.min(40, maxIterations));
    this.maxToolCallsPerTurn = Math.max(1, Math.min(16, maxToolCallsPerTurn));
    this.maxTokens = Math.max(256, Math.min(8_192, maxTokens));
    this.systemPrompt = systemPrompt;
  }

  async run(prompt, { signal, onEvent, history = [] } = {}) {
    if (typeof prompt !== "string" || !prompt.trim()) throw new AgentError("An agent prompt is required.", { code: "missing_prompt" });
    throwIfAborted(signal);
    await this.workspace.verify();
    throwIfAborted(signal);
    const allowedTools = TOOL_DEFINITIONS.filter((tool) => !this.workspace.readOnly || !MUTATING_TOOLS.has(tool.function.name));
    const allowedNames = new Set(allowedTools.map((tool) => tool.function.name));
    let messages = [...history, { role: "user", content: prompt.trim().slice(0, 12_000) }];
    const emit = async (event) => {
      if (typeof onEvent === "function") await onEvent(event);
    };

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      throwIfAborted(signal);
      messages = compactMessages(messages);
      await emit({ type: "turn_start", iteration });
      throwIfAborted(signal);
      const turn = await this.client.agentTurn({
        messages,
        tools: allowedTools,
        systemPrompt: systemPromptFor(this.workspace, this.systemPrompt),
        maxTokens: this.maxTokens,
        signal,
      });
      throwIfAborted(signal);
      const parsed = turn.type === "tool_calls"
        ? { calls: turn.calls || [], errors: [], content: turn.content || "" }
        : parseToolEnvelopes(turn.content);
      parsed.calls = uniqueCallIds(parsed.calls, messages, iteration);

      if (parsed.errors.length && !parsed.calls.length) {
        messages.push(
          { role: "assistant", content: turn.content },
          { role: "user", content: `Your tool envelope could not be parsed: ${parsed.errors.join("; ")}. Send one valid 3aik-tool JSON block or a final answer.` },
        );
        await emit({ type: "protocol_error", iteration, errors: parsed.errors });
        continue;
      }

      if (!parsed.calls.length) {
        const content = parsed.content || turn.content;
        if (!content.trim()) throw new AgentError("The model returned an empty final answer.", { code: "empty_response" });
        throwIfAborted(signal);
        messages.push({ role: "assistant", content });
        await emit({ type: "final", iteration, content, model: turn.model, fallback: turn.fallback });
        throwIfAborted(signal);
        return { content, messages, iterations: iteration, model: turn.model, fallback: Boolean(turn.fallback) };
      }

      if (parsed.calls.length > this.maxToolCallsPerTurn) {
        messages.push(
          { role: "assistant", content: turn.content || `[Model requested ${parsed.calls.length} tool calls; request omitted locally.]` },
          { role: "user", content: `Too many tool calls (${parsed.calls.length}). Request at most ${this.maxToolCallsPerTurn} at a time.` },
        );
        continue;
      }

      const unavailable = parsed.calls.filter((call) => !allowedNames.has(call.name));
      if (unavailable.length) {
        messages.push(
          { role: "assistant", content: turn.content || `[Unavailable tool request omitted locally.]` },
          { role: "user", content: `Unavailable tool name(s): ${unavailable.map((call) => call.name).join(", ")}. Use only the provided tools.` },
        );
        for (const call of unavailable) {
          const error = new AgentError(`Tool is unavailable: ${call.name}`, { code: "unknown_tool" });
          await emit({ type: "tool_error", iteration, call, error });
        }
        continue;
      }

      messages.push({
        role: "assistant",
        content: turn.content || "",
        tool_calls: openAiToolCalls(parsed.calls),
      });

      for (const call of parsed.calls) {
        throwIfAborted(signal);
        await emit({ type: "tool_start", iteration, call });
        throwIfAborted(signal);
        try {
          const result = await this.workspace.executeTool(call.name, call.arguments, { signal });
          throwIfAborted(signal);
          messages.push(formatToolResult(call, result));
          await emit({ type: "tool_end", iteration, call, result });
          throwIfAborted(signal);
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw signal?.reason || error;
          messages.push(formatToolError(call, error));
          await emit({ type: "tool_error", iteration, call, error });
        }
      }
    }

    throw new AgentError(`Agent stopped after ${this.maxIterations} turns without a final answer.`, { code: "iteration_limit" });
  }
}

export { compactMessages, systemPromptFor };
