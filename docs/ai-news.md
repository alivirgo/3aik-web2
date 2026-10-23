# 3aik News

`/ai-news` is a server-rendered news desk on the existing 3aik Worker. It does not change the home page, the chat API, or the privacy page. `AI_NEWS_PUBLISHING` ships as `off`. The cron returns before it opens D1 or R2 while publishing is off. Read routes still serve pages: a missing database becomes an empty list, an empty feed, or a 404 for one story or image, not a 500. The D1 id in `wrangler.jsonc` is still a placeholder. Create the database and bucket, replace that id, apply both migrations, then set `AI_NEWS_PUBLISHING` to `on` and deploy. This change does not deploy anything.

## What readers are told

Articles are written with AI assistance and checked by the desk rules before publishing. The 24 bylines are editorial personas, not real people. Bios describe a beat and a voice. They do not claim a degree, an employer, or a human career.

Every news page, including articles, carries this footer:

> 3aik.com takes no responsibility for the accuracy of news. Readers should verify claims with the linked original sources.

The same point is on [/ai-news/disclaimer](https://3aik.com/ai-news/disclaimer). [/ai-news/about](https://3aik.com/ai-news/about) explains the personas and the check.

## One-time resources

From the repo root, with Wrangler logged into the 3aik account:

```sh
npx wrangler d1 create 3aik-ai-news
```

Copy the `database_id` from that command into `wrangler.jsonc`, replacing the placeholder `11111111-1111-4111-8111-111111111111` on the `AI_NEWS_DB` binding. The binding name and `database_name` stay as they are.

```sh
npx wrangler d1 migrations apply 3aik-ai-news --remote
npx wrangler r2 bucket create 3aik-ai-news-images
# then set AI_NEWS_PUBLISHING to "on" in wrangler.jsonc
```

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
| `AI_NEWS_IMAGES` | R2 | `3aik-ai-news-images` |
| `AI` | Workers AI | already on the worker |

Images are stored in R2. Article rows, source URLs, and rotation counters are in D1. Migration: `migrations/0001_ai_news_init.sql`.

## Rate, schedule, and pause

`AI_NEWS_ARTICLES_PER_HOUR` is the cap for the whole site, not per category. It starts at `"1"`. Set it to `"2"` for the top of the initial range, then higher later. Values above 8 are clamped to 8. `0` publishes nothing.

Cron ticks are `7 * * * *` and `37 * * * *` (minute 7 and minute 37, UTC). Each tick publishes at most `ceil(rate / 2)` articles, and never more than the room left in the current UTC hour. A rate of 1 publishes on the first tick that still has room and skips the other. A rate of 2 publishes one article on each tick. A rate of 4 publishes up to two per tick.

Publishing is off unless `AI_NEWS_PUBLISHING` is `on`, `true`, `yes`, or `1`. A missing value is off. `false`, `paused`, and `0` also pause. Prefer the config file. A dashboard-only edit can be overwritten by the next `wrangler deploy`.

While paused, the cron does not take the publish lock and does not read or write D1 or R2. `/ai-news` still serves pages, feeds, and sitemaps from D1 when the database exists. If the database is missing, lists and feeds are empty and a story URL returns 404.

## Spend, time, and retention

Each tick has a hard model budget. Defaults, all overridable in `wrangler.jsonc`:

| Var | Default | Meaning |
| --- | --- | --- |
| `AI_NEWS_TEXT_CALLS_PER_ARTICLE` | 6 | Text `AI.run` calls per article slot this tick. A 3-model cascade counts one call per model. |
| `AI_NEWS_IMAGE_CALLS_PER_ARTICLE` | 2 | Image calls per slot. The budget is at least the two configured image models, so the FLUX.1 Schnell fallback still runs when the hourly rate is 1. |
| `AI_NEWS_MAX_FAILURES` | 2 | Stop the tick after this many failed stories in a row. |
| `AI_NEWS_REJECT_TTL_HOURS` | 24 | How long a content or quality rejection blocks that source URL. Budget, wall-clock, timeout, and image-only failures block it for 1 hour. |
| `AI_NEWS_WALL_MS` | 45000 | Stop starting new work after this much wall time. |
| `AI_NEWS_TEXT_TIMEOUT_MS` | 15000 | Per text call. |
| `AI_NEWS_IMAGE_TIMEOUT_MS` | 20000 | Per image call. |
| `AI_NEWS_RETENTION_DAYS` | 180 | Delete articles older than this during a publish tick. `0` disables cleanup. |

The run budget is the per-article number times the slots for that tick, clamped (24 text calls, 8 image calls). Each image slot still gets at least one try per configured image model. Text output is capped at 2048 tokens.

Each `AI.run` passes `{ rejectIfBusy: true }`, so a busy model fails instead of waiting in a capacity queue. The desk also stops waiting after the per-call timeout. That timer does not cancel inference that has already started, so a timed-out call may still be billed.

The publish lock lasts longer than the worst case of every budgeted call hitting its timeout, and longer than the wall clock, plus 60 seconds. It is not a fixed 10 minutes.

Failed source URLs live in `source_rejections` (`migrations/0002_ai_news_rejections.sql`). Expired rows are deleted at the start of a publish tick. Articles older than the retention window are deleted in batches of 20. The D1 row is deleted first, then the R2 object, so a failed image delete cannot leave a story that points at a missing file. Lifetime author counters stay, so rotation does not restart. To clean by hand:

```sql
DELETE FROM article_sources WHERE article_id IN (SELECT id FROM articles WHERE published_at < '2026-01-01T00:00:00.000Z');
DELETE FROM articles WHERE published_at < '2026-01-01T00:00:00.000Z';
DELETE FROM source_rejections WHERE expires_at <= datetime('now');
```

Delete the matching `articles/<id>.*` objects from the R2 bucket as well.

## Feeds

Each fetch follows at most three redirects, and only to `https` on the same site. A `www` host and its apex count as the same site. Any other hostname does not. The response must be `xml`, `rss`, or `atom` (`text/xml`, `application/xml`, `application/rss+xml`, `application/atom+xml`, `application/rdf+xml`, `text/rss`). The body is streamed and dropped above 2 MB. An item with no publication date is stale and is not used.

## Models

Text, in order, via the existing `AI` binding:

1. `@cf/openai/gpt-oss-120b` (primary, general-purpose reasoning)
2. `@cf/moonshotai/kimi-k2.6`
3. `@cf/zai-org/glm-4.7-flash`

Image:

1. `@cf/black-forest-labs/flux-2-klein-9b` (multipart prompt, 1024 square)
2. `@cf/black-forest-labs/flux-1-schnell`

Checked against the Workers AI catalog (gpt-oss-120b, Kimi K2.6, GLM 4.7 Flash, FLUX.2 Klein 9B, FLUX.1 Schnell). Illustrations are abstract. Prompts are rejected if they ask for a person, a face, or a logo. No extra API key is required for Workers AI.

## Sources and the quality gate

Feeds are listed in `src/news/config.ts` (The Verge, TechCrunch, MIT Technology Review, BBC News, Ars Technica, WIRED, The Guardian, Vogue, WWD, Variety, Deadline). Each run fetches a rotating subset. A story older than 96 hours is skipped. A source URL is stored once, so the same story is not published again.

Before a row is inserted the draft must:

- contain no em dash (U+2014), no en dash used as a clause break, no figure dash, minus sign, or two-em dash (U+2012, U+2212, U+FE58, U+FE31, U+2E3A), and no `---` or spaced `--`
- avoid the slop list in `src/news/quality.ts` (`delve`, `in today's fast-paced`, `game-changer`, `it's worth noting`, `tapestry`, `landscape`, `in conclusion`, and the rest of that list)
- be 400 to 1100 words, with at least eight sentences, one of 12 words or fewer, one of 25 words or more, and an uneven rhythm
- not copy an 8-word sequence from the source title or excerpt
- not repeat a title or a source URL, and not be too similar to a recent article
- name the outlet in the body
- for fashion and showbiz, attribute disputes in the same sentence as the claim

Failures are logged as JSON and the model is asked to try again, up to three times per story. A bad image response stops that tick so the desk does not burn a string of text calls.

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
| `/ai-news/image/<id>` | Generated illustration |
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

## Samples

`docs/samples/` holds four dry-run articles, one per section, based on public RSS items from 22 and 23 October 2026. They were written to the same gate the model must pass (`npm test` runs that check). This environment cannot call Workers AI, so the sample illustrations are prompts and alt text only. Production stores one FLUX image per article in R2.

## Code map

- `src/news/pipeline.ts` cron cycle
- `src/news/quality.ts` gate
- `src/news/feeds.ts` RSS and Atom parser
- `src/news/model.ts` Workers AI calls and prompts
- `src/news/routes.ts` HTML, feeds, sitemaps, IndexNow key
- `src/index.ts` sends `/ai-news`, `/llms.txt`, and the key file to that router, then leaves every other route as it was
