# 3aik privacy model

3aik has two distinct model-provider modes.

## 3aik Cloud

The browser stores conversation history and generated media locally on the device. When a user sends a message, the prompt, selected attachments, recent conversation context, and custom instructions are transmitted to the 3aik Cloudflare Worker and processed by Cloudflare Workers AI. The 3aik application does not write those conversation payloads to a database or object store.

Operational infrastructure may still process request metadata and logs under Cloudflare's policies and the account's configuration. “Local history” does not mean “offline inference.” Users should avoid submitting secrets or regulated data unless the deployed service has been reviewed for that use.

The random `x-3aik-device` value is used as a soft abuse-control identifier. It is not an account, credential, or cross-device identity.

## Local models

When a CLI or desktop user selects an OpenAI-compatible local provider, model prompts and tool results are sent only to the configured endpoint. Presets are provided for loopback-hosted Ollama, LM Studio, and llama.cpp servers. A custom endpoint may be remote; its operator's privacy terms then apply.

Local agent tools still read files and run approved commands on the user's computer. Their outputs become model context, so the selected model provider can see that context.

## Android client

`3aikGPT: AI, On Your Terms` is a native Android shell for the same 3aik Cloud web workspace; it does not run a local model. Android cloud backup and device-to-device transfer are disabled for its app-private data. It requests Internet and network-state permissions only, contains no native advertising or analytics SDK, and uses Android's system document picker for user-selected import and export locations.

The Android privacy panel can erase the app's cookies, site storage, network cache, and service-worker data on supported System WebView versions. On an obsolete provider that cannot confirm complete deletion, the app offers Android's full app-data erasure flow instead of reporting a partial cleanup as complete. Exported files outside app-private storage are not deleted by either operation. The canonical public policy is [https://3aik.com/privacy](https://3aik.com/privacy); verify the deployed policy and production data flow before every Play submission.

## Deletion and export

Browser users can delete a thread or clear all local history. Workspace backup/export is initiated by the user and saved as a local file. Uninstalling a client does not delete files that the coding agent intentionally created in a selected workspace.
