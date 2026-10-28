import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ADSENSE_SCRIPT } from "../src/adsense";
import worker from "../src/index";
import { ACCURACY_DISCLAIMER, ASSIST_LINE } from "../src/news/config";
import { AI_NEWS_CSS_PATH } from "../src/news/css-asset";
import { authorInitials, SHARE_SCRIPT } from "../src/news/html";
import { handleNewsRequest, newsCacheRequest } from "../src/news/routes";
import { scriptSourceHash } from "../src/news/responses";
import { MemoryNewsRepository } from "../src/news/repository";
import type { StoredArticle } from "../src/news/types";
import { formatDateline, formatTimestamp, readingLabel, readingMinutes, relativeTime, TINY_JPEG } from "../src/news/text";

const root = resolve(import.meta.dirname, "..");

function withoutAdLoader(html: string): string {
	return html.replaceAll(ADSENSE_SCRIPT, "");
}
const publishedAt = "2026-10-23T12:07:00.000Z";
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const IMAGE_PATH = "images/2026/10/short-bulletin.jpg";

function article(): StoredArticle {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug: "short-bulletin",
		title: "A short bulletin, retold with the blanks left blank",
		description: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		category: "ai",
		tags: ["desk", "brief"],
		authorId: "mira-ellison",
		bodyHtml: "<p>STORED_HTML_SHOULD_NOT_RENDER</p><script>alert(1)</script>",
		bodyText: "The Verge reported a narrow product note.\n\nSee the [source](https://www.theverge.com/ai-artificial-intelligence/1017151/canva-craft-in-house-ai-model).",
		keyPoints: ["The outlet reported a narrow product note and nothing past it."],
		faq: [{ question: "What did the outlet report?", answer: "A narrow product note." }],
		sources: [{
			url: "https://www.theverge.com/ai-artificial-intelligence/1017151/canva-craft-in-house-ai-model",
			title: "Canva's first AI image model plans designs before generating them",
			outlet: "The Verge",
		}],
		related: [],
		imageKey: IMAGE_PATH,
		imageCommit: COMMIT_SHA,
		imageAlt: "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.",
		imageType: "image/jpeg",
		imageCredit: "",
		imageSourceUrl: "",
		publishedAt,
		updatedAt: publishedAt,
	};
}

function desk() {
	const repo = new MemoryNewsRepository();
	repo.articles.push(article());
	return { repo };
}

