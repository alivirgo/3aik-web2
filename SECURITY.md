# 3aik security

## Agent safety boundary

3aik Agent runs tools on the user's computer. It is designed to keep file operations inside the selected workspace, classify shell commands by risk, show consequential actions, and require approval unless the user explicitly chooses a more permissive policy.

Those controls reduce mistakes; they are not an operating-system sandbox. A permitted command can execute arbitrary program behavior, and repository content can be hostile. Review commands and diffs before approval, use source control, and run untrusted repositories in a disposable VM or container.

The hosted `/api/agent` endpoint only chooses between text and tool calls. It cannot access the user's filesystem or shell. Tool execution is performed by the local CLI or desktop main process.

## Secrets

- Do not place API keys, credentials, private keys, `.env` contents, or unrelated personal files in prompts.
- Local-model API keys are optional. The desktop client uses operating-system encryption when available and otherwise keeps the key in memory only.
- A 3aik device ID is a random rate-limit identifier, not an authentication secret.
- Local provider mode does not send model prompts to `3aik.com`.

## Android boundary

The Android client is a constrained WebView for the exact production HTTPS origin. It rejects TLS errors and cleartext traffic, denies web camera/microphone/location requests, disables WebView file/content access, and uses a narrowly scoped message channel only for a user-initiated bounded `blob:` export. It does not expose a general JavaScript-to-native interface. External links leave the app only after confirmation.

These controls do not make a compromised production origin trustworthy. The native client also depends on Android System WebView and the production Content Security Policy, so both are release dependencies. Re-run the Android tests and fatal lint, inspect the merged manifest, verify the live policy/security headers, and complete a physical-device smoke test before Play submission.

Never commit an Android upload keystore or its passwords. Tagged CI releases use the protected `android-release` Environment only when the complete secret set is present, verify the configured certificate SHA-256 fingerprint before signing, and verify both a real AAB signature block and the resulting signer certificate afterward. An artifact named `UNSIGNED-NOT-FOR-PLAY` must never be uploaded to Google Play.

## Reporting a vulnerability

Please use GitHub's private security-advisory workflow for this repository. Include affected versions, reproduction steps, impact, and any suggested mitigation. Do not open a public issue for an unpatched vulnerability.

## Supported versions

Security fixes target the latest release. Older downloadable clients may not receive fixes; update before running an agent against important code.
