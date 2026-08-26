# 3aik v3

3aik is a no-login AI workspace for the web, terminal, Windows desktop, and Android. The web app provides streamed chat, deeper reasoning, coding help, image generation, multimodal attachments, branching, and portable local history. The downloadable coding agent can inspect and change a selected project with explicit local approvals.

Production: [3aik.com](https://3aik.com)

Releases: [github.com/alivirgo/3aik-web2/releases](https://github.com/alivirgo/3aik-web2/releases)

## What ships

| Surface | Capabilities |
| --- | --- |
| Web/PWA | Ask, Deep, Code, and Image modes; streamed responses; image and text attachments; edit-and-branch, regenerate, rename, search, Markdown export, and lossless workspace backup/import. |
| CLI | Cross-platform chat and a bounded coding-agent loop for PowerShell, Command Prompt, and POSIX shells. |
| Desktop | Windows and Linux chat/coding workspaces with a sandboxed renderer, selected-folder access, approvals, live activity, and Git diff review. |
| Android | `3aikGPT: AI, On Your Terms`, a hardened Android 8.0+ client for the production web workspace with private document-picker import/export and native local-data controls. |
| Local models | Exclusive local routing for Ollama, LM Studio, llama.cpp, or a private OpenAI-compatible endpoint. Local mode never silently falls back to 3aik Cloud. |

The browser stores conversation history on the device. Cloud prompts are still processed by Cloudflare Workers AI; "local-first" does not mean cloud inference is offline. The installed clients can keep model traffic local when configured with a local provider.

## Install the coding agent

Node.js 24 or newer is required.

```powershell
npm install --global https://github.com/alivirgo/3aik-web2/releases/latest/download/3aik-cli.tgz
3aik doctor
3aik agent "Inspect this project and explain its architecture"
```

The commands work in PowerShell, Command Prompt, and bash. Important commands include:

```text
3aik chat [prompt]       Stream a response or start interactive chat
3aik agent [prompt]      Inspect, edit, and test the current workspace
3aik review [path]       Review a Git diff without write tools
3aik models              Test the provider and list available models
3aik doctor              Check the local setup and provider connection
3aik config              View or change redacted configuration
```

Writes, patches, and commands ask for approval. `--dry-run` prevents mutation, and `--read-only` removes mutating tools. See [packages/cli/README.md](packages/cli/README.md) for the complete command and configuration reference.

## Use a local model

Start a local OpenAI-compatible server and select its preset. For Ollama:

```powershell
3aik config set provider ollama --yes
3aik models
3aik config set model YOUR_INSTALLED_MODEL_ID --yes
3aik agent "Review this project"
```

The built-in defaults are:

| Provider | Endpoint |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp | `http://127.0.0.1:8080/v1` |

Custom OpenAI-compatible endpoints are also supported. Provider selection is exclusive: local prompts and tool-result turns return only to the configured local endpoint. Model quality and tool-calling reliability depend on the selected model.

## Windows and Linux desktop

GitHub Releases contain a Windows assisted installer, a Windows portable x64 build, plus Linux AppImage and `.deb` packages. The current public binaries are unsigned, so Windows SmartScreen (and some Linux desktop environments) may warn until code signing is configured. The app checks releases only when the user asks; it does not silently download or install updates.

The desktop renderer has no Node.js, shell, filesystem, credential, or generic IPC access. Coding tools live behind a narrow main-process boundary, operate on a user-selected folder, and request approval before writes, patches, or commands. Local provider credentials use Electron `safeStorage` when available and otherwise remain memory-only.

See [apps/desktop/README.md](apps/desktop/README.md) for development, provider, security, and packaging details.

## Android

The Android app is named **3aikGPT: AI, On Your Terms** and is prepared for publication by NUC7 Studios. Its stable package is `com.nuc7.threeaikgpt`; the originally requested `com.nuc7.3aikGPT` cannot be an Android application ID because a dot-separated Java package segment cannot begin with a digit.

The app is a constrained native WebView client for `https://3aik.com`, not an on-device model runtime. It requests only Internet and network-state permissions, keeps navigation on the production HTTPS origin, uses Android's system document picker, and exposes native privacy and complete local-data clearing controls. See [apps/android/README.md](apps/android/README.md) for the implementation boundary and [apps/android/PLAY_STORE.md](apps/android/PLAY_STORE.md) for the Play Console checklist.

Normal CI creates a debug APK and an explicitly unsigned release AAB for verification. An unsigned AAB is not accepted as a Play upload. Tagged releases produce a Play-upload-signed AAB only when the complete protected upload-key secret set is available and its certificate matches the configured SHA-256 fingerprint.

## Architecture and trust boundaries

- `src/`: Cloudflare Worker routes, validation, model routing, soft rate limits, and security headers.
- `public/`: dependency-free browser workspace and installable offline shell. API responses are never service-worker cached.
- `packages/agent-core/`: reusable tool loop, provider clients, workspace containment, approvals, and process bounds.
- `packages/cli/`: terminal UX and persistent redacted configuration.
- `apps/desktop/`: Electron shell and shared-core adapter.
- `apps/android/`: Kotlin/AndroidX shell for the production web workspace, native privacy controls, and Play packaging.

The hosted `/api/agent` route returns structured model tool requests but never executes local tools. Filesystem and command execution happen only in an installed client after local validation and approval. Secret-like files are rejected or omitted, searches are literal-only, child processes receive an allowlisted build environment, and traversal or symlink escapes are blocked.

These are application guardrails, not an operating-system sandbox. An approved command runs with the user's permissions. Use a disposable checkout, container, VM, or restricted account for untrusted code. Read [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) before deployment or sensitive use.

## HTTP API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Versioned public capabilities and availability metadata. |
| `POST /api/chat` | Validated streaming chat for Ask, Deep, and Code. |
| `POST /api/image` | Validated image generation returning an image response. |
| `POST /api/agent` | Client-tools v1 model loop; never executes tools server-side. |
| `GET /api/downloads` | Cached total of eligible public GitHub Release asset downloads. |

The download counter is derived from GitHub's release-asset `download_count` values. Draft releases and non-user metadata are excluded.

## Develop and verify

Node.js 24 or newer is required.

```powershell
npm ci
npm ci --prefix packages/agent-core
npm ci --prefix packages/cli
npm ci --prefix apps/desktop
npm run check:all
npm run dev
```

`check:all` runs Worker type checks, client syntax checks, browser/API tests, a Wrangler dry-run, Agent Core tests, CLI packaging/install tests, and desktop security/integration tests.

Android verification is a separate JDK 17/API 36 build:

```powershell
cd apps/android
./ci.ps1
```

That entry point runs Android unit tests, fatal release lint, a debug APK build, and an R8-minified release bundle build.

Production smoke test:

```powershell
npm run smoke:production -- https://3aik.com
```

## Release

Tags matching `v*` run the release workflow. It verifies that package versions match the tag, installs the packed CLI into a clean directory, builds Windows and Linux desktop artifacts, creates SHA-256 checksums, and publishes a GitHub Release. Android packaging is deferred and is not part of this release pipeline. Cloudflare deployment remains connected to the `main` branch.

Local desktop builds use `--publish never`. Release binaries remain unsigned until CI is supplied with an Authenticode certificate.

Android signing uses the protected `android-release` GitHub Environment. Configure all five environment secrets together: `THREEAIK_UPLOAD_KEYSTORE_BASE64`, `THREEAIK_UPLOAD_KEY_ALIAS`, `THREEAIK_UPLOAD_STORE_PASSWORD`, `THREEAIK_UPLOAD_KEY_PASSWORD`, and `THREEAIK_UPLOAD_CERT_SHA256`. The last value is the upload certificate's 64-hex-digit SHA-256 fingerprint, with optional colons. Partial configuration fails the release. With no signing secrets, the workflow succeeds only with a conspicuously named `UNSIGNED-NOT-FOR-PLAY.aab`; it never presents that fallback as Play-ready. The release also includes the R8 mapping, Android-specific hashes, and a certificate/status report. See [apps/android/RELEASE.md](apps/android/RELEASE.md) before any Play upload.

## License

MIT. See [LICENSE](LICENSE).
