import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { ACCURACY_DISCLAIMER, DESK_DISCLOSURE } from "../src/news/config";
import { handleNewsRequest, newsCacheRequest } from "../src/news/routes";
import { MemoryNewsRepository } from "../src/news/repository";
import type { StoredArticle } from "../src/news/types";
import { TINY_JPEG } from "../src/news/text";

const root = resolve(import.meta.dirname, "..");
const publishedAt = "2026-10-23T12:07:00.000Z";

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
		imageKey: "images/2026/10/short-bulletin.jpg",
		imageAlt: "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.",
		imageType: "image/jpeg",
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
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news/"), env, { repo: null });
		const html = await index.text();
		expect(index.status).toBe(200);
		expect(html).toContain(DESK_DISCLOSURE);
		expect(html).toContain(ACCURACY_DISCLAIMER);
		expect(html).toContain('href="/ai-news.css"');
		expect(html).not.toMatch(/<script[^>]+src=/i);

		const about = await handleNewsRequest(new Request("https://3aik.test/ai-news/about"), env, { repo: null });
		expect(await about.text()).toContain("not real people");
		const disclaimer = await handleNewsRequest(new Request("https://3aik.test/ai-news/disclaimer"), env, { repo: null });
		expect(await disclaimer.text()).toContain(ACCURACY_DISCLAIMER);
	});

	it("renders article metadata, structured data, and the persona footer", async () => {
		const { repo } = desk();
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		const html = await response.text();
		expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
		expect(response.headers.get("content-security-policy")).toContain("img-src 'self'");
		expect(response.headers.get("content-security-policy")).not.toContain("jsdelivr");
		expect(html).toContain("https://3aik.com/ai-news/media/images/2026/10/short-bulletin.jpg");
		expect(html).not.toContain("cdn.jsdelivr.net");
		expect(html).toContain("<title>A short bulletin, retold with the blanks left blank | 3aik News</title>");
		expect(html).toContain('name="description"');
		expect(html).toContain('rel="canonical" href="https://3aik.com/ai-news/article/short-bulletin"');
		expect(html).toContain('property="og:title"');
		expect(html).toContain('name="twitter:card" content="summary_large_image"');
		expect(html).toContain('"@type":"NewsArticle"');
		expect(html).toContain(`"datePublished":"${publishedAt}"`);
		expect(html).toContain('"@type":"BreadcrumbList"');
		expect(html).toContain('"@type":"FAQPage"');
		expect(html).toContain("TL;DR");
		expect(html).toContain("https://www.theverge.com/ai-artificial-intelligence/1017151/canva-craft-in-house-ai-model");
		expect(html).toContain("Mira Ellison is an editorial persona, not a real person.");
		expect(html).toContain(ACCURACY_DISCLAIMER);
		expect(html).toContain("AI-generated");
		expect(html).toContain('"@type":"Organization"');
		expect(html).not.toContain('"@type":"Person"');
		expect(html).toContain("The Verge reported a narrow product note.");
		expect(html).not.toContain("STORED_HTML_SHOULD_NOT_RENDER");
		expect(html).not.toContain("<script>alert");
		expect(html).not.toContain("\u2014");
	});

	it("serves the image, feeds, sitemaps, llms.txt, and the IndexNow key", async () => {
		const { repo } = desk();
		const env = { AI_NEWS_SITE_ORIGIN: "https://3aik.com", INDEXNOW_KEY: "index-key" };
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === "https://cdn.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@main/images/2026/10/short-bulletin.jpg") {
				return new Response(TINY_JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
			}
			return new Response("no", { status: 404 });
		});
		const image = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/media/images/2026/10/short-bulletin.jpg"),
			env,
			{ repo, fetchImpl: fetchImpl as typeof fetch },
		);
		expect(image.headers.get("content-type")).toBe("image/jpeg");
		expect(image.headers.get("cache-control")).toContain("immutable");
		expect(image.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(new Uint8Array(await image.arrayBuffer())).toEqual(TINY_JPEG);
		const blocked = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/media/images/2026/10/../secret.jpg"),
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
		expect(await sitemap.text()).toContain("https://3aik.com/ai-news/article/short-bulletin");
		const news = await handleNewsRequest(new Request("https://3aik.test/ai-news/news-sitemap.xml"), env, { repo });
		expect(await news.text()).toContain("news:news");

		const llms = await handleNewsRequest(new Request("https://3aik.test/llms.txt"), env, { repo });
		expect(await llms.text()).toContain("https://3aik.com/ai-news");
		const key = await handleNewsRequest(new Request("https://3aik.test/index-key.txt"), env, { repo });
		expect(await key.text()).toBe("index-key");

		const author = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/mira-ellison"), env, { repo });
		expect(await author.text()).toContain("not a real person");
		const missing = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/not-a-persona"), env, { repo });
		expect(missing.status).toBe(404);
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
		expect(await section.text()).toContain(ACCURACY_DISCLAIMER);
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
		expect(sitemap).toContain("https://3aik.com/ai-news/</loc>");
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