describe("news pages", () => {
	it("serves the section, about, and disclaimer without a database", async () => {
		const env = { AI_NEWS_SITE_ORIGIN: "https://3aik.com" };
		const slashed = await handleNewsRequest(new Request("https://3aik.test/ai-news/"), env, { repo: null });
		expect(slashed.status).toBe(301);
		expect(slashed.headers.get("location")).toBe("https://3aik.com/ai-news");
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news"), env, { repo: null });
		const html = await index.text();
		expect(index.status).toBe(200);
		expect(html.match(/<p class="assist">/g)).toHaveLength(1);
		expect(html.split(ASSIST_LINE)).toHaveLength(2);
		expect(html).not.toContain(ACCURACY_DISCLAIMER);
		expect(html).not.toContain("AI-generated");
		expect(html).not.toContain("editorial persona");
		expect(html).toContain(`href="${AI_NEWS_CSS_PATH}"`);
		expect(html).toContain('<h1 class="visually-hidden">3aik News</h1>');
		expect(html).toContain('property="og:image" content="https://3aik.com/ai-news-og.png"');
		expect(withoutAdLoader(html)).not.toMatch(/<script[^>]+src=/i);

		const about = await handleNewsRequest(new Request("https://3aik.test/ai-news/about"), env, { repo: null });
		const aboutHtml = await about.text();
		expect(aboutHtml).toContain("not real people");
		expect(aboutHtml).toContain("automatically checked against source and quality rules");
		expect(aboutHtml).not.toContain("editorially checked");
		const disclaimer = await handleNewsRequest(new Request("https://3aik.test/ai-news/disclaimer"), env, { repo: null });
		expect(await disclaimer.text()).toContain(ACCURACY_DISCLAIMER);
	});

	it("renders article metadata, structured data, and one assistance line", async () => {
		const { repo } = desk();
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		const html = await response.text();
		expect(response.headers.get("content-security-policy")).toContain("script-src https://pagead2.googlesyndication.com");
		expect(response.headers.get("content-security-policy")).not.toContain("script-src 'none'");
		expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
		expect(response.headers.get("content-security-policy")).not.toContain("jsdelivr");
		expect(html).toContain(`https://3aik.com/ai-news/media/${COMMIT_SHA}/${IMAGE_PATH}`);
		expect(html).not.toContain("cdn.jsdelivr.net");
		expect(html).toContain("<title>A short bulletin, retold with the blanks left blank | 3aik News</title>");
		expect(html).toContain('name="description"');
		expect(html).toContain('rel="canonical" href="https://3aik.com/ai-news/article/short-bulletin"');
		expect(html).toContain('property="og:title"');
		expect(html).toContain('name="twitter:card" content="summary_large_image"');
		expect(html).toContain('"@type":"NewsArticle"');
		expect(html).toContain(`"datePublished":"${publishedAt}"`);
		expect(html).toContain('"@type":"BreadcrumbList"');
		expect(html).not.toContain('"@type":"FAQPage"');
		expect(html).toContain("TL;DR");
		expect(html).toContain("https://www.theverge.com/ai-artificial-intelligence/1017151/canva-craft-in-house-ai-model");
		expect(html).toContain("Source: <a href=\"https://www.theverge.com/ai-artificial-intelligence/1017151/canva-craft-in-house-ai-model\" rel=\"noopener noreferrer\">The Verge</a>");
		expect(html).toContain("<p class=\"dek\">");
		expect(html.match(/<p class="assist">/g)).toHaveLength(1);
		expect(html.split(ASSIST_LINE)).toHaveLength(4);
		expect(html).not.toContain("Mira Ellison is an editorial persona");
		expect(html).not.toContain("automatically checked against source and quality rules before publishing");
		expect(html).not.toContain(ACCURACY_DISCLAIMER);
		expect(html).not.toContain("AI-generated");
		expect(html).toContain('"@type":"Organization"');
		expect(html).not.toContain('"@type":"Person"');
		expect(html).not.toContain('"description":"Not a real person."');
		expect(html).toContain('"name":"3aik News Desk"');
		expect(html).toContain('"creditText":"Written with AI assistance from cited reporting."');
		expect(html).toContain('href="https://3aik.com/ai-news/about">AI persona</a>');
		expect(html).toContain('"url":"https://3aik.com/ai-news/about"');
		expect(response.headers.get("cache-control")).toContain("public");
		expect(response.headers.get("cache-control")).toContain("max-age=120");
		expect(response.headers.get("content-security-policy")).toContain("'sha256-");
		expect(response.headers.get("content-security-policy")).not.toContain("'nonce-");
		const csp = response.headers.get("content-security-policy") ?? "";
		const hashes = [...csp.matchAll(/'sha256-[^']+'/g)].map((match) => match[0]);
		const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
		const beacon = html.match(/<script>(\(function\(\)\{var meta=[\s\S]*?)<\/script><\/body>/);
		const expected = [];
		for (const source of ld) expected.push(await scriptSourceHash(source));
		expected.push(await scriptSourceHash(SHARE_SCRIPT));
		if (beacon?.[1]) expected.push(await scriptSourceHash(beacon[1]));
		expect(hashes).toEqual(expected);
		expect(csp).not.toContain(await scriptSourceHash("alert(1)"));
		expect(html).toContain(">Mira Ellison</a>");
		expect(html).toContain(`"dateModified":"${publishedAt}"`);
		expect(html).toContain("1 min read");
		expect(html).toContain("The Verge reported a narrow product note.");
		expect(html).not.toContain("STORED_HTML_SHOULD_NOT_RENDER");
		expect(html).not.toContain("<script>alert");
		expect(html).not.toContain("\u2014");
	});

	it("serves the image, feeds, sitemaps, llms.txt, and the IndexNow key", async () => {
		const { repo } = desk();
		const env = { AI_NEWS_SITE_ORIGIN: "https://3aik.com", INDEXNOW_KEY: "index-key" };
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			expect(init?.method ?? "GET").toBe("GET");
			if (url === `https://cdn.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@${COMMIT_SHA}/${IMAGE_PATH}`) {
				return new Response(TINY_JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
			}
			return new Response("no", { status: 404 });
		});
		const imageUrl = `https://3aik.test/ai-news/media/${COMMIT_SHA}/${IMAGE_PATH}`;
		const head = await handleNewsRequest(new Request(imageUrl, { method: "HEAD" }), env, { repo, fetchImpl: fetchImpl as typeof fetch });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-type")).toBe("image/jpeg");
		expect((await head.arrayBuffer()).byteLength).toBe(0);
		expect(fetchImpl).not.toHaveBeenCalled();
		const missing = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/media/${COMMIT_SHA}/images/2026/10/missing.jpg`),
			env,
			{ repo, fetchImpl: fetchImpl as typeof fetch },
		);
		expect(missing.status).toBe(404);
		expect(missing.headers.get("cache-control")).toContain("max-age=60");
		expect(fetchImpl).not.toHaveBeenCalled();
		const image = await handleNewsRequest(new Request(imageUrl), env, { repo, fetchImpl: fetchImpl as typeof fetch });
		expect(image.headers.get("content-type")).toBe("image/jpeg");
		expect(image.headers.get("cache-control")).toContain("immutable");
		expect(image.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_JPEG);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const blocked = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/media/${COMMIT_SHA}/images/2026/10/../secret.jpg`),
			env,
			{ repo, fetchImpl: fetchImpl as typeof fetch },
		);
		expect(blocked.status).toBe(404);
		expect(fetchImpl).toHaveBeenCalledTimes(1);

		const rss = await handleNewsRequest(new Request("https://3aik.test/ai-news/feed.xml"), env, { repo });
		expect(rss.headers.get("content-type")).toContain("application/rss+xml");
		expect(await rss.text()).toContain("short-bulletin");
		const category = await handleNewsRequest(new Request("https://3aik.test/ai-news/ai/atom.xml"), env, { repo });
		expect(await category.text()).toContain("short-bulletin");

		const sitemap = await handleNewsRequest(new Request("https://3aik.test/ai-news/sitemap.xml"), env, { repo });
		const sitemapXml = await sitemap.text();
		expect(sitemapXml).toContain("https://3aik.com/ai-news/sitemap/1.xml");
		expect(sitemapXml).toContain("https://3aik.com/ai-news/news-sitemap.xml");
		expect(sitemapXml).not.toContain("https://3aik.com/ai-news/article/short-bulletin");
		const sitemapPage = await handleNewsRequest(new Request("https://3aik.test/ai-news/sitemap/1.xml"), env, { repo });
		expect(await sitemapPage.text()).toContain("https://3aik.com/ai-news/article/short-bulletin");
		const fresh = article();
		fresh.id = "33333333-3333-4333-8333-333333333333";
		fresh.slug = "fresh-bulletin";
		fresh.publishedAt = new Date().toISOString();
		fresh.updatedAt = fresh.publishedAt;
		repo.articles.push(fresh);
		const news = await handleNewsRequest(new Request("https://3aik.test/ai-news/news-sitemap.xml"), env, { repo });
		expect(await news.text()).toContain("news:news");

		const llms = await handleNewsRequest(new Request("https://3aik.test/llms.txt"), env, { repo });
		expect(await llms.text()).toContain("https://3aik.com/ai-news");
		const key = await handleNewsRequest(new Request("https://3aik.test/index-key.txt"), env, { repo });
		expect(await key.text()).toBe("index-key");

		const author = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/mira-ellison"), env, { repo });
		expect(await author.text()).toContain("not a real person");
		const unknownAuthor = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/not-a-persona"), env, { repo });
		expect(unknownAuthor.status).toBe(404);
	});
});

