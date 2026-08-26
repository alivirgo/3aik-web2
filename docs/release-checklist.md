# Release checklist

## Quality gates

- Run the Worker typecheck, browser syntax check, unit/DOM tests, and Wrangler dry run.
- Run agent-core, CLI, and desktop checks from clean installs.
- Install the packed CLI into a fresh temporary npm prefix and run `3aik --version`, `3aik doctor --json`, and mocked cloud/local provider tests.
- Build Windows NSIS/portable and Linux AppImage/deb desktop artifacts.
- Android packaging is deferred; do not block CLI/desktop releases on the Android job.
- Confirm denied approvals produce no filesystem change and path/symlink escape fixtures fail closed.
- Scan distributable dependency trees with `npm audit --omit=dev --audit-level=high`.
- Review `docs/operations.md`, confirm Workers Paid model entitlements, and configure usage notifications before enabling public traffic.

## Production gates

- Deploy through the connected Cloudflare integration and wait for a successful GitHub check.
- Run `node scripts/smoke-production.mjs https://3aik.com --image`.
- Verify security headers, API request IDs, actual-model headers, rate-limit behavior, attachment round trips, workspace export/import, and 360 px responsive DOM contracts.
- Check the release page from a logged-out session and download every asset.
- Verify SHA-256 checksums.

## Windows gates

- Install from the NSIS artifact on a clean Windows VM.
- Launch, select a disposable fixture repository, deny one mutation, approve one patch, run tests, inspect the real diff, cancel a command, and restart the app.
- Connect once to 3aik Cloud and once to a loopback OpenAI-compatible test server. Confirm local mode makes no request to `3aik.com`.
- Uninstall and confirm project files are preserved.

Unsigned beta builds can trigger Microsoft SmartScreen. Do not describe a build as signed or auto-updating until a code-signing certificate and tested update/rollback channel are configured.

## Android / Google Play gates

- Keep the visible name exactly `3aikGPT: AI, On Your Terms`, developer name NUC7 Studios, and production package `com.nuc7.threeaikgpt`.
- Confirm `versionName` equals the release tag and `versionCode` equals `major * 10000 + minor * 100 + patch`; increment it for every Play release.
- Protect the `android-release` GitHub Environment with required reviewers. Store all five upload-key values there; a partial secret set must fail rather than fall back.
- Verify the upload-certificate SHA-256 fingerprint before signing. After building, require an actual AAB JAR signature block, successful `jarsigner` verification, and the same signer fingerprint.
- Preserve the AAB, R8 mapping, Android SHA-256 file, signer/status report, source revision, test output, and lint report in the release record.
- If the release asset is named `UNSIGNED-NOT-FOR-PLAY`, stop: it is a build-verification artifact and cannot be uploaded to Play.
- Verify `https://3aik.com/privacy` and the production CSP/security headers from a logged-out device, then reconcile Play Data safety answers with the deployed service.
- Install the debug APK on a physical Android 8.0+ device and complete [the Android smoke test](../apps/android/SMOKE_TEST.md), including offline recovery, import/export, external links, accessibility, renderer recovery, and complete local-data deletion.
- Upload the verified signed AAB to an internal track first. Review Play's automated pre-launch, policy, integrity, accessibility, and device-catalog results before rollout.
