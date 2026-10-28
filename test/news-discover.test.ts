import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { AI_NEWS_CSS_PATH } from "../src/news/css-asset";
import { enlargeImageUrl, imageCandidates } from "../src/news/lead";
import { clickbaitReason } from "../src/news/quality";
import { handleNewsRequest } from "../src/news/routes";
import { MemoryNewsRepository } from "../src/news/repository";
import { renderRss } from "../src/news/syndication";
import type { StoredArticle } from "../src/news/types";
import { sentenceCaseHeadline, slugify } from "../src/news/text";

const root = resolve(import.meta.dirname, "..");
const HOME_SHA = "66bc6bcf324cb48f618811968002a32852437e3302bd6e91de398a49d42f7ace";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function article(): StoredArticle {
	const publishedAt = "2026-10-23T12:07:00.000Z";
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug: "short-bulletin",
		title: "A short bulletin, retold with the blanks left blank",
		description: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		category: "ai",
		tags: ["desk", "brief"],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The Verge reported a narrow product note.\n\nThe second paragraph stays inside that note.",
		keyPoints: ["The outlet reported a narrow product note and nothing past it."],
		faq: [{ question: "What did the outlet report?", answer: "A narrow product note." }],
		sources: [{ url: "https://www.theverge.com/story", title: "Source note", outlet: "The Verge" }],
		related: [],
		imageKey: "images/2026/10/short-bulletin-22222222-16x9.webp",
		imageCommit: COMMIT,
		imageAlt: "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.",
		imageType: "image/webp",
		imageCredit: "Image: The Verge",
		imageSourceUrl: "https://example.com/photo.jpg",
		publishedAt,
		updatedAt: publishedAt,
	};
}

