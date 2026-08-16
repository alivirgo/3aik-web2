# Production operations

## Model and cost gates

- Use a Workers Paid account before expecting the Kimi K2.6, Kimi K2.7 Code, GLM 5.2, or FLUX.2 Klein 9B primaries to run. Every route has a lower-tier fallback, but fallback availability is not a substitute for a production canary.
- Configure Workers AI usage notifications and a budget acceptable to the operator before public promotion. Review Neuron and dollar usage daily during launch week.
- Keep the per-device and per-network limits in `wrangler.jsonc` enabled. They are an abuse brake, not authentication; distributed callers can still consume capacity.
- Add a server-verified challenge such as Turnstile or authenticated quotas before raising limits, enabling high-cost features at scale, or running a marketing campaign.

## Release canaries

After every production deployment, run `npm run smoke:production -- https://3aik.com --image` and confirm:

- Ask, Deep, Code, Agent, and Image each return a request ID.
- `x-3aik-model` identifies the model that actually served the response.
- FLUX.2 is preferred and FLUX.1 remains a working fallback.
- the download counter reads only published GitHub release assets;
- excessive requests return `429` and `Retry-After: 60` before inference.

Cloudflare dashboard access is required to verify billing, model entitlement, observability, and production logs. Never commit account tokens, upload keys, signing certificates, `.dev.vars`, or Wrangler state.

## Android release operations

- Treat the Android client, `https://3aik.com/privacy`, and the live site's CSP/security headers as one release unit. The native shell cannot compensate for a compromised or materially changed production origin.
- Keep the upload keystore only in the protected `android-release` GitHub Environment or an approved signing system. Configure all five `THREEAIK_UPLOAD_*` secrets together and require environment review for tagged releases.
- Record the signed AAB SHA-256 and upload-certificate SHA-256 from the generated Android report. Never substitute an `UNSIGNED-NOT-FOR-PLAY` workflow fallback for a Play upload.
- Retain each release's R8 mapping file for crash de-obfuscation and support. Restrict access if future mappings reveal sensitive internal naming.
- Run the Play release first on an internal track, then review pre-launch and policy results before staged production rollout.
