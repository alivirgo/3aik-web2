import type { Category } from "./types";

/** Hourly publish cap. Raise this var later; the cron math follows it. */
export const DEFAULT_ARTICLES_PER_HOUR = 1;
export const MAX_ARTICLES_PER_HOUR = 8;

/**
 * How many cron ticks run per hour. The expressions themselves live only in
 * `triggers.crons` in wrangler.jsonc. A test checks that list has this many entries.
 */
export const CRON_TICKS_PER_HOUR = 2;

export const STORY_MAX_AGE_HOURS = 96;
export const MIN_WORDS = 400;
export const MAX_WORDS = 1100;
export const MIN_EXCERPT_CHARS = 60;
export const MAX_EXCERPT_CHARS = 900;
export const SIMILARITY_LIMIT = 40;
export const TITLE_JACCARD_LIMIT = 0.62;
export const BODY_SHINGLE_LIMIT = 0.16;
export const COPY_WINDOW = 8;

/**
 * Room for the article JSON plus, on gpt-oss, the reasoning tokens that count
 * against max_output_tokens. 2048 was ending the draft around 300 words.
 */
export const TEXT_MAX_TOKENS = 8192;
export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_TEXT_CALLS_PER_ARTICLE = 6;
export const DEFAULT_IMAGE_CALLS_PER_ARTICLE = 2;
/** Operational failures cool down for an hour. Quality and content failures use `AI_NEWS_REJECT_TTL_HOURS`. */
export const SHORT_REJECT_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_FAILURES = 2;
export const DEFAULT_REJECT_TTL_HOURS = 24;
/** Five minutes. A scheduled handler may run for 15 minutes. */
export const DEFAULT_WALL_MS = 300_000;
/** One minute, enough for a 120B model on medium reasoning effort. */
export const DEFAULT_TEXT_TIMEOUT_MS = 60_000;
export const DEFAULT_IMAGE_TIMEOUT_MS = 20_000;
export const DEFAULT_RETENTION_DAYS = 180;
export const RETENTION_BATCH = 20;

/**
 * Free-plan text models. Kimi K2.6 is omitted: on the Workers Free plan it
 * returns 5035 and never produces a draft. GPT OSS uses the Responses API.
 */
export const TEXT_MODELS = [
	{ id: "@cf/openai/gpt-oss-120b", label: "GPT OSS 120B", format: "responses" },
	{ id: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash", format: "messages" },
	{ id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", format: "messages" },
] as const;

export const IMAGE_MODELS = [
	{ id: "@cf/black-forest-labs/flux-2-klein-9b", label: "FLUX.2 Klein 9B", multipart: true },
	{ id: "@cf/black-forest-labs/flux-1-schnell", label: "FLUX.1 Schnell", multipart: false },
] as const;

export const SITE_NAME = "3aik News";
export const PUBLISHER_NAME = "3aik";
export const ACCURACY_DISCLAIMER =
	"3aik.com takes no responsibility for the accuracy of news. Readers should verify claims with the linked original sources.";
export const DESK_DISCLOSURE =
	"AI-assisted articles, editorially checked before publishing. The named authors are editorial personas, not real people.";

export const CATEGORY_LABEL: Record<Category, string> = {
	ai: "AI",
	technology: "Technology",
	fashion: "Fashion",
	showbiz: "Showbiz",
};

export const CATEGORY_DECK: Record<Category, string> = {
	ai: "Model releases, policy, research, and the products that put them to work.",
	technology: "Software, security, gadgets, energy, and the business around them.",
	fashion: "Clothes, price, materials, and claims that credible outlets have already published.",
	showbiz: "Film, television, music, and awards. Disputes stay attributed to the outlet that reported them.",
};

export interface FeedSource {
	url: string;
	outlet: string;
	category: Category;
}

export const FEEDS: FeedSource[] = [
	{
		url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
		outlet: "The Verge",
		category: "ai",
	},
	{
		url: "https://techcrunch.com/category/artificial-intelligence/feed/",
		outlet: "TechCrunch",
		category: "ai",
	},
	{
		url: "https://www.technologyreview.com/feed/",
		outlet: "MIT Technology Review",
		category: "ai",
	},
	{
		url: "https://feeds.bbci.co.uk/news/technology/rss.xml",
		outlet: "BBC News",
		category: "technology",
	},
	{
		url: "https://feeds.arstechnica.com/arstechnica/index",
		outlet: "Ars Technica",
		category: "technology",
	},
	{
		url: "https://www.wired.com/feed/rss",
		outlet: "WIRED",
		category: "technology",
	},
	{
		url: "https://techcrunch.com/feed/",
		outlet: "TechCrunch",
		category: "technology",
	},
	{
		url: "https://www.theguardian.com/fashion/rss",
		outlet: "The Guardian",
		category: "fashion",
	},
	{
		url: "https://www.vogue.com/feed/rss",
		outlet: "Vogue",
		category: "fashion",
	},
	{
		url: "https://wwd.com/feed/",
		outlet: "WWD",
		category: "fashion",
	},
	{
		url: "https://www.theguardian.com/film/rss",
		outlet: "The Guardian",
		category: "showbiz",
	},
	{
		url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml",
		outlet: "BBC News",
		category: "showbiz",
	},
	{
		url: "https://variety.com/feed/",
		outlet: "Variety",
		category: "showbiz",
	},
	{
		url: "https://deadline.com/feed/",
		outlet: "Deadline",
		category: "showbiz",
	},
];

export interface NewsEnv {
	AI_NEWS_ARTICLES_PER_HOUR?: string;
	AI_NEWS_PUBLISHING?: string;
	AI_NEWS_SITE_ORIGIN?: string;
	AI_NEWS_TEXT_CALLS_PER_ARTICLE?: string;
	AI_NEWS_IMAGE_CALLS_PER_ARTICLE?: string;
	AI_NEWS_MAX_FAILURES?: string;
	AI_NEWS_REJECT_TTL_HOURS?: string;
	AI_NEWS_WALL_MS?: string;
	AI_NEWS_TEXT_TIMEOUT_MS?: string;
	AI_NEWS_IMAGE_TIMEOUT_MS?: string;
	AI_NEWS_RETENTION_DAYS?: string;
	INDEXNOW_KEY?: string;
	/** Fine-grained token with contents:write on alivirgo/3aik-ai-news-images. Never commit it. */
	GITHUB_IMAGES_TOKEN?: string;
}

export function articlesPerHour(env: NewsEnv): number {
	const raw = env.AI_NEWS_ARTICLES_PER_HOUR;
	if (raw === undefined || raw.trim() === "") return DEFAULT_ARTICLES_PER_HOUR;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_ARTICLES_PER_HOUR;
	return Math.min(MAX_ARTICLES_PER_HOUR, Math.max(0, Math.floor(parsed)));
}

export function publishingEnabled(env: NewsEnv): boolean {
	const value = (env.AI_NEWS_PUBLISHING ?? "off").trim().toLowerCase();
	return value === "on" || value === "true" || value === "yes" || value === "1";
}

function clampedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function textCallsPerArticle(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_TEXT_CALLS_PER_ARTICLE, DEFAULT_TEXT_CALLS_PER_ARTICLE, 1, 12);
}

export function imageCallsPerArticle(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_IMAGE_CALLS_PER_ARTICLE, DEFAULT_IMAGE_CALLS_PER_ARTICLE, 1, 4);
}

