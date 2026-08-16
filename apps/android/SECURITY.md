# Android security model

## Assets and trust boundaries

The native application protects:

- locally stored WebView conversations, preferences, drafts, and generated media;
- user-selected input documents and export destinations;
- the user’s expectation that only the production 3aik origin appears inside the app;
- the Android process from untrusted web privileges.

The native code trusts the Android OS, Android System WebView, the system certificate store, the installed document providers the user selects, and the exact `https://3aik.com` production origin. Cloudflare/3aik processing is outside the local-data boundary.

## Controls

- Network Security Config and the manifest reject cleartext traffic.
- Navigation compares parsed, IDN-normalized host, scheme, user info, and effective port; it never uses suffix matching.
- Directly observed non-production subresource requests are returned a synthetic `403`, including Service Worker requests when supported; final resource URLs surfaced through `onLoadResource` also stop the document.
- TLS errors are cancelled. Safe Browsing hits return to safety.
- External HTTPS and `mailto:` links require a user gesture and confirmation, and are sent only to browsable external intents. Other schemes are blocked.
- Direct WebView file/content access and mixed content are disabled.
- Local-data erasure uses the feature-gated complete AndroidX browsing-data API and reports success only from its completion callback. Providers without that API fall back, after an explicit second confirmation, to Android's complete app-data erasure rather than the incomplete legacy WebStorage deletion call.
- File selection is an `ACTION_OPEN_DOCUMENT` request. Only returned `content://` grants are passed to WebView; at most eight selections are returned.
- Regular downloads must remain on the production HTTPS origin through every redirect, are capped at 150 MB, and stream to an `ACTION_CREATE_DOCUMENT` result on a background worker.
- Blob downloads use a single-purpose, origin-restricted `WebMessageListener`, bounded metadata/chunks, one active transfer, exact byte-count validation, and a user-selected destination. Partial output is deleted on failure when the document provider permits it.
- No generic JavaScript/native, filesystem, command, account, credential, camera, microphone, location, or IPC bridge exists.
- Release WebView debugging is disabled; R8 shrinking/optimization is enabled.
- App data is excluded from cloud backup/device transfer.

## Residual risks

- The production origin can see content that users submit and can request a user-approved export. Native origin controls do not make a compromised first-party website trustworthy.
- Android WebView does not expose every subresource redirect hop to `shouldInterceptRequest`. The native client adds a final-URL callback check, but complete containment relies on the production document retaining a restrictive `default-src 'self'; connect-src 'self'` CSP. Treat loss or weakening of that header as a release blocker.
- The random website device identifier and infrastructure metadata may be visible to 3aik/Cloudflare.
- The app relies on the system WebView and certificate trust store; users should keep Android System WebView and their OS updated.
- A document provider controls the semantics of the URI a user selects. The app never obtains broad storage access.
- The 150 MB limit bounds each download, not total locally stored WebView history. Android storage settings remain the final OS-level control.
- Application guardrails are not a substitute for a server-side security review, CSP, dependency monitoring, abuse controls, incident response, or a published privacy policy.

## Release review

Before every release:

1. Run `ci.ps1` or `ci.sh` and keep lint warnings fatal.
2. Review dependency and target-SDK release notes.
3. Confirm `OriginPolicy.APP_ORIGIN` and the Network Security Config still name only `3aik.com`, and verify the live document still serves origin-restricted `default-src`, `connect-src`, `script-src`, `style-src`, `img-src`, `form-action`, and `base-uri` CSP directives.
4. Inspect the merged release manifest and verify that no new dangerous permission or exported component was introduced.
5. Test import/export, offline recovery, TLS/Safe Browsing behavior, external links, accessibility, rotation, and WebView renderer recovery on a supported device.
6. Sign only in the protected release environment and verify the AAB signature/certificate before upload.

Report security issues privately through the publisher’s security contact. Add the production contact to the Play listing and public security policy before launch; do not ask reporters to post exploitable details publicly.
