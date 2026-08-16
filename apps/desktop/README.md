# 3aik Desktop

3aik Desktop is a Windows-first Electron application with two deliberately separate workspaces:

- **Chat** embeds the production `https://3aik.com` experience in its own sandboxed, persistent Electron session.
- **Coding Agent** runs `@3aik/agent-core` in the trusted main process. It can inspect, search, edit, patch, run approved commands/tests, and show the live Git diff for a user-selected project.

The web renderer never receives Node.js, filesystem, shell, credential, or generic IPC access.

## Development

The desktop package requires Node.js 24 or newer. Installing dependencies downloads Electron; this repository does not commit or bundle an Electron binary.

```powershell
cd apps/desktop
npm install
npm run check
npm run dev
```

`npm run dev` opens the local shell and loads the live production chat workspace. The Coding Agent can be exercised against a disposable project folder. Every write, patch, and command still requires an in-app approval.

## Model providers

The provider is selected in **Settings → Coding Agent**.

### 3aik Cloud

Cloud turns go to `POST https://3aik.com/api/agent` by default. A random device ID is created in the desktop settings file and sent as `x-3aik-device` for soft per-device rate limiting. It is not an authentication secret and is never exposed to the renderer.

### Local OpenAI-compatible

Local mode uses an OpenAI-compatible endpoint and never falls back to 3aik Cloud. Every model turn, including turns after local tool results, returns to the selected local endpoint.

Included presets:

| Server | Default endpoint | Notes |
| --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | Start Ollama, pull a tool-capable coding model, and enter its exact model ID. |
| LM Studio | `http://127.0.0.1:1234/v1` | Enable LM Studio's local server and load a model. |
| llama.cpp | `http://127.0.0.1:8080/v1` | Start `llama-server` with its OpenAI-compatible routes. |
| Custom | User supplied | Restricted to loopback, `.local`, or private-network addresses. |

Use **Test connection** to query `/models` without sending a prompt. A capable coding/instruction model with reliable tool calling is strongly recommended. Small or non-tool-capable local models may produce weaker plans, malformed calls, or fail to complete multi-step tasks.

Local API keys are handled only in the main process. When Electron `safeStorage` is available, a remembered key is encrypted with the operating-system protection service before being written to disk. If secure storage is unavailable, the key remains in memory for the current process and is forgotten on exit. The renderer can set or clear a key but can never read one back.

## Agent adapter boundary

[`src/agent/adapter.d.ts`](src/agent/adapter.d.ts) is the narrow UI-independent contract. [`src/agent/core-adapter.cjs`](src/agent/core-adapter.cjs) adapts the shared package to desktop events and approvals. The preview-only [`local-safe-adapter.cjs`](src/agent/local-safe-adapter.cjs) is loaded only if `@3aik/agent-core` cannot be imported.

Agent Core owns the local tool implementation and enforces:

- realpath-based workspace containment and symlink escape prevention;
- generated/build/secret-aware traversal limits;
- explicit approval for writes, patches, and every command;
- command risk classification and catastrophic-command blocking;
- bounded file reads, searches, process output, and command timeouts;
- read-only mode that does not expose mutating tools to the model.

The desktop adapter turns Agent Core events into renderer-safe activity objects. Approval decisions travel back through a single allowlisted IPC method. The renderer never evaluates a command or applies a patch.

Large proposal previews are intentionally bounded for renderer responsiveness. Patch previews are capped at 24,000 rendered characters and full-file write previews at 800 lines plus the same character cap. Any partial preview carries structured truncation metadata, an inline `[PREVIEW TRUNCATED]` marker, a visible warning in the diff panel, and a second warning on the approval card. Users are told to inspect the complete source in their editor before approving.

## Electron security posture

- `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false` in every renderer.
- The trusted shell uses `app://desktop`, not `file://`, with a restrictive Content Security Policy.
- Production chat uses a separate `persist:3aik-chat` partition and has no preload bridge.
- Navigation, external destinations, permissions, window creation, asset paths, IPC channels, and view bounds are allowlisted or validated.
- All off-origin chat navigation is blocked. Only the 3aik site and this repository can be opened externally.
- Local model traffic is issued in the main process and restricted to loopback/private-network endpoints.
- Settings are schema-reduced before persistence; model secrets use the credential store described above.

## Tests

```powershell
npm test
```

The suite covers IPC allowlisting, renderer and navigation origins, asset/workspace path containment, local endpoint restrictions, provider routing, device headers, encrypted/memory-only credential behavior, settings device-ID persistence, real Agent Core patch/command integration, Git diff mapping, and the invariant that denied approval causes zero mutation.

## Windows packaging

The builder configuration produces both a guided NSIS installer and a portable x64 executable:

```powershell
npm run pack:win
```

Artifacts are written to `release/` as:

- `3aik-Setup-<version>-x64.exe`
- `3aik-Portable-<version>-x64.exe`

[`build-resources/icon.svg`](build-resources/icon.svg) is the vector master; electron-builder converts it for the Windows executable and installer. Packaging is configured with `--publish never`, so a local build cannot publish by accident.

The assisted installer displays the repository’s MIT license, and the same license is copied into the installed resources. Generated artifacts are **unsigned** until a release pipeline is given an Authenticode certificate. The app performs a user-initiated release check only; it has no automatic downloader or updater.

Before a public release, configure an Authenticode certificate in CI and sign both artifacts. Windows SmartScreen reputation is materially better for consistently signed releases. The current update screen checks GitHub Releases and asks the user before opening a release; it never downloads or installs code silently.

## Release checklist

1. Run `npm run check` in this directory and the Agent Core checks in `packages/agent-core`.
2. Confirm the production `/api/health` and `/api/agent` routes.
3. Exercise an approved and a declined task against a disposable Git repository.
4. Build with `npm run pack:win` on Windows.
5. Sign the installer and portable executable, scan them, and test on a clean Windows VM.
6. Publish the two artifacts to the matching GitHub Release.

No binaries were built or downloaded as part of this scaffold.
