# Android device smoke test

Record device model, Android version, Android System WebView version, network state, build hash, and pass/fail evidence.

## Launch and disclosure

- Fresh-install the debug APK and confirm the launcher label is `3aikGPT: AI, On Your Terms`.
- Confirm the branded green/black adaptive icon and Android 12+ splash screen render correctly under square, circle, squircle, and themed-icon masks where available.
- Confirm first launch blocks on the “AI, on your terms” disclosure and that it accurately distinguishes on-device history from Cloudflare AI processing.
- Rotate, resize, change font/display scale, and switch system dark/light mode; verify no content or composer state is lost.

## Workspace and accessibility

- Exercise chat, reasoning, code, image, thread branch, settings, search, and long-response scrolling.
- Navigate every control with TalkBack and switch access. Confirm toolbar/menu/error/retry controls have useful names and focus order.
- Test 200% font scale, display magnification, large touch targets, keyboard input, and visible focus.
- Confirm Android back goes through workspace history before exiting and does not trap the user.

## Files and exports

- Pick one and multiple images through Files, Photos, and another installed document provider; confirm no storage permission prompt appears.
- Cancel the picker and confirm the composer remains usable.
- Import a valid workspace backup; reject malformed/oversized backups as the hosted app specifies.
- Export Markdown, a generated image, and a workspace backup. Confirm Android asks for each destination, exact bytes open correctly, and no broad storage permission appears.
- Cancel an export and confirm no partial output remains. Interrupt network and same-origin HTTP downloads and confirm failure is reported.

## Security and boundaries

- Click a `https://github.com` link: the app must show the destination host and, only after confirmation, open the external browser.
- Test a `mailto:` link with the same confirmation behavior.
- Attempt `http://`, `file://`, `content://`, `javascript:`, `intent://`, `https://3aik.com.evil.example`, and `https://3aik.com:8443`; each must remain blocked.
- Confirm web requests for camera, microphone, and location are denied with no runtime permission dialog.
- Confirm release WebView remote debugging is unavailable.
- Use a controlled TLS/Safe Browsing test environment before production release; never bypass a certificate warning.

## Offline and lifecycle

- After one successful load, go offline. Confirm cached/local workspace behavior is usable where the service worker supports it and cloud-AI status is honest.
- Cold-start offline and confirm the native offline/retry screen says local data was not deleted without promising that uncached UI is available.
- Restore connectivity and retry successfully.
- Background/foreground during streaming, picker, export, and external-browser handoff.
- Use Developer Options to terminate activities/processes and exercise WebView renderer termination; confirm the native recovery screen appears and retry creates a fresh safe WebView.
- Clear local app data from the native menu and verify threads, media, site preferences, cookies, IndexedDB/local storage, Cache Storage, installed service workers, and cached page data are gone while an externally exported file remains. Confirm success appears only after deletion completes and the workspace is rebuilt.
- On a test image with a WebView provider that does not expose `DELETE_BROWSING_DATA`, verify the app shows the full-erasure warning instead of a success message; accepting it must let Android close the app and clear all app-private data.

## Release acceptance

- Install the debug APK only for smoke testing; never distribute it as production.
- Verify the final AAB upload-key certificate and SHA-256 using [RELEASE.md](RELEASE.md).
- Inspect the Play pre-launch report on phone/tablet form factors before rollout.
