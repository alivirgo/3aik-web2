# 3aikGPT for Android

`3aikGPT: AI, On Your Terms` is the official Android window onto the production
[`https://3aik.com`](https://3aik.com) workspace. It is a small native Kotlin/AndroidX shell around a deliberately constrained WebView, developed by **NUC7 Studios**.

Version: `3.0.0` (`versionCode 30000`)

Release application ID and namespace: `com.nuc7.threeaikgpt`

## Required application-ID correction

The originally requested ID, `com.nuc7.3aikGPT`, cannot be built or accepted by Google Play. Android requires every dot-separated application-ID segment to begin with a letter; `3aikGPT` begins with a digit. The stable, lowercase replacement is `com.nuc7.threeaikgpt`. Do not change this ID after the first Play release—Google Play treats a changed ID as a different app.

The visible app label/store title is exactly `3aikGPT: AI, On Your Terms`.

## Product boundary

The app says what “on your terms” actually means:

- Threads, drafts, preferences, and generated media are stored in this app’s local WebView storage unless the user exports or clears them.
- Android cloud backup and device-to-device transfer are disabled for app data.
- A user can control remembered history in Workspace settings, export/delete threads there, or erase all app-held web storage, cookies, and cache from the native menu.
- Prompts, selected attachments, recent conversation context, custom instructions, and the site’s random soft abuse-control device value leave the phone when Cloud mode is used. They are processed by 3aik Cloud and Cloudflare Workers AI.
- “Local history” does **not** mean cloud inference is offline, end-to-end encrypted, or visible only to the user. The Android shell does not claim to run a local model.

The same boundary appears on first launch, in the Privacy & local data dialog, and in the proposed Play listing. That native dialog links to the canonical public policy route implemented by the repository at `https://3aik.com/privacy`; its production deployment and final reviewed contents must be verified before Play submission.

The native erase action uses AndroidX `WebStorageCompat.deleteBrowsingData` and waits for its completion callback before reporting success or rebuilding the workspace. On a supporting System WebView, that complete deletion API covers cookies, network cache, JavaScript-readable storage (including local storage and IndexedDB), and installed service workers/Cache Storage. If an obsolete or vendor WebView does not expose `DELETE_BROWSING_DATA`, the app does not claim that a partial legacy cleanup succeeded: after a second warning it asks Android to close the app and erase all app-private data. Exported documents remain outside app-private storage.

## Security model

The app has two normal permissions only:

- `INTERNET`, required for `https://3aik.com`;
- `ACCESS_NETWORK_STATE`, used to distinguish an offline error from a server error.

There are no storage, camera, microphone, location, contacts, advertising-ID, notification, or background-service permissions. File import/export uses Android’s system document picker and per-document URI grants.

The WebView is configured to:

- allow navigation and directly observed network subresource requests only from the exact `https://3aik.com:443` origin;
- reject cleartext traffic, mixed content, non-default ports, user-info URLs, suffix lookalikes, and all `file://`, `content://`, `javascript:`, and `intent://` navigation;
- cancel TLS errors with no user bypass;
- enable Safe Browsing and return to safety on a hit;
- disable WebView file access, direct content-provider access, geolocation, pop-ups, automatic media playback, form saving, third-party cookies, and WebView debugging in release builds;
- deny all web camera, microphone, and location permission requests;
- apply the same allowlist to Service Worker requests where the installed WebView supports it;
- open user-initiated external HTTPS/email links in an external app only after confirmation;
- keep Android back navigation inside WebView history before leaving the activity;
- show a native offline/error/retry surface and recover from renderer termination.

There is no `addJavascriptInterface` bridge. User-initiated `blob:` exports need help because Android WebView cannot hand those URLs to DownloadManager. The app uses AndroidX `WebMessageListener`, scoped by the WebView implementation to the exact production HTTPS origin. Its protocol accepts only bounded download metadata and chunks, and writes only to a document location the user has just chosen. It cannot access arbitrary files or invoke general native functions.

Android does not expose every subresource redirect hop to `shouldInterceptRequest`. The client rechecks resource URLs surfaced through `onLoadResource` and stops the document on an escape, while regular native downloads manually validate every redirect. Complete WebView subresource redirect containment also relies on the production document’s restrictive CSP. At build time, `https://3aik.com/` served `default-src 'self'`, `connect-src 'self'`, and origin-limited script/style/image policies. This header is a monitored release prerequisite, not a property the APK can guarantee if the production origin changes or is compromised.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) for the full boundary.