describe("existing routes stay in place", () => {
	it("keeps the home shell, health check, and news stylesheet on their old paths", async () => {
		const env = {
			AI: { run: vi.fn() },
			ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 200, headers: { "content-type": "text/html" } })) },
		} as never;
		const home = await worker.fetch(new Request("https://3aik.test/"), env);
		expect(await home.text()).toBe("asset");
		const health = await worker.fetch(new Request("https://3aik.test/api/health"), env);
		const body = await health.json() as { image: { label: string; fallback: string } };
		expect(body.image.label).toBe("FLUX.2 Klein 9B");
		expect(body.image.fallback).toBe("FLUX.1 Schnell");
		await worker.fetch(new Request("https://3aik.test/ai-news.css"), env);
		expect((env as { ASSETS: { fetch: ReturnType<typeof vi.fn> } }).ASSETS.fetch).toHaveBeenCalled();
		const denied = await worker.fetch(new Request("https://3aik.test/ai-news", { method: "POST" }), env);
		expect(denied.status).toBe(405);
		const section = await worker.fetch(new Request("https://3aik.test/ai-news"), env);
		expect(await section.text()).toContain(ASSIST_LINE);
		expect((env as { AI: { run: ReturnType<typeof vi.fn> } }).AI.run).not.toHaveBeenCalled();
	});

	it("does not call Workers AI when the scheduled bindings are missing", async () => {
		const env = { AI: { run: vi.fn() }, ASSETS: { fetch: vi.fn() }, AI_NEWS_PUBLISHING: "on" } as never;
		await worker.scheduled({ scheduledTime: Date.now(), cron: "7 * * * *" } as never, env, { waitUntil: vi.fn() } as never);
		expect((env as { AI: { run: ReturnType<typeof vi.fn> } }).AI.run).not.toHaveBeenCalled();
	});

	it("does not open D1 while publishing is off", async () => {
		const env = {
			AI: { run: vi.fn() },
			ASSETS: { fetch: vi.fn() },
			AI_NEWS_PUBLISHING: "off",
			AI_NEWS_DB: { prepare: () => { throw new Error("touched d1"); } },
			GITHUB_IMAGES_TOKEN: "ghp-test",
		} as never;
		const waitUntil = vi.fn();
		await worker.scheduled({ scheduledTime: Date.now(), cron: "7 * * * *" } as never, env, { waitUntil } as never);
		expect((env as { AI: { run: ReturnType<typeof vi.fn> } }).AI.run).not.toHaveBeenCalled();
	});

	it("serves an empty desk when the database is missing", async () => {
		const env = {
			AI_NEWS_SITE_ORIGIN: "https://3aik.com",
			AI_NEWS_DB: { prepare() { throw new Error("no such database"); } },
		} as never;
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news"), env);
		expect(index.status).toBe(200);
		expect(await index.text()).toContain("No stories are published yet");
		const missing = await handleNewsRequest(new Request("https://3aik.test/ai-news/article/missing"), env);
		expect(missing.status).toBe(404);
		const llms = await handleNewsRequest(new Request("https://3aik.test/llms.txt"), env);
		expect((await llms.text()).startsWith("# 3aik News")).toBe(true);
	});

	it("ignores the query string in the edge cache key", () => {
		const first = newsCacheRequest(new Request("https://3aik.com/ai-news/article/demo?utm_source=rss"));
		const second = newsCacheRequest(new Request("https://3aik.com/ai-news/article/demo?fbclid=abc"));
		expect(first.url).toBe(second.url);
		expect(first.url).toBe("https://3aik.com/ai-news/article/demo");
	});
});

