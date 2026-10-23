import { FEEDS, MAX_EXCERPT_CHARS, MIN_EXCERPT_CHARS, STORY_MAX_AGE_HOURS, type FeedSource } from "./config";
import type { StoryItem } from "./types";
import { clipWords, normalizeSourceUrl, stripHtml } from "./text";

const USER_AGENT = "3aik-news/1.0 (+https://3aik.com/ai-news/about)";

function tagBlocks(xml: string, tag: string): string[] {
	const matches = xml.matchAll(new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>[\\s\\S]*?</(?:[a-z0-9]+:)?${tag}>`, "gi"));
	return [...matches].map((match) => match[0]);
}

function tagValue(block: string, tag: string): string | null {
	const match = block.match(new RegExp(`<(?:[a-z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-z0-9]+:)?${tag}>`, "i"));
	return match ? match[1].trim() : null;
}

function atomLink(block: string): string | null {
	const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
	let fallback: string | null = null;
	for (const link of links) {
		const attrs = link[1] ?? "";
		const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!href) continue;
		const rel = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "alternate";
		if (rel === "alternate" || rel.split(/\s+/).includes("alternate")) return href;
		if (!fallback && rel !== "self") fallback = href;
	}
	return fallback;
}

function parseDate(raw: string | null): string | null {
	if (!raw) return null;
	const parsed = new Date(stripHtml(raw));
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString();
}

function withinAge(publishedAt: string | null, now: Date): boolean {
	if (!publishedAt) return true;
	const age = now.getTime() - Date.parse(publishedAt);
	return age <= STORY_MAX_AGE_HOURS * 60 * 60 * 1000 && age > -6 * 60 * 60 * 1000;
}

function excerptFrom(block: string): string {
	const description = tagValue(block, "description") ?? tagValue(block, "summary");
	const content = tagValue(block, "content") ?? tagValue(block, "encoded");
	const preferred = description ? stripHtml(description) : "";
	if (preferred.length >= MIN_EXCERPT_CHARS) return clipWords(preferred, MAX_EXCERPT_CHARS);
	const fallback = content ? stripHtml(content) : preferred;
	return clipWords(fallback, MAX_EXCERPT_CHARS);
}

export function parseFeed(xml: string, feed: FeedSource, now = new Date()): StoryItem[] {
	const blocks = xml.includes("<entry") ? tagBlocks(xml, "entry") : tagBlocks(xml, "item");
	const stories: StoryItem[] = [];
	const seen = new Set<string>();
	for (const block of blocks) {
		const title = stripHtml(tagValue(block, "title") ?? "");
		const rawLink = atomLink(block) || stripHtml(tagValue(block, "link") ?? "") || stripHtml(tagValue(block, "guid") ?? "");
		const excerpt = excerptFrom(block);
		if (!title || !rawLink || excerpt.length < MIN_EXCERPT_CHARS) continue;
		let url: string;
		try {
			url = normalizeSourceUrl(rawLink);
		} catch {
			continue;
		}
		if (!/^https:\/\//.test(url) || seen.has(url)) continue;
		const publishedAt = parseDate(
			tagValue(block, "pubDate") ?? tagValue(block, "published") ?? tagValue(block, "updated") ?? tagValue(block, "date"),
		);
		if (!withinAge(publishedAt, now)) continue;
		seen.add(url);
		stories.push({
			url,
			title,
			outlet: feed.outlet,
			category: feed.category,
			excerpt,
			publishedAt,
		});
	}
	return stories;
}

export function feedsForTick(now: Date, feeds: FeedSource[] = FEEDS): FeedSource[] {
	if (!feeds.length) return [];
	const start = now.getUTCHours() % feeds.length;
	const count = Math.min(6, feeds.length);
	return Array.from({ length: count }, (_, index) => feeds[(start + index) % feeds.length]);
}

export async function fetchStories(
	now: Date,
	fetchImpl: typeof fetch = fetch,
	feeds: FeedSource[] = feedsForTick(now),
): Promise<StoryItem[]> {
	const batches = await Promise.all(
		feeds.map(async (feed) => {
			try {
				const response = await fetchImpl(feed.url, {
					headers: {
						accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
						"user-agent": USER_AGENT,
					},
					signal: AbortSignal.timeout(8_000),
				});
				if (!response.ok) {
					console.error(JSON.stringify({ message: "ai-news feed failed", outlet: feed.outlet, status: response.status }));
					return [];
				}
				const xml = await response.text();
				return parseFeed(xml, feed, now);
			} catch (error) {
				console.error(JSON.stringify({
					message: "ai-news feed error",
					outlet: feed.outlet,
					error: error instanceof Error ? error.message : String(error),
				}));
				return [];
			}
		}),
	);
	const merged = new Map<string, StoryItem>();
	for (const story of batches.flat()) {
		if (!merged.has(story.url)) merged.set(story.url, story);
	}
	return [...merged.values()].sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""));
}
