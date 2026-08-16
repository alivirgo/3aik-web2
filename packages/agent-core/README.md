# @3aik/agent-core

The reusable, local-first engine behind the 3aik command-line coding agent. It is ESM-only, requires Node.js 24 or newer, and has no runtime dependencies.

## What it provides

- `ThreeAikClient`: streamed chat plus native `/api/agent` tool calls, with an automatic text-envelope fallback for older 3aik deployments.
- `OpenAICompatibleClient`: private/local chat and tool calling through an OpenAI-compatible `/v1` API.
- `CodingAgent`: a bounded tool loop with complete tool-history preservation, output compaction, and iteration limits.
- `LocalWorkspace`: contained read, list, literal search, write, unified patch, command, and Git diff tools.
- Safety utilities: real-path containment, symlink-escape prevention, secret-file filtering, command risk classification, approvals, timeouts, and output limits.

## Minimal use

```js
import {
  CodingAgent,
  LocalWorkspace,
  ThreeAikClient,
  createApprovalPolicy,
} from "@3aik/agent-core";

const workspace = new LocalWorkspace(process.cwd(), {
  approve: createApprovalPolicy({
    confirm: async ({ description }) => askTheUser(description),
  }),
});

const client = new ThreeAikClient({
  apiBase: "https://3aik.com",
  headers: { "x-3aik-device": persistedDeviceId },
});

const result = await new CodingAgent({ client, workspace }).run(
  "Find the failing test, fix it, and verify the change.",
);

console.log(result.content);
```

For a local model, replace the client:

```js
import { OpenAICompatibleClient } from "@3aik/agent-core";

const client = new OpenAICompatibleClient({
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "your-installed-model",
});
```

When this client is selected, it only calls the configured `baseUrl`; it has no cloud fallback.

## Tool protocol

The preferred 3aik endpoint returns native calls from `POST /api/agent`. If that endpoint is unavailable, the engine asks the code model for a strict block:

````text
```3aik-tool
{"id":"call-1","name":"read_file","arguments":{"path":"src/app.js"}}
```
````

The block is parsed locally. The API never executes a filesystem tool or command.

## Safety boundary

All tool paths are resolved against a real workspace root. Traversal and symlink escapes are rejected. Recursive scans ignore generated directories and never follow symlinks. Reads, listings, searches, and Git diffs omit or reject secret-like paths such as `.env*`, `.dev.vars*`, `.wrangler`, `.git` internals, credential files, private keys, `.ssh`, and `.aws`. Search is literal-only so a model cannot submit a pathological regular expression.

Every write, patch, and arbitrary shell command goes through an approval callback unless the host deliberately supplies an auto-approval policy. Broadly destructive commands, obvious secret-file references, and environment-dump commands are blocked even under auto-approval. Child processes receive a small allowlist of system, locale, temporary-directory, and toolchain path variables; application URLs, DSNs, cloud credentials, tokens, and interpreter-injection options are omitted. Processes have time and output limits.

These are application-level guardrails, not an OS sandbox. A permitted command runs with the current user's operating-system permissions. Use a disposable checkout, container, VM, or restricted OS account when working with untrusted repositories.

## Development

```sh
npm test
npm run check
```