describe("magazine pages", () => {
	function secondArticle(): StoredArticle {
		return {
			...article(),
			id: "33333333-3333-4333-8333-333333333333",
			slug: "second-brief",
			title: "A second brief stays inside the same narrow note",
			description: "Another outlet note, retold without adding a score or a price.",
			category: "technology",
			authorId: "caleb-ortiz",
			publishedAt: "2026-10-22T12:07:00.000Z",
			updatedAt: "2026-10-22T12:07:00.000Z",
			imageKey: "images/2026/10/second-brief.jpg",
			related: [{ slug: "short-bulletin", title: "A short bulletin, retold with the blanks left blank" }],
		};
	}

	it("measures reading time and relative time from a fixed clock", () => {
		expect(authorInitials("Mira Ellison")).toBe("ME");
		expect(authorInitials("Caleb Ortiz")).toBe("CO");
		expect(readingMinutes("word ".repeat(20))).toBe(1);
		expect(readingMinutes("word ".repeat(460))).toBe(2);
		expect(readingLabel("word")).toBe("1 min read");
		const published = "2026-10-23T12:07:00.000Z";
		const at = (iso: string) => Date.parse(iso);
		expect(relativeTime(published, at("2026-10-23T12:07:30.000Z"))).toBe("just now");
		expect(relativeTime(published, at("2026-10-23T12:12:00.000Z"))).toBe("5 minutes ago");
		expect(relativeTime(published, at("2026-10-23T13:07:00.000Z"))).toBe("1 hour ago");
		expect(relativeTime(published, at("2026-10-23T15:07:00.000Z"))).toBe("3 hours ago");
		expect(relativeTime(published, at("2026-10-24T12:07:00.000Z"))).toBe("1 day ago");
		expect(relativeTime(published, at("2026-10-26T12:07:00.000Z"))).toBe("3 days ago");
		expect(relativeTime(published, at("2026-11-06T12:07:00.000Z"))).toBe("2 weeks ago");
		expect(relativeTime(published, at("2027-01-23T12:07:00.000Z"))).toBe("3 months ago");
		expect(relativeTime(published, at("2028-10-23T12:07:00.000Z"))).toBe("2 years ago");
		expect(relativeTime("not-a-date", at(published))).toBe("recently");
		expect(formatDateline(at("2026-10-24T03:00:00.000Z"))).toEqual({ label: "Saturday, October 24, 2026", iso: "2026-10-24" });
		expect(formatTimestamp(published, at("2026-10-23T18:00:00.000Z"))).toBe("5:07 p.m.");
		expect(formatTimestamp(published, at("2026-10-24T18:00:00.000Z"))).toBe("Oct 23, 5:07 p.m.");
	});

	it("renders a lead, a side stack, a Latest column, and a short-list note", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(article(), secondArticle());
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news"), { AI_NEWS_SITE_ORIGIN: "https://3aik.com" }, { repo });
		const html = await index.text();
		expect(html).toContain('<body class="desk">');
		expect(html).toContain('href="#content">Skip to content</a>');
		expect(html).toContain('class="dateline"');
		expect(html).toContain('<a class="brand" href="https://3aik.com/ai-news">3aik News</a>');
		expect(html).toContain('<a href="https://3aik.com/ai-news/ai">AI</a>');
		expect(html).toContain('<a href="https://3aik.com/ai-news/technology">Tech</a>');
		expect(html).toContain('<a href="https://3aik.com/ai-news/fashion">Fashion</a>');
		expect(html).toContain('<a href="https://3aik.com/ai-news/showbiz">Showbiz</a>');
		expect(html).not.toContain('aria-current="page">Latest</a>');
		expect(html).toContain('class="lead"');
		expect(html).toContain('class="side"');
		expect(html).toContain('class="latest"');
		expect(html).toContain('class="section-label">Latest</h2>');
		expect(html).toContain('width="1600" height="900" loading="eager" fetchpriority="high"');
		expect(html).toContain('width="240" height="160" loading="lazy"');
		expect(html).toContain('class="avatar" aria-hidden="true">ME</span>');
		expect(html).toContain("1 min read");
		expect(html).toContain('class="rel"');
		expect(html).toContain("October 23, 2026");
		expect(html).toContain("More stories will show up here as the desk publishes.");
		expect(html).not.toContain("No stories are published yet");
		expect(html).not.toContain('class="story-index"');
		expect(html).not.toContain("\u2014");
		expect(withoutAdLoader(html)).not.toMatch(/<script[^>]+src=/i);
	});

	it("keeps a story out of Latest after the lead and preserves proper nouns", async () => {
		const repo = new MemoryNewsRepository();
		const lead = article();
		lead.title = "Erin Patterson faces a London court";
		const extras = Array.from({ length: 12 }, (_, index) => `n${index}`).map((name, index) => {
			const story = article();
			story.id = `33333333-3333-4333-8333-33333333333${index}`;
			story.slug = `extra-${name}`;
			story.title = `Melanie Lynskey note ${name}`;
			story.publishedAt = new Date(Date.parse(publishedAt) - (index + 1) * 60 * 60 * 1000).toISOString();
			story.updatedAt = story.publishedAt;
			return story;
		});
		repo.articles.push(lead, ...extras);
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news"), { AI_NEWS_SITE_ORIGIN: "https://3aik.com" }, { repo });
		const html = await index.text();
		expect(html).toContain("Erin Patterson faces a London court");
		expect(html).not.toContain("erin patterson");
		expect(html).not.toContain("Melanie lynskey");
		const latest = html.split('class="latest"')[1]?.split("</aside>")[0] ?? "";
		expect(latest).not.toContain("/article/short-bulletin");
		expect(latest).toContain("extra-");
		expect(html).not.toContain('class="story-index"');
		expect(html).toContain('class="more-stories"');
		expect(html).toContain(">More stories</h2>");
		expect(html).toContain('class="thumb"');
	});

	it("renders the article with a hero, sources, a calm note, and plain share links", async () => {
		const repo = new MemoryNewsRepository();
		const story = article();
		story.related = [{ slug: "second-brief", title: "A second brief stays inside the same narrow note" }];
		repo.articles.push(story);
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		const html = await response.text();
		expect(html).toContain('<nav class="crumbs" aria-label="Breadcrumb">');
		expect(html).toContain('<figure class="hero">');
		expect(html).toContain('alt="Abstract stack of paper rectangles in sand and ink blue on a warm gray field."');
		expect(html).toContain('width="1600" height="900" loading="eager" fetchpriority="high"');
		expect(html).not.toContain('loading="lazy"');
		expect(html).toContain('class="source-line"');
		expect(html).not.toContain('<aside class="sources">');
		expect(html).not.toContain('<aside class="note">');
		expect(html).not.toContain(ACCURACY_DISCLAIMER);
		expect(html.match(/<p class="assist">/g)).toHaveLength(1);
		expect(html.split(ASSIST_LINE)).toHaveLength(4);
		expect(html).toContain(">Related</h2>");
		expect(html).toContain('class="rail"');
		expect(html).toContain('class="kicker"');
		expect(html).toContain('aria-label="Share this article"');
		expect(html).toContain("https://x.com/intent/tweet?url=");
		expect(html).toContain("https://www.linkedin.com/sharing/share-offsite/?url=");
		expect(html).toContain('aria-label="Share on WhatsApp"');
		expect(html).toContain("data-copy=");
		expect(html).toContain("data-native-share");
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('"timeRequired":"PT1M"');
		expect(html).toContain('<a href="https://3aik.com/ai-news/ai" aria-current="page">AI</a>');
		expect(html).not.toContain('<a href="https://3aik.com/ai-news" aria-current="page">');
		expect(html).toContain("class=\"story\"");
		expect(withoutAdLoader(html)).not.toMatch(/<script[^>]+src=/i);
		expect(html).not.toContain("jsdelivr");
	});

	it("uses the same lead layout on category and author pages", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(article());
		const env = { AI_NEWS_SITE_ORIGIN: "https://3aik.com" };
		const category = await handleNewsRequest(new Request("https://3aik.test/ai-news/ai"), env, { repo });
		const categoryHtml = await category.text();
		expect(categoryHtml).toContain('<a href="https://3aik.com/ai-news/ai" aria-current="page">AI</a>');
		expect(categoryHtml).toContain('class="section-row');
		expect(categoryHtml).toContain("More stories will show up here as the desk publishes.");
		const emptyTech = await handleNewsRequest(new Request("https://3aik.test/ai-news/technology"), env, { repo });
		expect(await emptyTech.text()).toContain("No Technology stories are published yet.");
		const author = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/mira-ellison"), env, { repo });
		const authorHtml = await author.text();
		expect(authorHtml).toContain('class="avatar avatar-lg" aria-hidden="true">ME</span>');
		expect(authorHtml).toContain('class="section-row"');
		expect(authorHtml).toContain("not a real person");
		expect(authorHtml).toContain('"@type":"Organization"');
		expect(authorHtml).not.toContain('"@type":"Person"');
	});

	it("keeps an empty desk explicit when nothing is published", async () => {
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news"), { AI_NEWS_SITE_ORIGIN: "https://3aik.com" }, { repo: null });
		const html = await index.text();
		expect(html).toContain("No stories are published yet");
		expect(html).not.toContain("More stories will show up here");
		expect(html).not.toContain('class="lead"');
	});

	it("scopes the stylesheet, stays on system fonts, and clears WCAG AA", () => {
		const css = readFileSync(resolve(root, "public/ai-news.css"), "utf8");
		expect(css).toContain("body.desk");
		expect(css).not.toMatch(/^:root/m);
		expect(css).not.toMatch(/^body \{/m);
		expect(css).toContain("@media (prefers-color-scheme: dark)");
		expect(css).toContain("@media (min-width: 700px)");
		expect(css).toContain("@media (min-width: 1020px)");
		expect(css).toContain("grid-template-columns: minmax(0, 1.7fr) minmax(0, 1.05fr) 16.5rem");
		expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
		expect(css).toContain("width: min(72ch, 100%)");
		expect(css).toContain("line-height: 1.75");
		expect(css).toContain("aspect-ratio: 16 / 9");
		expect(css).toContain("min-height: 280px");
		expect(css).toContain(".visually-hidden");
		expect(css).not.toContain("aspect-ratio: 3 / 2");
		expect(css).toContain("text-transform: uppercase");
		expect(css).toContain(":focus-visible");
		expect(css).not.toContain("box-shadow:");
		expect(css).not.toContain("@import");
		expect(css).not.toContain("@font-face");
		expect(css).not.toContain("fonts.google");
		const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
		expect(contrastPasses(css.slice(0, darkAt))).toBe(true);
		expect(contrastPasses(css.slice(darkAt))).toBe(true);
	});
});

