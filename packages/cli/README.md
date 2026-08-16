# 3aik CLI

A cross-platform AI chat client and local coding agent for PowerShell, Command Prompt, and POSIX shells. It requires Node.js 24 or newer and works with 3aik Cloud, Ollama, LM Studio, llama.cpp, and generic OpenAI-compatible servers.

## Install

From the latest GitHub release:

```powershell
npm install --global https://github.com/alivirgo/3aik-web2/releases/latest/download/3aik-cli.tgz
3aik doctor
```

The same two commands work in Command Prompt and bash. You can also download `install.ps1` or `install.cmd` from the release, or install a local checkout:

```powershell
npm install --global .\packages\cli
3aik --version
```

## Start

```powershell
# Stream one response
3aik chat "Explain this repository"

# Start an interactive chat
3aik chat

# Let the agent inspect, edit, and test the current project
3aik agent "Fix the failing tests and explain the root cause"

# Preview proposed actions without changing anything
3aik agent "Upgrade this project" --dry-run

# Review without exposing write/command tools
3aik review
3aik review --staged
```

Writes, patches, and commands ask for approval. `--yes` approves all non-blocked proposals for unattended use; `--read-only` disables mutating tools. `Ctrl+C` aborts an active request.

## Local models (no cloud prompt traffic)

Provider selection is exclusive. When any local provider is selected, chat and agent requests go only to its configured URL—there is no fallback to `3aik.com`.

### Ollama

Start Ollama, install a tool-capable coding model, then run:

```powershell
3aik config set provider ollama --yes
3aik models
3aik config set model YOUR_INSTALLED_MODEL_ID --yes
3aik agent "Inspect this project"
```

The preset uses `http://127.0.0.1:11434/v1`.

### LM Studio

Load a model and enable LM Studio's local OpenAI-compatible server, then:

```cmd
3aik config set provider lmstudio --yes
3aik models
3aik config set model YOUR_LOADED_MODEL_ID --yes
3aik chat "Hello from my local model"
```

The preset uses `http://127.0.0.1:1234/v1`.

### llama.cpp

Start `llama-server` with its OpenAI-compatible endpoint, then:

```powershell
3aik config set provider llamacpp --yes
3aik models
3aik config set model YOUR_SERVER_MODEL_ID --yes
```

The preset uses `http://127.0.0.1:8080/v1`.

### Any OpenAI-compatible endpoint

```powershell
3aik config set provider openai-compatible --yes
3aik config set baseUrl http://127.0.0.1:9000/v1 --yes
3aik config set model my-coder --yes
$env:THREEAIK_API_KEY = "optional-key"
3aik models
```

Command Prompt uses `set THREEAIK_API_KEY=optional-key`; bash uses `export THREEAIK_API_KEY=optional-key`. Environment variables beginning with `THREEAIK_` are canonical. Legacy `3AIK_*` names are read for Windows compatibility.

## Commands

| Command | Purpose |
| --- | --- |
| `3aik chat [prompt]` | Stream a one-shot response or enter interactive chat. |
| `3aik agent [prompt]` | Run the bounded local coding-agent loop. |
| `3aik review [path]` | Review an unstaged Git diff in read-only mode. |
| `3aik doctor` | Check Node, Git, workspace access, and provider health. |
| `3aik models` | Test the configured provider and list models/modes. |
| `3aik config` | Show effective config with the API key redacted. |
| `3aik config get/set/unset` | Read or change global settings. Config writes ask first. |
| `3aik init` | Create `.3aik/config.json` and `.3aik/instructions.md`. |

Run `3aik --help` for flags. Prompts can also be piped through standard input.

## Configuration and privacy

The first run creates a random device ID in the user config and sends it as `x-3aik-device` only to 3aik Cloud for soft rate limiting. It is not an authentication secret. No device header is sent to local providers.

Config precedence is command flags, `THREEAIK_*` environment variables, project `.3aik/config.json`, global config, then defaults. Repository-controlled project config is intentionally limited to `mode`, `temperature`, `maxTokens`, `timeoutMs`, `maxOutputBytes`, and `maxIterations`. It cannot select a provider, endpoint, model, API key, or device identity. Those trust-sensitive values must come from global config, the environment, or an explicit command flag.

The global config is stored under `%APPDATA%\3aik\config.json` on Windows, `~/Library/Application Support/3aik/config.json` on macOS, and `${XDG_CONFIG_HOME:-~/.config}/3aik/config.json` on Linux.

Avoid placing API keys on a command line that may be saved in shell history. Prefer `THREEAIK_API_KEY`. Global config is written with user-only file mode where the platform supports it.

## Safety model

- Real-path containment rejects `..`, absolute-path, and symlink escapes.
- Recursive scans skip generated directories and never follow symlinks.
- Secret-like files (`.env*`, `.dev.vars*`, `.wrangler`, `.git` internals, credentials, private keys, `.ssh`, and similar) cannot be read or searched by the model and are omitted from listings/diffs.
- Search is literal-only; model-controlled regular expressions are rejected.
- Writes and commands require confirmation unless `--yes`; `--dry-run` executes neither.
- Broad disk deletion, formatting, shutdown, fork bombs, and download-to-shell patterns are blocked.
- Obvious secret-dump commands are blocked, and commands receive only an allowlisted build environment rather than arbitrary application/cloud variables.
- Commands have configurable timeouts and bounded captured output.

These controls reduce accidental damage, but they are not an OS sandbox. An approved command inherits your user permissions and may access resources outside the workspace. Use a container, VM, disposable checkout, or restricted account for untrusted code.

## Release artifact

`@3aik/agent-core` is bundled into the CLI tarball; installation does not require npm publishing or a sibling repository. Maintainers can create the stable release asset with:

```powershell
npm run pack:release
```

This writes `3aik-cli.tgz`, which can be attached to a GitHub release together with `install.ps1` and `install.cmd`.
