# 3aik News

`/ai-news` is a server-rendered news desk on the existing 3aik Worker. It does not change the home page, the chat API, or the privacy page. `AI_NEWS_PUBLISHING` is `on` in `wrangler.jsonc`, so the cron still prunes. `AI_NEWS_GENERATOR` is `off`, so that cron does not call Workers AI and does not spend neurons. New articles are posted to `POST /ai-news/api/ingest`. A missing publishing value is still off, and while publishing is off the cron returns before it opens D1 or GitHub. Read routes still serve pages: a missing database becomes an empty list, an empty feed, or a 404 for one story, not a 500. The D1 binding `AI_NEWS_DB` points at database `3aik-ai-news` (`87a550eb-1752-4cec-8c20-dd6b839099e2`, region WEUR). Migrations `0001` through `0003` are applied, the image repo has a first commit on `main`, and `GITHUB_IMAGES_TOKEN` is set. Merging to `main` is what publishes the worker. See External ingest.

## What readers are told

Articles are written with AI assistance and checked by the desk rules before publishing. The 24 bylines are editorial personas, not real people. Bios describe a beat and a voice. They do not claim a degree, an employer, or a human career.

An article carries one short line, “Written with AI assistance from cited reporting.” Index, section, and author pages carry that same line once in the footer. The source line is “Source:” plus the publisher link. [/ai-news/disclaimer](https://3aik.com/ai-news/disclaimer) still holds the accuracy note. [/ai-news/about](https://3aik.com/ai-news/about) explains the personas and the check.

## One-time resources

From the repo root, with Wrangler logged into the 3aik account:

The D1 database already exists. Binding name `AI_NEWS_DB`, database name `3aik-ai-news`, id `87a550eb-1752-4cec-8c20-dd6b839099e2`.

```sh
npx wrangler d1 migrations apply 3aik-ai-news --remote
```

Images are files in the public repo [alivirgo/3aik-ai-news-images](https://github.com/alivirgo/3aik-ai-news-images). Create that public repo and put a first commit on `main` before the cron runs. The Contents API answers 409 on a repository that has no commits, so an empty default branch cannot receive the first image. Adding a README when you create the repo is enough.

Create a fine-grained personal access token with **contents: write** on that repo only. Grant the token no other repository. GitHub requires an expiry on a fine-grained token (at most one year). When it expires, image commits fail and articles still publish with no picture until you mint a new token and run `npx wrangler secret put GITHUB_IMAGES_TOKEN` again. Keep the token out of git and out of `wrangler.jsonc`. Set a reminder before the expiry date.

```sh
npx wrangler secret put GITHUB_IMAGES_TOKEN
```

Paste the token when prompted. For local dev, put the same name in `.dev.vars` (gitignored). See `.dev.vars.example`. If the secret is missing, or a commit fails, the article is still published with no image.

`AI_NEWS_PUBLISHING` is already `on` in `wrangler.jsonc`. Leave it on. A one-off `wrangler deploy --var AI_NEWS_PUBLISHING:on` is replaced by the next deploy of this file, so the file is what keeps publishing on.

Local equivalents:

```sh
npx wrangler d1 migrations apply 3aik-ai-news --local
npx wrangler dev --test-scheduled
```

Trigger one cron tick locally (Wrangler 4.123, the version in this repo):

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=7+*+*+*+*"
```

Deploy when you are ready. Do not treat a dry run as a deploy.

```sh
npx wrangler deploy
```

Bindings added to `wrangler.jsonc`:

| Binding | Kind | Name |
| --- | --- | --- |
| `AI_NEWS_DB` | D1 | `3aik-ai-news` |
| `AI` | Workers AI | already on the worker |
| `GITHUB_IMAGES_TOKEN` | Secret | contents:write on `alivirgo/3aik-ai-news-images` only |
| `AI_NEWS_INGEST_TOKEN` | Secret | Bearer token for `/ai-news/api/ingest` only. It does not open the stats desk. Already set in production. |
| `AI_NEWS_STATS_TOKEN_SHA256` | Optional var | SHA-256 hex of the stats bearer. When unset, stats auth uses the digest in `src/news/stats.ts`. Do not put the bearer in git. |

Article rows, source URLs, and rotation counters are in D1. Migrations: `migrations/0001_ai_news_init.sql`, `migrations/0002_ai_news_rejections.sql`, `migrations/0003_ai_news_image_commit.sql` (adds `image_commit`), `migrations/0004_ai_news_image_credit.sql` (`image_credit`, `image_source_url`), `migrations/0005_ai_news_pageviews.sql` (reader stats), `migrations/0006_ai_news_stats_bounds.sql` (daily HMAC salt, bot, 404, and feed counters), and `migrations/0007_ai_news_stats_rollups.sql` (hourly article rollups, click rollups, and the D1 fallback write budget). Workers Builds does not apply D1 migrations. `0007` has not been applied to the remote database from this branch. After this change is on `main`, run:

```sh
npx wrangler d1 migrations apply 3aik-ai-news --remote
```

Until that command succeeds, article reads still work (new image columns are probed) and the stats pages come back empty rather than 500. Illustrations are PNG, WebP, or JPEG files at or under 1 MB, committed to `images/YYYY/MM/<slug>-<8-char-id>.webp` (JPEG uses `.jpg`, PNG uses `.png`) through the GitHub Contents API. The suffix is the first 8 characters of the article id, so a leftover file from a failed delete does not block a later article that reuses the title. The desk stores `commit.sha` from the create response in `image_commit`. It does not store the blob sha, and it does not pin `@main`.

## Rate, schedule, and pause

`AI_NEWS_ARTICLES_PER_HOUR` is the cap for the whole site, not per category. It starts at `"1"`. Set it to `"2"` for the top of the initial range, then higher later. Values above 8 are clamped to 8. `0` publishes nothing.

Cron ticks are `7 * * * *` and `37 * * * *` (minute 7 and minute 37, UTC). Each tick publishes at most `ceil(rate / 2)` articles, and never more than the room left in the current UTC hour. A rate of 1 publishes on the first tick that still has room and skips the other. A rate of 2 publishes one article on each tick. A rate of 4 publishes up to two per tick.

Publishing runs when `AI_NEWS_PUBLISHING` is `on`, `true`, `yes`, or `1`. The checked-in value is `on`. A missing value is off. `false`, `paused`, and `0` also pause. Prefer the config file. A dashboard-only edit can be overwritten by the next `wrangler deploy`.

While paused, the cron does not take the publish lock and does not read or write D1 or GitHub. `/ai-news` still serves pages, feeds, and sitemaps from D1 when the database exists. If the database is missing, lists and feeds are empty and a story URL returns 404.

## Spend, time, and retention

Each tick has a hard model budget. Defaults, all overridable in `wrangler.jsonc`:

| Var | Default | Meaning |
| --- | --- | --- |
| `AI_NEWS_TEXT_CALLS_PER_ARTICLE` | 6 | Text `AI.run` calls per article slot this tick. A 3-model cascade counts one call per model. |
| `AI_NEWS_IMAGE_CALLS_PER_ARTICLE` | 2 | Image calls per slot. The budget is at least the two configured image models, so the FLUX.2 Klein 9B fallback still runs when the hourly rate is 1. Schnell is first (about 58 neurons). Klein is about 1,364. |
| `AI_NEWS_MAX_FAILURES` | 2 | Stop the tick after this many failed stories in a row. |
| `AI_NEWS_REJECT_TTL_HOURS` | 24 | How long a content or quality rejection blocks that source URL. Budget, wall-clock, and timeout failures block it for 1 hour. A missing image, a failed image model, or a failed GitHub commit does not block the source: the article publishes with no picture. |
| `AI_NEWS_WALL_MS` | 300000 | Stop starting new work after this much wall time. Values above 900000 are clamped. A scheduled handler may run for 15 minutes. |
| `AI_NEWS_TEXT_TIMEOUT_MS` | 60000 | Per text call. Values above 180000 are clamped. GPT OSS on medium reasoning effort needs about a minute. |
| `AI_NEWS_IMAGE_TIMEOUT_MS` | 20000 | Per image call. |
| `AI_NEWS_RETENTION_DAYS` | 180 | Delete articles older than this during a publish tick. `0` disables cleanup. |

The run budget is the per-article number times the slots for that tick, clamped (24 text calls, 8 image calls). Each image slot still gets at least one try per configured image model. Text output is capped at 8192 tokens. On gpt-oss, reasoning tokens count against that cap, so the cap has to leave room for the article after a medium reasoning pass.

Each `AI.run` passes `{ rejectIfBusy: true }`, so a busy model fails instead of waiting in a capacity queue. The desk also stops waiting after the per-call timeout. That timer does not cancel inference that has already started, so a timed-out call may still be billed.

The publish lock is taken before retention pruning and is still held when the model clock starts. It lasts at least 900 seconds, the scheduled-handler limit. It is also longer than pruning (five GitHub deletes, two timed requests each, plus the pause between them), longer than the worst case of every budgeted call hitting its timeout, and longer than the wall clock, plus 60 seconds, when that sum is greater.

Failed source URLs live in `source_rejections` (`migrations/0002_ai_news_rejections.sql`). Expired rows are deleted at the start of a publish tick. Articles older than the retention window are deleted in batches of 20. The D1 row is deleted first, then the GitHub file, so a failed image delete cannot leave a story that points at a missing file. Lifetime author counters stay, so rotation does not restart. To clean by hand:

```sql
DELETE FROM article_sources WHERE article_id IN (SELECT id FROM articles WHERE published_at < '2026-01-01T00:00:00.000Z');
DELETE FROM articles WHERE published_at < '2026-01-01T00:00:00.000Z';
DELETE FROM source_rejections WHERE expires_at <= datetime('now');
```

Delete the matching `images/YYYY/MM/<slug>-<8-char-id>.webp`, `.jpg`, or `.png` file from `alivirgo/3aik-ai-news-images` as well. The Contents API call is skipped when `GITHUB_IMAGES_TOKEN` is unset. Files over 1 MB, and anything that is not PNG, JPEG, or WebP, are not uploaded. Lossy WebP (the `VP8 ` chunk), lossless `VP8L`, and extended `VP8X` are all accepted.

A 422 from GitHub means the path already exists. If those bytes match the file being uploaded, the desk reuses the commit SHA from the commits list and does not write again. If the bytes differ, the existing file is left alone and the article is published with no image. A network error during that lookup is caught inside the upload, so the draft is kept and the article still publishes with no image.

A 429 is a rate limit. A 403 is a rate limit only when the remaining budget is 0, `Retry-After` is set, or the body names a secondary rate limit or abuse detection. A plain permission 403 does not pause the tick. The desk does not sleep through `Retry-After` (a long wait would run past the tick wall). It stops further Contents API calls for that tick and logs the delay. Further image commits in that tick are also skipped when fewer than 20 requests remain on the token.

Retention asks D1 for up to 20 old rows, then deletes at most 5 GitHub files in that tick, with 250 ms between those deletes. `deleteImageFile` returns whether GitHub asked for a pause. On a pause, retention stops and that tick does not commit a new image. The row already removed can leave its file in the repo. Later rows stay until a later tick. Image model calls stay inside `AI_NEWS_IMAGE_CALLS_PER_ARTICLE`.

Readers load `/ai-news/media/<commit-sha>/images/YYYY/MM/<slug>-<8-char-id>.webp` (or `.jpg` / `.png`). The Worker proxies that file only when D1 has the same `image_key` and `image_commit`. An unknown key is a 404 with `cache-control: public, max-age=60` and is not fetched from jsDelivr, so a stranger cannot force unlimited CDN reads. A D1 error, and a failed fetch for a key that does exist, is `no-store`. `HEAD` on a known image returns the stored content type and an empty body. It does not download the file. A known `GET` fetches that one path from jsDelivr at the commit SHA (`cdn.jsdelivr.net` or `fastly.jsdelivr.net`, and only when the URL still names this repo and that same SHA). `@main` is not used: jsDelivr caches a branch tip for about 12 hours, and a year-long immutable response would keep serving a moving file. The write token is not sent on that read. A successful image is answered with `cache-control: public, max-age=31536000, immutable`. News HTML keeps `img-src 'self'`. Image responses use `default-src 'none'`. `cdn.jsdelivr.net` is not in the page policy, so a story cannot embed the CDN directly.

## Taking an image down, and repo growth

A published image stays in two public places. Git history of `alivirgo/3aik-ai-news-images` keeps the blob at the commit SHA stored in D1. Deleting the file on `main` does not remove that commit. The Worker edge cache can also keep a successful response for one year.

To take one image down:

1. Rewrite history so the blob is gone (`git filter-repo` or BFG), then force-push `main`. A normal delete commit is not enough, because readers pin the old SHA.
2. Clear `image_key` and `image_commit` on the D1 row, or delete the article. The proxy only fetches a path that D1 still lists, so clearing the row stops new origin fetches.
3. Purge the Cloudflare cache for `https://3aik.com/ai-news/media/<old-sha>/images/...`. A cached 200 is not replaced by the 60 second 404 that an unknown key gets later. Until the purge, the edge can still serve the picture.

At about one image an hour, under the 1 MB cap, the repo grows on the order of 1 to 3 GB a year once git objects and history are counted. Plan a new public repo when this one approaches 1 GB (GitHub's recommended repository size, and a more comfortable size for jsDelivr). Point new commits at the new repo, for example one repo per year, and leave old SHAs in the old repo so published URLs keep working. `IMAGE_REPO` is a constant in `src/news/github-images.ts` today, so that split is a later code change. Do not rewrite old commits only to move them.

## Feeds

Each fetch follows at most three redirects, and only to `https` on the same site. A `www` host and its apex count as the same site. Any other hostname does not. The response must be `xml`, `rss`, or `atom` (`text/xml`, `application/xml`, `application/rss+xml`, `application/atom+xml`, `application/rdf+xml`, `text/rss`). The body is streamed and dropped above 2 MB. An item with no publication date is stale and is not used.

## Models

Text, in order, via the existing `AI` binding. These models are available on the Workers Free plan:

1. `@cf/openai/gpt-oss-120b` (primary). The binding call uses the Responses shape: `instructions`, `input`, `max_output_tokens` of 8192, and `reasoning.effort` set to `medium`. Reasoning tokens count against `max_output_tokens`. A chat `messages` body is valid too. GLM and Gemma keep the messages shape and the same output cap.
2. `@cf/zai-org/glm-4.7-flash`
3. `@cf/google/gemma-4-26b-a4b-it`

`@cf/moonshotai/kimi-k2.6` is not in the chain. On the Workers Free plan it returns error 5035 and never writes a draft. Streaming is not used: the desk needs the whole JSON object before it can publish, so a stream would not shorten the wait.

Image, cheapest first on the Free plan:

1. `@cf/black-forest-labs/flux-1-schnell` (about 58 neurons). The call sends `prompt` and `steps` only.
2. `@cf/black-forest-labs/flux-2-klein-9b` (about 1,364 neurons, multipart prompt, width and height 1024)

Workers AI error 3036 means the daily free neuron allocation is used up. That error stops the tick. The desk does not call the next model and does not start another story. Checked against the Workers AI catalog (gpt-oss-120b, GLM 4.7 Flash, Gemma 4 26B A4B, FLUX.1 Schnell, FLUX.2 Klein 9B). Illustrations are abstract. Prompts are rejected if they ask for a person, a face, or a logo. No extra API key is required for Workers AI.

## Sources and the quality gate

Feeds are listed in `src/news/config.ts` (The Verge, TechCrunch, MIT Technology Review, BBC News, Ars Technica, WIRED, The Guardian, Vogue, WWD, Variety, Deadline). Each run fetches a rotating subset. A story older than 96 hours is skipped. A source URL is stored once, so the same story is not published again.

Before a row is inserted the draft must:

- contain no em dash (U+2014), no en dash used as a clause break, no figure dash, minus sign, or two-em dash (U+2012, U+2212, U+FE58, U+FE31, U+2E3A), and no `---` or spaced `--`
- avoid the slop list in `src/news/quality.ts` (`delve`, `in today's fast-paced`, `game-changer`, `it's worth noting`, `tapestry`, `landscape`, `in conclusion`, and the rest of that list)
- be 400 to 1100 words, with at least eight sentences, one of 12 words or fewer, one of 25 words or more, and an uneven rhythm
- not copy an 8-word sequence from the source title or excerpt. A window is ignored only when it is a comma-separated list of proper nouns, such as brand names. Title Case headlines, ALL CAPS headlines, and any other 8-word sequence still fail.
- not repeat a title or a source URL, and not be too similar to a recent article
- name the outlet in the body
- for fashion and showbiz, attribute disputes in the same sentence as the claim

Failures are logged as JSON. The next attempt is told the exact reason codes and what to change (word count, attribution, description length, FAQ length, banned wording, and that a sequence was copied), up to three times per story. The copied words themselves are quoted only inside the untrusted source block. Workers AI error 3036, the daily neuron cap, stops the tick instead of calling another model.

New articles can link up to two older stories in the same category. The link is added in that persona's own sentence if the draft did not include it.

## Personas

Twenty-four personas, fixed beats, no shared stock closer. Counts: AI 8, Technology 6, Fashion 5, Showbiz 5. The scheduler picks the least-published persona in the least-published category that has a fresh source. The roster is on the about page and in `src/news/authors.ts`.

## URLs

| Path | Page |
| --- | --- |
| `/ai-news` | Latest stories |
| `/ai-news/ai`, `/technology`, `/fashion`, `/showbiz` | Sections |
| `/ai-news/author/<id>` | Persona |
| `/ai-news/article/<slug>` | Story, with canonical URL, Open Graph, NewsArticle JSON-LD, breadcrumbs, TL;DR, and FAQ |
| `/ai-news/about` | How the desk works |
| `/ai-news/disclaimer` | Accuracy disclaimer |
| `/ai-news/feed.xml`, `/ai-news/atom.xml` | Site feeds |
| `/ai-news/<category>/feed.xml` and `atom.xml` | Section feeds |
| `/ai-news/sitemap.xml` | News section sitemap |
| `/ai-news/news-sitemap.xml` | Google News sitemap (stories from the last 48 hours) |
| `/ai-news/media/<commit-sha>/images/YYYY/MM/<slug>-<8-char-id>.webp` | Illustration, proxied from the public image repo at that commit SHA |
| `/llms.txt` | Notes for answer engines, including `/ai-news` |

`public/robots.txt` still allows all crawlers at `/` and still lists `https://3aik.com/sitemap.xml`. It also names Googlebot, Bingbot, DuckDuckBot, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, and other common crawlers, and adds the two news sitemaps. `public/sitemap.xml` still lists the home page and adds the news section URLs.

The service worker does not cache `/ai-news` or `/llms.txt` into the app shell, so opening a story cannot replace the cached home page.

## IndexNow

Optional. Create a key on your machine (8 to 128 letters, numbers, or hyphens). Do not commit it.

```sh
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
npx wrangler secret put INDEXNOW_KEY
```

Paste the key when prompted, not into git. For local dev, put it in `.dev.vars` (gitignored). See `.dev.vars.example`.

On each successful publish the cron POSTs the new article URL to `https://api.indexnow.org/indexnow`. The worker serves the key at `https://3aik.com/<key>.txt`, which is the `keyLocation` IndexNow checks. If `INDEXNOW_KEY` is unset, publishing continues and the ping is skipped. A failed ping does not unpublish the story.

IndexNow docs: [indexnow.org/documentation](https://www.indexnow.org/documentation).

## External ingest

The cron no longer writes articles while `AI_NEWS_GENERATOR` is `off`. An external writer posts them. The article page still says the piece was written with AI assistance and checked automatically. That stays true: the writer is an assistant, and this route runs the same gate as the Workers AI pipeline before insert.

Set the secret once (production already has it). Do not put the value in git.

```sh
npx wrangler secret put AI_NEWS_INGEST_TOKEN
```

The hourly cap is 10 authenticated POSTs per UTC hour, stored in the existing `runtime_lock` table (`ingest:<hour>`). No new migration. `GET /ai-news/api/ingest/meta` does not count. A failed POST still counts.

Workers Builds deploys `main` to production. GitHub Actions does not. After merge, the route is live. The ingest secret and `GITHUB_IMAGES_TOKEN` survive that deploy. `AI_NEWS_GENERATOR=off` in `wrangler.jsonc` is what the deploy publishes.

### POST /ai-news/api/ingest

`Authorization: Bearer <AI_NEWS_INGEST_TOKEN>`. `Content-Type: application/json`.

| Status | Body |
| --- | --- |
| 201 | `{ "url", "slug" }` |
| 401 | `{ "error": "unauthorized" }` when the bearer does not match |
| 404 | `{ "error": "not_found" }` when the secret is unset |
| 409 | `{ "error": "duplicate", "conflicts": [{ "field": "slug" or "source_url", "value" }] }` |
| 422 | `{ "reasons": ["..."] }` for shape or quality failures |
| 429 | `{ "error": "rate_limited", "retry_after" }` after 10 POSTs in the UTC hour |
| 503 | `{ "error": "unavailable" }` when D1 is missing |

JSON fields:

| Field | Rule |
| --- | --- |
| `title` | 20 to 110 characters |
| `dek` or `summary` | 90 to 170 characters |
| `category` | `ai`, `tech` (stored as `technology`), `fashion`, or `showbiz` |
| `author_slug` | One of the 24 persona ids, and that persona's category must match |
| `body_markdown` or `html` | Paragraphs. Stored as plain text in `body_text`, same as the pipeline. 400 to 1100 words, 5 to 10 paragraphs |
| `key_points` | 3 to 5 items, 8 to 40 words each |
| `faq` | Exactly 3 `{ "question", "answer" }`. Question ends with `?`. Answer is 20 to 90 words |
| `tags` | 2 to 4 lowercase hyphenated tags |
| `sources` | 1 to 4 `{ "url", "publisher", "title" }`. At least one. Showbiz requires one. Optional `excerpt` |
| `image` | Optional. `{ "data": "<base64 or data URL>", "alt": "..." }` or a base64 string plus `image_alt`. JPEG, PNG, or WebP, up to about 1.5 MB |
| `image_source_url` | Optional https publisher image, such as `og:image`. Fetched and stored like a generated image. Private hosts, redirects to them, non-image bytes, and files over 1 MB are rejected. If the copy cannot be stored, the article has no picture. The page never hotlinks the publisher URL. A failed fetch publishes with no picture. Wins over `image` when both are sent |
| `image_credit` | Optional, for example `Image: WWD`. Shown once under the picture |

The gate rejects em dashes, en dashes used as clause breaks, `---` and spaced `--`, slop words, an 8-word copy of the source title or fetched page, a missing outlet name, and (for fashion and showbiz) an unattributed dispute. A slug or source URL already on the desk returns 409 before those quality reasons, so a retry is not reported as a bad draft. `GET /ai-news/api/ingest/meta` returns the persona list, categories, those limits, and recent source URLs.

A PNG, JPEG, or WebP at or under 1 MB is committed to `alivirgo/3aik-ai-news-images` with `GITHUB_IMAGES_TOKEN`. A larger upload, a missing token, or a failed commit still returns 201 and publishes with no picture. A publisher image that cannot be stored is omitted. The page does not hotlink it. A failed or unsafe fetch stores no image.

```sh
IMG=$(base64 -w 0 photo.jpg)
curl -sS -X POST https://3aik.com/ai-news/api/ingest \
  -H "Authorization: Bearer $AI_NEWS_INGEST_TOKEN" \
  -H "content-type: application/json" \
  --data @article.json
```

`article.json` uses the fields above. Put the base64 in `image.data`. Read the rules first:

```sh
curl -sS https://3aik.com/ai-news/api/ingest/meta \
  -H "Authorization: Bearer $AI_NEWS_INGEST_TOKEN"
```

To let the cron call Workers AI again, set `AI_NEWS_GENERATOR` to `workers-ai`. Leave it `off` to keep the neuron spend at zero. Cleanup still runs while publishing is on.

## Private newsroom stats

There were no reader pageview rows in D1 before this change. `author_stats` and `category_stats` count publishes, not reads. The home page counter is a separate KV key, `visitor_count`, and this work does not touch it.

Publish totals:

```sql
SELECT SUM(publish_count) FROM author_stats;
SELECT category, publish_count, last_published_at FROM category_stats;
```

`GET /ai-news/api/stats` is JSON. `GET /ai-news/api/stats/dashboard` is the HTML desk. `GET /ai-news/api/stats/article/<slug>` is one article. `GET /ai-news/api/stats.csv` is the same numbers as CSV. All four require the stats bearer. The ingest token is rejected. The check is SHA-256 of the presented bearer, compared in constant time with the committed digest (or `AI_NEWS_STATS_TOKEN_SHA256` when that var is set). The bearer is not stored in the repo.

```sh
curl -sS "https://3aik.com/ai-news/api/stats?from=2026-10-01&to=2026-10-26" \
  -H "Authorization: Bearer <STATS_TOKEN>"
curl -sS "https://3aik.com/ai-news/api/stats/dashboard" \
  -H "Authorization: Bearer <STATS_TOKEN>"
curl -sS "https://3aik.com/ai-news/api/stats.csv" \
  -H "Authorization: Bearer <STATS_TOKEN>"
```

Send `from` and `to` as `YYYY-MM-DD` query parameters when you want a range. The dashboard uses those as plain GET links. A missing header, the ingest token, a wrong bearer, a cookie, or a credential query key (`token`, `access_token`, `auth`, `key`, `secret`, `bearer`) is the same 404 a public `/ai-news` miss returns, including the same headers. A successful stats response is `Cache-Control: private, no-store`, `CDN-Cache-Control: no-store`, `Cloudflare-CDN-Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow`. There is no CORS header. The paths are not linked from public pages and are not in the sitemap.

A human article view is a same-origin beacon, `POST /ai-news/api/collect` with `kind: "view"`, sent from the article page. The same request also carries engaged time, scroll depth, screen bucket, outbound clicks, and source-link clicks. It does not use cookies. The body is refused when `Content-Length` is over 4 KB, and again if the stream exceeds that. Beacons are accepted only when the slug is an article already in D1. A public HTML response does not write a page view, so the page can stay cached at the edge. New versus returning is a 0/1 flag from `localStorage` key `3aik-news-seen`. No client id is sent or stored.

`NEWS_STATS_RATE_LIMITER` (`namespace_id` `3104`, 30 requests per 60 seconds) limits collect, human views, and bot/404/feed counters per client. The key is a SHA-256 of `cf-connecting-ip`, used only for that `limit()` call and never stored. The binding is per Cloudflare location and approximate. It is not a global cap. The global cap is the SQLite Durable Object `NEWS_STATS_BUDGET`: 25,000 D1 stats row writes per UTC day. Past that cap, D1 rollups are dropped and Analytics Engine keeps 1 in 20 raw points. Ingest, the publish cron, and `runtime_lock` do not spend this budget. When the Durable Object binding is absent, `stats_write_budget` is the fallback and it fails closed if that table is missing.

Unique visitors are HMAC-SHA256 of a random 32-byte salt, the address, and the user agent. `persistDaySalt` finishes before the hash. The salt comes from `crypto.getRandomValues`, is stored in `stats_day_salt`, and the cron deletes salts from earlier UTC days. It is not derived from the ingest token or the stats token. The address and user agent are dropped after the hash. Browser, OS, and bot name are parsed first. Country, city, region, and continent come from `request.cf` and are written to Analytics Engine, not to a D1 raw row. Search queries and utm values drop emails, phone-like strings, and digit runs longer than 6, and they are capped at 80 characters. A referrer path keeps the host plus the first path segment.

A human view is two D1 writes when the visitor hash is present: `stats_visitor_day` and `stats_article_hour`. Engage and click are one upsert each. Bots, article-slug 404s, and feed fetches are one daily counter (`stats_bot_daily`, `stats_miss_daily`, `stats_feed_daily`). Other 404 paths are not counted. Raw `page_views` rows are no longer inserted. The cron deletes leftover raw rows and `stats_visitor_day` after 90 days, deletes salts from earlier days, and deletes daily rollup rows older than 400 days. The dashboard reads those rollups with `GROUP BY` and `LIMIT`. It does not query Analytics Engine, because this worker has no read token for it. Feeds list 100 articles. The sitemap is one page of 1,000 URLs, and `/ai-news/sitemap.xml` becomes a sitemap index when more pages exist. Public HTML uses CSP hashes for inline scripts and `Cache-Control: public`. A hidden stats or collect miss stays `no-store` and matches a public `/ai-news` 404.

## Samples

`docs/samples/` holds four dry-run articles, one per section, based on public RSS items from 22 and 23 October 2026. They were written to the same gate the model must pass (`npm test` runs that check). This environment cannot call Workers AI, so the sample illustrations are prompts and alt text only. Production commits one WebP or JPEG per article to `alivirgo/3aik-ai-news-images` when the token is set.

## Code map

- `src/news/pipeline.ts` cron cycle. With `AI_NEWS_GENERATOR` off it prunes and does not call Workers AI
- `src/news/ingest.ts` external ingest API
- `src/news/quality.ts` gate
- `src/news/feeds.ts` RSS and Atom parser
- `src/news/model.ts` Workers AI calls and prompts
- `src/news/github-images.ts` Contents API writes and the jsDelivr read
- `src/news/routes.ts` HTML, feeds, sitemaps, IndexNow key, stats, and the collect beacon
- `src/news/pageviews.ts` classification, HMAC visitor hash, and the in-memory stats report
- `src/news/d1-stats.ts` SQL aggregates for the D1 dashboard
- `src/news/stats.ts` separate stats bearer, dashboard, drilldown, and CSV
- `src/news/collect.ts` same-origin view, engagement, and click beacon
- `src/news/ratelimit.ts` Workers rate-limit binding, keyed by a hash of the client address
- `src/news/budget.ts` Durable Object daily cap on D1 stats writes
- `src/news/events.ts` Analytics Engine raw events
- `src/index.ts` sends `/ai-news`, `/llms.txt`, and the key file to that router, then leaves every other route as it was