function contrastPasses(block: string): boolean {
	const color = (name: string) => {
		const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
		if (!match?.[1]) throw new Error(`missing --${name}`);
		return match[1];
	};
	const pairs = [
		["ink", "bg"],
		["ink", "paper"],
		["ink", "card"],
		["muted", "bg"],
		["muted", "paper"],
		["muted", "card"],
		["accent", "paper"],
		["accent", "bg"],
		["avatar-fg", "avatar-bg"],
		["ink", "accent-soft"],
		["bg", "ink"],
	];
	return pairs.every(([fore, back]) => contrastRatio(color(fore), color(back)) >= 4.5);
}

function contrastRatio(foreground: string, background: string): number {
	const luminance = (hex: string) => {
		const channels = [1, 3, 5].map((start) => {
			const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
			return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
	};
	const left = luminance(foreground);
	const right = luminance(background);
	const [hi, lo] = left > right ? [left, right] : [right, left];
	return (hi + 0.05) / (lo + 0.05);
}

describe("crawler files", () => {
	it("adds news discovery without removing the original robots and sitemap rules", () => {
		const robots = readFileSync(resolve(root, "public/robots.txt"), "utf8");
		expect(robots).toContain("User-agent: *\nAllow: /");
		expect(robots).toContain("Sitemap: https://3aik.com/sitemap.xml");
		expect(robots).toContain("Sitemap: https://3aik.com/ai-news/sitemap.xml");
		expect(robots).toContain("Sitemap: https://3aik.com/ai-news/news-sitemap.xml");
		for (const bot of ["Googlebot", "Bingbot", "DuckDuckBot", "GPTBot", "OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
			expect(robots).toContain(`User-agent: ${bot}`);
		}
		const sitemap = readFileSync(resolve(root, "public/sitemap.xml"), "utf8");
		expect(sitemap).toContain("https://3aik.com/</loc>");
		expect(sitemap).toContain("https://3aik.com/ai-news</loc>");
		expect(sitemap).not.toContain("https://3aik.com/ai-news/</loc>");
		const serviceWorker = readFileSync(resolve(root, "public/sw.js"), "utf8");
		expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
		expect(serviceWorker).toContain('url.pathname.startsWith("/privacy/")');
		expect(serviceWorker).toContain('url.pathname === "/llms.txt" || url.pathname === "/ai-news"');
	});

	it("keeps em dashes out of the news sources, stylesheet, and docs", () => {
		const files = [
			"public/ai-news.css",
			"docs/ai-news.md",
			"src/news/authors.ts",
			"src/news/html.ts",
			"src/news/config.ts",
		];
		for (const file of files) {
			const text = readFileSync(resolve(root, file), "utf8");
			expect(text, file).not.toMatch(/[\u2014\u2015]/);
			expect(text.replace(/\d\u2013\d/g, ""), file).not.toContain("\u2013");
		}
	});
});