describe("discover eligibility", () => {
	it("checks the newest article image, robots, json-ld, and canonical", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(article());
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		const html = await response.text();
		const canonical = "https://3aik.com/ai-news/article/short-bulletin";
		expect(html).toContain('name="robots" content="index,follow,max-image-preview:large"');
		expect(html).toContain(`rel="canonical" href="${canonical}"`);
		expect(html).toContain('width="1600" height="900"');
		expect(html).toContain("1600w");
		expect(html).not.toContain("-16x9-800.webp");
		expect(html).not.toContain("-16x9-1200.webp");
		expect(html).not.toContain("-4x3.webp");
		expect(html).not.toContain("-1x1.webp");
		expect(html).toContain('property="og:image:width" content="1600"');
		expect(html).toContain('property="og:image:height" content="900"');
		expect(html).toContain('property="og:image:type" content="image/webp"');
		expect(html).toContain('property="og:title" content="A short bulletin, retold with the blanks left blank"');
		expect(html).toContain("<figcaption>Image: The Verge</figcaption>");
		expect(html).toContain(">Mira Ellison</a>");
		expect(html).toContain("AI persona");
		const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1] ?? ""));
		const news = blocks.find((block) => block["@type"] === "NewsArticle");
		expect(news).toBeTruthy();
		expect(news["@type"]).not.toBe("FAQPage");
		expect(blocks.some((block) => block["@type"] === "FAQPage")).toBe(false);
		expect(news.url).toBe(canonical);
		expect(news.author).toEqual([{ "@type": "Organization", name: "3aik News Desk", url: "https://3aik.com/ai-news/about" }]);
		expect(news.publisher["@type"]).toBe("NewsMediaOrganization");
		expect(news.publisher.name).toBe("3aik News");
		expect(news.publisher.logo).toMatchObject({ width: 512, height: 512 });
		expect(news.isBasedOn[0].url).toBe("https://www.theverge.com/story");
		expect(news.image).toHaveLength(1);
		expect(news.image[0]["@type"]).toBe("ImageObject");
		expect(news.image[0].width).toBeGreaterThanOrEqual(1200);
		expect(news.image[0]).toMatchObject({ width: 1600, height: 900 });
	});

	it("advertises 800 and 1200 crops only after they are stored", async () => {
		const repo = new MemoryNewsRepository();
		const stored = article();
		repo.articles.push(stored);
		repo.backfillJobs.set(stored.id, { reason: "ready", retryAfter: "", pending: "", attempts: 0 });
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		const html = await response.text();
		expect(html).toContain("-16x9-800.webp 800w");
		expect(html).toContain("-16x9-1200.webp 1200w");
		expect(html).toContain("-16x9.webp 1600w");
		const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1] ?? ""));
		const news = blocks.find((block) => block["@type"] === "NewsArticle");
		expect(news.image).toHaveLength(3);
		expect(news.image.map((image: { url: string }) => image.url).join("\n")).toContain("-4x3.webp");
		expect(news.image.map((image: { url: string }) => image.url).join("\n")).toContain("-1x1.webp");
	});

	it("serves the stored 16:9 file when a deferred crop is requested", async () => {
		const webp = Uint8Array.from([
			0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00,
			0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
		]);
		const repo = new MemoryNewsRepository();
		const stored = article();
		repo.articles.push(stored);
		const primary = `https://cdn.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@${COMMIT}/${stored.imageKey}`;
		const fetchImpl = async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url === primary) return new Response(webp, { status: 200, headers: { "content-type": "image/webp" } });
			return new Response("missing", { status: 404 });
		};
		const small = stored.imageKey.replace("-16x9.webp", "-16x9-800.webp");
		const response = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/media/${COMMIT}/${small}`),
			{ AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo, fetchImpl: fetchImpl as typeof fetch },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/webp");
		expect(response.headers.get("cache-control")).toContain("max-age=300");
		expect(response.headers.get("cache-control")).not.toContain("immutable");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp);
	});

	it("keeps the home page bytes identical", async () => {
		const file = readFileSync(resolve(root, "public/index.html"));
		expect(createHash("sha256").update(file).digest("hex")).toBe(HOME_SHA);
		const env = {
			ASSETS: {
				fetch: async (request: Request) => {
					const path = new URL(request.url).pathname;
					if (path === "/" || path === "/index.html") {
						return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
					}
					return new Response("missing", { status: 404 });
				},
			},
		} as never;
		const response = await worker.fetch(new Request("https://3aik.com/"), env);
		const body = Buffer.from(await response.arrayBuffer());
		expect(createHash("sha256").update(body).digest("hex")).toBe(HOME_SHA);
	});

	it("serves the versioned stylesheet with an immutable cache", async () => {
		const css = readFileSync(resolve(root, "public/ai-news.css"));
		const hash = createHash("sha256").update(css).digest("hex").slice(0, 8);
		expect(AI_NEWS_CSS_PATH).toBe(`/ai-news.${hash}.css`);
		let fetched = "";
		const env = {
			ASSETS: {
				fetch: async (request: Request) => {
					fetched = new URL(request.url).pathname;
					return new Response(css, { headers: { "content-type": "text/css" } });
				},
			},
		} as never;
		const response = await worker.fetch(new Request(`https://3aik.com${AI_NEWS_CSS_PATH}`), env);
		expect(fetched).toBe("/ai-news.css");
		expect(response.headers.get("cache-control")).toContain("immutable");
		expect(response.headers.get("cache-control")).toContain("max-age=31536000");
		expect(await response.text()).toContain("min-height: 280px");
	});

	it("normalizes headlines, rejects clickbait, and cuts new slugs on a word", () => {
		expect(sentenceCaseHeadline("OpenAI Ships A New GPT-5 Model")).toBe("OpenAI ships a new GPT-5 model");
		expect(clickbaitReason("You won't believe this launch")).toBe("clickbait");
		expect(clickbaitReason("A shocking price cut lands")).toBe("clickbait");
		expect(clickbaitReason("VENDOR POSTS A NOTE TODAY")).toBe("clickbait");
		expect(clickbaitReason("A calm bulletin stays inside the note!")).toBe("clickbait");
		expect(clickbaitReason("A calm bulletin stays inside the note")).toBeNull();
		const slug = slugify("alpha beta ".repeat(20));
		expect(slug.length).toBeLessThanOrEqual(70);
		expect(slug.endsWith("-")).toBe(false);
		expect(slug.split("-").every((part) => part === "alpha" || part === "beta")).toBe(true);
		expect(enlargeImageUrl("https://cdn.example/photo-1024x576.jpg?w=800")).toBe("https://cdn.example/photo.jpg");
		const candidates = imageCandidates("https://cdn.example/a.jpg?w=400", `<img srcset="https://cdn.example/a-1600.jpg 1600w, https://cdn.example/a.jpg 400w">`);
		expect(candidates[0]).toBe("https://cdn.example/a-1600.jpg");
	});

	it("puts a self link, media, and encoded body on the feed", () => {
		const xml = renderRss("https://3aik.com", [article()]);
		expect(xml).toContain('<atom:link href="https://3aik.com/ai-news/feed.xml" rel="self" type="application/rss+xml"/>');
		expect(xml).toContain('medium="image" type="image/webp" width="1600" height="900"');
		expect(xml).toContain("<content:encoded><![CDATA[");
		expect(xml).toContain("TL;DR");
		expect(xml).toContain("3aik News Desk");
	});
});
