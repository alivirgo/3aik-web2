# 3aikGPT Android privacy disclosure

Developer: **NUC7 Studios**

App: **3aikGPT: AI, On Your Terms**

This document describes the Android client. The repository implements the canonical public service policy at `https://3aik.com/privacy`, and the native **Privacy & local data** dialog links to it; reconcile this Android disclosure with that reviewed policy and verify its production deployment before Google Play publication.

## Data kept on the device

The hosted workspace stores conversation threads, drafts, preferences, selected-attachment metadata, and generated media in the app’s private WebView storage when remembered history is enabled. The Android app disables its own cloud backup and device-transfer backup. Other apps cannot normally read its private app storage.

Users can:

- disable remembered history, export a workspace, delete a thread, or clear workspace history through the hosted Workspace settings;
- choose individual documents through Android’s picker without granting broad storage access;
- choose every export/download destination;
- clear app-held WebView storage (including local storage and IndexedDB), cookies, authentication data, network/Cache Storage data, and installed service workers through **Privacy & local data → Clear local app data**;
- use Android Settings to clear all app storage or uninstall the app.

Exported files are outside app-private storage and are not deleted by clearing or uninstalling the app.

The native action waits for AndroidX's complete browsing-data deletion callback before it reports success. If the installed System WebView cannot provide that complete API, the app explains the limitation and, only after a second confirmation, uses Android's full application-data erasure. That fallback closes the app and also resets native onboarding preferences; it does not delete exported files.

## Data sent for cloud processing

When a user submits a cloud request, the prompt, selected attachments, recent conversation context, custom instructions, and a random site device identifier are transmitted over HTTPS to 3aik. The hosted service processes model requests through Cloudflare Workers AI. Operational infrastructure can also process request metadata and logs under its configuration and Cloudflare’s terms.

Local history does not make that inference offline or accessible only to the user. The Android client does not provide a local-model mode and should not be described as end-to-end encrypted or fully private. Users should not submit secrets, regulated data, or third-party personal data unless the deployed service has been reviewed and authorized for that use.

## Native app behavior

The native shell includes no advertising, analytics, crash-reporting, account, social, or location SDK. It requests only Internet and network-state permissions. It denies camera, microphone, and location requests from web content. Confirmed external links open another app and are then subject to that app’s privacy practices.

File and blob export bytes pass through app memory only while writing to the user-selected document. The app does not upload those exports elsewhere. Failed partial documents are deleted when the selected document provider supports deletion.

## Google Play disclosure preparation

Google Play Data safety answers should conservatively disclose user-generated prompt/attachment content as transmitted for app functionality and AI responses, even if server application code does not intentionally persist message bodies. Treat Cloudflare as a service provider only after the applicable contract and Google Play’s current definition of “sharing” have been reviewed. Confirm actual infrastructure log/retention, deletion, security, children/families, and regional requirements before answering the form.

The canonical `https://3aik.com/privacy` route is implemented in the repository with NUC7 Studios identity/contact information, processing-provider disclosures, retention/deletion details, and user rights. Before launch, verify that route is deployed over HTTPS, review it against the production service and contracts, and confirm any jurisdiction-specific legal bases, international-transfer terms, security practices, and request procedure remain accurate. Do not submit a URL that is not yet reachable in production.
