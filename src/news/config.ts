import type { Category } from "./types";

/** Hourly publish cap. Raise this var later; the cron math follows it. */
export const DEFAULT_ARTICLES_PER_HOUR = 1;
export const MAX_ARTICLES_PER_HOUR = 8;

/**
 * Two ticks per hour. `slotsThisRun` spreads `AI_NEWS_ARTICLES_PER_HOUR`
 * across these expressions. Keep the Wrangler `triggers.crons` list in sync.
 */
export const NEWS_CRONS = ["7 * * * *", "37 * * * *"] as const;

export const STORY_MAX_AGE_HOURS = 96;
export const MIN_WORDS = 400;
export const MAX_WORDS = 1100;
export const MIN_EXCERPT_CHARS = 60;
export const MAX_EXCERPT_CHARS = 900;
export const SIMILARITY_LIMIT = 40;
export const TITLE_JACCARD_LIMIT = 0.62;
export const BODY_SHINGLE_LIMIT = 0.16;
export const COPY_WINDOW = 8;

export const TEXT_MODELS = [
	{ id: "@cf/openai/gpt-oss-120b", label: "GPT OSS 120B" },
	{ id: "@cf/moonshotai/kimi-k2.6", label: "Kimi K2.6" },
	{ id: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash" },
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
	INDEXNOW_KEY?: string;
}

export function articlesPerHour(env: NewsEnv): number {
	const raw = env.AI_NEWS_ARTICLES_PER_HOUR;
	if (raw === undefined || raw.trim() === "") return DEFAULT_ARTICLES_PER_HOUR;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return DEFAULT_ARTICLES_PER_HOUR;
	return Math.min(MAX_ARTICLES_PER_HOUR, Math.max(0, Math.floor(parsed)));
}

export function publishingEnabled(env: NewsEnv): boolean {
	const value = (env.AI_NEWS_PUBLISHING ?? "on").trim().toLowerCase();
	return value === "on" || value === "true" || value === "yes" || value === "1";
}

export function slotsThisRun(rate: number, publishedThisHour: number): number {
	if (rate <= 0) return 0;
	const remaining = rate - publishedThisHour;
	if (remaining <= 0) return 0;
	const cap = Math.max(1, Math.ceil(rate / NEWS_CRONS.length));
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
