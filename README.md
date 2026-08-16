# 3aik

3aik is a no-login AI workspace for chat, deeper reasoning, coding help, and image generation. It runs as a Cloudflare Worker and uses Workers AI, with a dependency-free browser client.

## Product principles

- Honest capabilities: only models verified on the deployed Cloudflare account are shown.
- Local first: text history is stored in `localStorage`; generated images use IndexedDB. Nothing is presented as an account or cloud sync.
- Safe rendering: model output is rendered with a small DOM-based Markdown formatter. Raw model HTML is never inserted into the page.
- Graceful control: streaming responses can be stopped, copied, searched locally, or removed per thread.
- Accessible by default: semantic controls, visible focus states, native dialogs, reduced-motion support, and responsive navigation.

## Local development

Requires Node.js 24 or newer.

```bash
npm ci
npm run dev
```

Run the complete pre-deploy check:

```bash
npm run check
```

## API

- `GET /api/health` — public capability and readiness metadata.
- `POST /api/chat` — validated streaming chat for `chat`, `deep`, and `code` modes.
- `POST /api/image` — validated FLUX image generation returning a PNG body.

All API errors use `{ "error": { "code": string, "message": string } }` and browser assets receive a restrictive Content Security Policy.

## Deployment

```bash
npm run deploy
```

The production Worker must have an `AI` binding. Static assets are served from `public/` through the `ASSETS` binding.
