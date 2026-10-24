import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { ADS_TXT, ADSENSE_HOSTS, ADSENSE_SCRIPT } from "../src/adsense";
import { handleNewsRequest } from "../src/news/routes";
import { MemoryNewsRepository } from "../src/news/repository";
import type { StoredArticle } from "../src/news/types";

const root = resolve(import.meta.dirname, "..");
const HOSTS = ADSENSE_HOSTS.split(" ");

function article(): StoredArticle {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug: "short-bulletin",
		title: "A short bulletin, retold with the blanks left blank",
		description: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		category: "ai",
		tags: ["desk", "brief"],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The Verge reported a narrow product note.",
		keyPoints: ["The outlet reported a narrow product note and nothing past it."],
		faq: [{ question: "What did the outlet report?", answer: "A narrow product note." }],
		sources: [{ url: "https://example.com/story", title: "A source", outlet: "The Verge" }],
		related: [],
		imageKey: "images/2026/10/short-bulletin.jpg",
		imageCommit: "0123456789abcdef0123456789abcdef01234567",
		imageAlt: "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.",
		imageType: "image/jpeg",
		publishedAt: "2026-10-23T12:07:00.000Z",
		updatedAt: "2026-10-23T12:07:00.000Z",
	};
}

async function newsHtml(path: string): Promise<{ status: number; html: string; csp: string }> {
	const repo = new MemoryNewsRepository();
	repo.articles.push(article());
	const response = await handleNewsRequest(
		new Request(`https://3aik.test${path}`),
		{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
		{ repo },
	);
	return {
		status: response.status,
		html: await response.text(),
		csp: response.headers.get("content-security-policy") ?? "",
	};
}

function expectAdsenseCsp(csp: string): void {
	for (const directive of ["script-src", "img-src", "frame-src", "connect-src"]) {
		const match = csp.match(new RegExp(`${directive} [^;]+`));
		expect(match, directive).toBeTruthy();
		for (const host of HOSTS) expect(match?.[0], `${directive} ${host}`).toContain(host);
	}
	expect(csp).toContain("img-src 'self'");
	expect(csp).not.toContain("jsdelivr");
	expect(csp).not.toContain("cdn.jsdelivr.net");
}

function expectAdsenseDocument(csp: string, html: string): void {
	expect(html.split(ADSENSE_SCRIPT)).toHaveLength(2);
	const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
	expect(head).toContain(ADSENSE_SCRIPT);
	expect(html.slice(html.indexOf("<body>"))).not.toContain("adsbygoogle");
	expectAdsenseCsp(csp);
}

describe("AdSense on public HTML", () => {
	it("adds the loader and CSP to every news HTML page and leaves feeds alone", async () => {
		for (const path of [
			"/ai-news",
			"/ai-news/ai",
			"/ai-news/author/mira-ellison",
			"/ai-news/article/short-bulletin",
			"/ai-news/about",
			"/ai-news/disclaimer",
		]) {
			const page = await newsHtml(path);
			expect(page.status, path).toBe(200);
			expectAdsenseDocument(page.csp, page.html);
		}

		const missing = await newsHtml("/ai-news/article/missing");
		expect(missing.status).toBe(404);
		expectAdsenseDocument(missing.csp, missing.html);

		const feed = await newsHtml("/ai-news/feed.xml");
		expect(feed.html).not.toContain("adsbygoogle");
		expect(feed.csp).toContain("script-src 'none'");
		expect(feed.csp).not.toContain("pagead2.googlesyndication.com");
	});

	it("adds only the script tag to the home page and the privacy page", () => {
		const home = readFileSync(resolve(root, "public/index.html"), "utf8");
		const privacy = readFileSync(resolve(root, "public/privacy/index.html"), "utf8");
		expect(home.split(ADSENSE_SCRIPT)).toHaveLength(2);
		expect(privacy.split(ADSENSE_SCRIPT)).toHaveLength(2);
		expect(home).toContain('<script src="/chat.js" defer></script>');
		expect(home).toContain("Skip to workspace");
		expect(privacy).toContain("No advertising trackers");
		const homeHead = home.slice(home.indexOf("<head>"), home.indexOf("</head>"));
		expect(homeHead).toContain(ADSENSE_SCRIPT);
		expect(home.slice(home.indexOf("<body>"))).not.toContain("adsbygoogle");
	});

	it("opens the home CSP for AdSense and still allows first-party scripts and images", async () => {
		const env = {
			AI: { run: vi.fn() },
			ASSETS: { fetch: vi.fn(async () => new Response("asset", { headers: { "content-type": "text/html" } })) },
		} as never;
		const home = await worker.fetch(new Request("https://3aik.test/"), env);
		const csp = home.headers.get("content-security-policy") ?? "";
		expectAdsenseCsp(csp);
		expect(csp).toContain("script-src 'self'");
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("img-src 'self' data: blob:");
		const health = await worker.fetch(new Request("https://3aik.test/api/health"), env);
		expect(health.headers.get("content-security-policy")).toBeNull();
		expect(await health.text()).not.toContain("adsbygoogle");
	});

	it("serves the root ads.txt line and does not add a second copy", async () => {
		expect(readFileSync(resolve(root, "public/ads.txt"), "utf8")).toBe(ADS_TXT);
		const env = {
			ASSETS: {
				fetch: vi.fn(async (request: Request) => {
					expect(new URL(request.url).pathname).toBe("/ads.txt");
					return new Response(ADS_TXT, { headers: { "content-type": "text/plain; charset=utf-8" } });
				}),
			},
		} as never;
		const response = await worker.fetch(new Request("https://3aik.test/ads.txt"), env);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(ADS_TXT);
		expect(response.headers.get("content-type")).toContain("text/plain");
	});
});