## Toolchain

The project is pinned for repeatable CI builds:

| Component | Version |
| --- | --- |
| Android Gradle Plugin | 9.3.1 |
| Gradle wrapper | 9.5.0, with SHA-256 verification |
| External artifacts | Checked against committed SHA-256 dependency-verification metadata |
| JDK | 17 |
| compileSdk / targetSdk | 36 / 36 |
| minSdk | 26 (Android 8.0) |
| Android SDK Build Tools | 36.0.0 |
| Kotlin | AGP 9 built-in Kotlin |

AndroidX Core is pinned to 1.18.0 because 1.19.0 requires compileSdk 37. Activity, AppCompat, WebKit, and Material use their stable releases current when this project was created. `lint.xml` suppresses only version-update notices for these deliberate compatibility pins; all source, manifest, accessibility, and security lint remains fatal.

## Build and verify

Install JDK 17 and an Android SDK with `platforms;android-36` and `build-tools;36.0.0`, then set `ANDROID_HOME`.

On PowerShell:

```powershell
cd apps/android
./ci.ps1
```

On macOS/Linux:

```sh
cd apps/android
chmod +x gradlew ci.sh
./ci.sh
```

The CI entry points run unit tests, release lint, the debug APK build, and the release bundle build. Individual commands are:

```powershell
./gradlew.bat :app:testDebugUnitTest
./gradlew.bat :app:lintRelease
./gradlew.bat :app:assembleDebug
./gradlew.bat :app:bundleRelease
```

Expected outputs:

- debug/internal APK: `app/build/outputs/apk/debug/app-debug.apk`;
- release Play bundle: `app/build/outputs/bundle/release/app-release.aab`;
- test report: `app/build/reports/tests/testDebugUnitTest/index.html`;
- lint HTML/SARIF: `app/build/reports/lint-results-release.html` and `.sarif`.

The debug build has application ID `com.nuc7.threeaikgpt.debug` and is signed by the local Android debug key. With no upload-key environment variables, the release AAB is intentionally **unsigned**. It is not uploadable to Play until signed with the Play upload key; see [RELEASE.md](RELEASE.md).

## Device smoke test

No emulator image is bundled. With an Android 8.0+ device connected and USB debugging enabled:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.nuc7.threeaikgpt.debug/com.nuc7.threeaikgpt.MainActivity
```

Use [SMOKE_TEST.md](SMOKE_TEST.md) for the manual checks that require a real WebView/device, including file providers, offline transitions, blob export, external browser handoff, accessibility, and process recovery.

## Project layout

```text
apps/android/
├── app/src/main/java/...       Kotlin activity and security/download policies
├── app/src/main/res/...        UI, theme, adaptive icon, backup/network policy
├── app/src/test/...            URL and download-policy unit tests
├── gradle/wrapper/...          pinned, checksum-verified Gradle wrapper
├── gradle/verification-metadata.xml  committed dependency checksums
├── ci.ps1 / ci.sh              CI-friendly verification entry points
├── PLAY_STORE.md               listing and Play Console checklist
├── PRIVACY.md                  Android privacy disclosure
├── RELEASE.md                  upload-key signing/release procedure
└── SECURITY.md                 threat model and controls
```

## Release limitations

- The hosted service is a release dependency. A compromised or policy-noncompliant production site remains a product risk even though native navigation and privileges are constrained.
- Android System WebView is an updatable system component. Blob export requires `WEB_MESSAGE_LISTENER`; the app gives a browser fallback message if an obsolete provider lacks it.
- The app does not certificate-pin `3aik.com`; it uses the Android system trust store so normal certificate rotation continues to work. TLS errors are never bypassed.
- Google Play needs the implemented `https://3aik.com/privacy` route deployed and verified publicly, plus completed Data safety answers, screenshots, support contact, content rating, and an upload-key signature. These are publisher/deployment actions, not build artifacts.
