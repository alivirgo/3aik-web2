# Google Play listing and Console notes

## Listing copy

**App name (exact)**

3aikGPT: AI, On Your Terms

**Developer name**

NUC7 Studios

**Category**

Productivity

**Short description**

Think, code, and create with local history and clear cloud-AI boundaries.

**Full description**

3aikGPT brings the 3aik workspace to Android for thoughtful chat, deeper reasoning, coding help, image creation, and multimodal attachments—without requiring an account.

AI, on your terms means real controls and an honest boundary:

• Conversation history, drafts, preferences, and generated media can stay in this app’s local web storage.

• Choose what to send, choose documents with Android’s private system picker, export or delete threads, disable remembered history, or clear the app’s local web data.

• When you use Cloud mode, submitted prompts, selected attachments, recent context, and custom instructions are sent securely to 3aik and processed with Cloudflare Workers AI. Local history does not mean cloud inference happens offline or is visible only to you.

The Android app is a hardened window onto the production 3aik.com workspace. It blocks insecure connections and mixed content, keeps other websites out of the in-app view, confirms external links, enables Android Safe Browsing, and never asks for camera, microphone, location, contacts, broad storage, notification, advertising-ID, or account permissions.

Highlights:

• Streamed AI chat and deeper reasoning

• Coding and implementation help

• Image generation and multimodal file selection

• Local conversation history with export/delete controls

• Native offline, retry, download, back-navigation, and external-link handling

• No ads and no native analytics SDK

AI can make mistakes. Verify important output and avoid sending sensitive or regulated information unless your use has been reviewed.

## Suggested release notes for 3.0.0

First Android release of the 3aikGPT workspace, with multimodal file selection, local-history controls, safe downloads and external links, offline recovery, Android Safe Browsing, accessibility support, and a clear cloud-processing disclosure.

## Play Console checklist

- Package/application ID: `com.nuc7.threeaikgpt`.
- Default language: English (United States), unless the publisher supplies localized copy.
- App or game: App.
- Free or paid: publisher decision; changing free to paid later is restricted by Play.
- Ads: No, based on the current native and hosted implementation. Re-review the live site at release time.
- App access: all functionality is available without login. Describe any future gated route accurately.
- Target audience: general productivity audience; do not select children unless Families requirements and the AI experience have been separately reviewed.
- Content rating: complete the IARC questionnaire, including unrestricted web/AI-generated content questions accurately.
- News, health, finance, government, VPN, accessibility service, background location, exact alarm, and photo/video broad-access declarations: not applicable to this build.
- Permissions: Internet and network state only; the AndroidX signature-only dynamic-receiver permission is internal and not user-granted.
- Privacy policy: use the canonical `https://3aik.com/privacy` route implemented in this repository and linked from the native **Privacy & local data** dialog. Verify the production deployment returns the reviewed policy over HTTPS before entering it in Play Console or submitting the release.
- Data safety: use the conservative draft in `PRIVACY.md`; verify live server processing, Cloudflare contract/configuration, logging, retention, deletion, and Google’s current definitions before submission.
- Data deletion: explain native **Privacy & local data → Clear local app data** (complete cookies, JavaScript storage, cache, and service-worker removal on current WebView; full Android app-data erasure fallback on unsupported providers), hosted thread/history controls, Android clear-storage/uninstall behavior, and the separate process for any server/infrastructure request metadata.
- Store assets: supply phone screenshots of real production UI, a 512×512 PNG icon derived from the included adaptive icon, a 1024×500 feature graphic, and optional tablet screenshots. Do not show capabilities or privacy guarantees the app does not provide.
- Support: add a monitored support email, website, and security contact owned by NUC7 Studios.
- Countries/regions, pricing, declarations, and tax: publisher decisions.
- App signing: enroll in Play App Signing, register the upload certificate, and upload only a verified upload-key-signed AAB.
- Testing: complete Play’s currently required closed/production testing track and tester requirements for the publisher account type.

## Suggested Data safety mapping (review, do not copy blindly)

| Play category | Current behavior | Suggested treatment |
| --- | --- | --- |
| User-generated content | Prompts, context, custom instructions, attachments sent for AI functionality | Disclose as collected/transmitted for app functionality; mark optional where user controls submission; review ephemeral-processing eligibility |
| Device or other identifiers | Random `x-3aik-device` soft abuse-control value | Disclose under the closest current identifier category if Google’s form requires it |
| App activity | Conversation interaction may appear in operational request metadata/logs | Verify infrastructure first; disclose conservatively |
| Files and docs / photos | Only documents the user chooses; transmitted when attached to a cloud request | Disclose only the applicable current categories and purposes |
| Crash/analytics/ads | No native SDK in this build | Mark not collected only after verifying the production web origin has not added such scripts |

Cloudflare acting as a contracted service provider may not count as “sharing” under Play’s definition, but that conclusion requires contractual and current-policy review. Do not state that data is never collected merely because the app’s own database does not persist conversation bodies.

## Title/package decision record

The product instruction originally specified `com.nuc7.3aikGPT`. Android application-ID rules reject any segment beginning with a digit, and Google Play cannot accept it. The production ID is therefore `com.nuc7.threeaikgpt`. The user-facing name remains exactly `3aikGPT: AI, On Your Terms`.