export function maxFailuresPerRun(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_MAX_FAILURES, DEFAULT_MAX_FAILURES, 1, 5);
}

export function rejectTtlHours(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_REJECT_TTL_HOURS, DEFAULT_REJECT_TTL_HOURS, 1, 168);
}

export function wallBudgetMs(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_WALL_MS, DEFAULT_WALL_MS, 5_000, 900_000);
}

export function textTimeoutMs(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_TEXT_TIMEOUT_MS, DEFAULT_TEXT_TIMEOUT_MS, 1_000, 180_000);
}

export function imageTimeoutMs(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_TIMEOUT_MS, 1_000, 45_000);
}

export function retentionDays(env: NewsEnv): number {
	return clampedInt(env.AI_NEWS_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 0, 3650);
}

/** Calls allowed in one cron tick. Scales with the slots this tick may publish, then clamps. */
export function textCallBudget(env: NewsEnv, slots: number): number {
	return Math.min(24, textCallsPerArticle(env) * Math.max(1, slots));
}

export function imageCallBudget(env: NewsEnv, slots: number): number {
	const perSlot = Math.max(imageCallsPerArticle(env), IMAGE_MODELS.length);
	return Math.min(8, perSlot * Math.max(1, slots));
}

/** Retention deletes stay well under a burst of 20 commits. Each delete is two API calls. */
export const MAX_GITHUB_DELETES_PER_RUN = 5;
export const GITHUB_DELETE_PACE_MS = 250;
/** One Contents API call. A delete sends two of these back to back. */
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Longest retention can sit on GitHub before the model clock starts.
 * The publish lock adds this on top of the model budget.
 */
export function pruneBudgetMs(): number {
	const calls = MAX_GITHUB_DELETES_PER_RUN * 2 * GITHUB_REQUEST_TIMEOUT_MS;
	const pace = Math.max(0, MAX_GITHUB_DELETES_PER_RUN - 1) * GITHUB_DELETE_PACE_MS;
	return calls + pace;
}

/**
 * Lock must outlast pruning and the longest run we can still be inside.
 * Pruning finishes before the model clock starts, so its GitHub timeouts are
 * added to every budgeted call hitting its timeout, or the wall clock.
 */
export function lockTtlMs(env: NewsEnv): number {
	const slots = Math.max(1, slotsThisRun(articlesPerHour(env), 0));
	const worstCase = textCallBudget(env, slots) * textTimeoutMs(env) + imageCallBudget(env, slots) * imageTimeoutMs(env);
	return Math.max(wallBudgetMs(env), worstCase) + pruneBudgetMs() + 60_000;
}

export function slotsThisRun(rate: number, publishedThisHour: number): number {
	if (rate <= 0) return 0;
	const remaining = rate - publishedThisHour;
	if (remaining <= 0) return 0;
	const cap = Math.max(1, Math.ceil(rate / CRON_TICKS_PER_HOUR));
	return Math.min(remaining, cap);
}

export function siteOrigin(env: NewsEnv, request?: Request): string {
	const configured = env.AI_NEWS_SITE_ORIGIN?.trim().replace(/\/$/, "");
	if (configured && /^https?:\/\/[^/\s]+$/i.test(configured)) return configured;
	if (request) return new URL(request.url).origin;
	return "https://3aik.com";
}

export function hourStartIso(now: Date): string {
	const copy = new Date(now.getTime());
	copy.setUTCMinutes(0, 0, 0);
	return copy.toISOString();
}

export function personaFooter(name: string): string {
	return `${name} is an editorial persona, not a real person. This article was written with AI assistance and editorially checked before publishing.`;
}
