# 3aik client-tools protocol v1

The coding agent uses a split-trust design:

1. The model service receives conversation context and JSON Schema tool definitions.
2. It returns either final text or requested tool calls.
3. The installed client validates each call, obtains any required local approval, and executes it inside the selected workspace.
4. The client sends bounded tool results back for the next turn.

The hosted Worker never receives a filesystem handle and never executes a local command.

## Cloud request

`POST /api/agent` with `Content-Type: application/json`:

```json
{
  "messages": [
    { "role": "user", "content": "Find and fix the failing test." }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read a file inside the selected workspace.",
        "parameters": {
          "type": "object",
          "properties": { "path": { "type": "string" } },
          "required": ["path"],
          "additionalProperties": false
        }
      }
    }
  ],
  "systemPrompt": "Optional project-specific instructions.",
  "maxTokens": 4096
}
```

Clients should send a random, persisted `x-3aik-device` header. It is a rate-limit identifier, not a credential.

## Cloud responses

Final answer:

```json
{
  "type": "message",
  "content": "The tests now pass.",
  "model": "Kimi K2.7 Code"
}
```

Tool request:

```json
{
  "type": "tool_calls",
  "calls": [
    {
      "id": "call_123",
      "name": "read_file",
      "arguments": "{\"path\":\"package.json\"}"
    }
  ],
  "model": "Llama 4 Scout"
}
```

The client records the assistant request in OpenAI-compatible form, executes an approved tool locally, and adds a tool message:

```json
{
  "role": "tool",
  "tool_call_id": "call_123",
  "name": "read_file",
  "content": "{\"ok\":true,\"content\":\"...bounded result...\"}"
}
```

Every tool result must reference an earlier assistant tool call. Tool names must match a definition supplied in the same request.

## Local providers

Ollama, LM Studio, llama.cpp, and other local runtimes are called directly through their OpenAI-compatible `/v1/models` and `/v1/chat/completions` routes. In local mode, the installed client does not call `/api/agent` or silently fall back to 3aik Cloud.

Native OpenAI-compatible tool calls are preferred. The agent core can parse a strict text tool envelope for smaller local models that cannot emit native calls.

## Security requirements

- Resolve both lexical and real paths; reject traversal and symlink escapes.
- Do not read common credential/secret files into model context.
- Bound file reads, writes, search work, command output, turn count, tool count, and request time.
- Treat repository files and tool output as untrusted data.
- Require approval for writes and commands unless the user explicitly selected a different policy.
- Never interpret model text as a shell command except through the validated `run_command` tool.
- Preserve dirty user work and never perform destructive Git recovery automatically.
- Cancellation must stop future tools and terminate active child processes where supported.
