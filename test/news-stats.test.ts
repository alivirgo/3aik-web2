import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleNewsRequest } from "../src/news/routes";
import { D1NewsRepository, MemoryNewsRepository } from "../src/news/repository";
import { pageViewFromRequest } from "../src/news/pageviews";
import type { StoredArticle } from "../src/news/types";

const TOKEN = "cd".repeat(32);
const SECRET_TITLE = "SECRET_STORY_TITLE_ZZZ";
const IP = "203.0.113.50";
const AGENT = "Mozilla/5.0 UniqueAgentTokenXYZ";

function article(): StoredArticle {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug: "short-bulletin",
		title: SECRET_TITLE,
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
		imageKey: "",
		imageCommit: "",
		imageAlt: "",
		imageType: "",
		imageCredit: "",
		imageSourceUrl: "",
		publishedAt: "2026-10-23T12:07:00.000Z",
		updatedAt: "2026-10-23T12:07:00.000Z",
	};
}

function env() {
	return { AI_NEWS_INGEST_TOKEN: TOKEN, AI_NEWS_SITE_ORIGIN: "https://3aik.com" };
}

function desk() {
	const repo = new MemoryNewsRepository();
	repo.articles.push(article());
	return repo;
}

describe("pageview classification", () => {
	it("keeps the search query that was actually sent and drops IP, user agent, and other query params", () => {
		const request = new Request("https://3aik.test/ai-news/article/short-bulletin?utm_source=newsletter&utm_medium=email&utm_campaign=fall&fbclid=SECRETCLICK", {
			headers: {
				referer: "https://www.google.com/search?q=robot+hands&oq=SECRET_OQ&ie=UTF-8",
				"user-agent": AGENT,
				"cf-connecting-ip": IP,
				cookie: `session=${TOKEN}`,
			},
		});
		Object.defineProperty(request, "cf", { value: { country: "US" } });
		const event = pageViewFromRequest(request, { slug: "short-bulletin", page: "article" }, new Date("2026-10-26T13:00:00.000Z"), "3aik.com");
		expect(event).toMatchObject({
			slug: "short-bulletin",
			page: "article",
			referrerHost: "www.google.com",
			referrerPath: "/search",
			sourceClass: "search",
			searchEngine: "Google",
			searchQuery: "robot hands",
			utmSource: "newsletter",
			utmMedium: "email",
			utmCampaign: "fall",
			utmTerm: "",
			country: "US",
			deviceClass: "other",
			bot: 0,
		});
		const packed = JSON.stringify(event);
		expect(packed).not.toContain(IP);
		expect(packed).not.toContain("SECRET_OQ");
		expect(packed).not.toContain("SECRETCLICK");
		expect(packed).not.toContain("UniqueAgentTokenXYZ");
		expect(packed).not.toContain(TOKEN);
		expect(Object.keys(event)).not.toContain("ip");
		expect(Object.keys(event)).not.toContain("userAgent");
	});

	it("classifies direct, internal, and social referrers and flags crawlers", () => {
		const direct = pageViewFromRequest(
			new Request("https://3aik.test/ai-news"),
			{ slug: "", page: "index" },
			new Date(),
			"3aik.com",
		);
		expect(direct.sourceClass).toBe("direct");
		expect(direct.searchQuery).toBe("");
		const internal = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin", { headers: { referer: "https://3aik.com/ai-news" } }),
			{ slug: "short-bulletin", page: "article" },
			new Date(),
			"3aik.com",
		);
		expect(internal.sourceClass).toBe("internal");
		const social = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin", { headers: { referer: "https://t.co/abc" } }),
			{ slug: "short-bulletin", page: "article" },
			new Date(),
			"3aik.com",
		);
		expect(social.sourceClass).toBe("social");
		expect(social.referrerPath).toBe("/abc");
		const bot = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }),
			{ slug: "short-bulletin", page: "article" },
			new Date(),
			"3aik.com",
		);
		expect(bot.bot).toBe(1);
		const phone = pageViewFromRequest(
			new Request("https://3aik.test/ai-news", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile" } }),
			{ slug: "", page: "index" },
			new Date(),
			"3aik.com",
		);
		expect(phone.deviceClass).toBe("mobile");
		expect(phone.bot).toBe(0);
		const fromUtm = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin?utm_source=google&utm_medium=organic&utm_term=desk+note"),
			{ slug: "short-bulletin", page: "article" },
			new Date(),
			"3aik.com",
		);
		expect(fromUtm.sourceClass).toBe("search");
		expect(fromUtm.searchEngine).toBe("Google");
		expect(fromUtm.searchQuery).toBe("desk note");
	});
});

describe("private stats", () => {
	async function read(response: Response): Promise<string> {
		return response.text();
	}

	it("returns 404 for missing, wrong, query, and cookie credentials and does not leak rows", async () => {
		const repo = desk();
		repo.pageViews.push({
			viewedAt: "2026-10-26T12:00:00.000Z",
			slug: "short-bulletin",
			page: "article",
			referrerHost: "www.google.com",
			referrerPath: "/search",
			sourceClass: "search",
			searchEngine: "Google",
			searchQuery: "robot hands",
			utmSource: "",
			utmMedium: "",
			utmCampaign: "",
			utmTerm: "",
			country: "US",
			deviceClass: "desktop",
			bot: 0,
		});
		const cases = [
			new Request("https://3aik.test/ai-news/api/stats"),
			new Request("https://3aik.test/ai-news/api/stats", { headers: { authorization: "Bearer wrong-token" } }),
			new Request(`https://3aik.test/ai-news/api/stats?token=${TOKEN}`),
			new Request(`https://3aik.test/ai-news/api/stats?access_token=${TOKEN}`, { headers: { authorization: `Bearer ${TOKEN}` } }),
			new Request("https://3aik.test/ai-news/api/stats", { headers: { cookie: `token=${TOKEN}` } }),
			new Request("https://3aik.test/ai-news/api/stats/dashboard", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }),
		];
		for (const request of cases) {
			const response = await handleNewsRequest(request, env(), { repo });
			expect(response.status, request.url).toBe(404);
			expect(response.headers.get("cache-control")).toContain("no-store");
			expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
			expect(response.headers.get("cdn-cache-control")).toBe("no-store");
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			const body = await read(response);
			expect(body).not.toContain(SECRET_TITLE);
			expect(body).not.toContain("robot hands");
			expect(body).not.toContain("www.google.com");
			expect(body.toLowerCase()).not.toContain("unauthorized");
		}

		const workerEnv = env() as never;
		const posted = await worker.fetch(new Request("https://3aik.test/ai-news/api/stats", { method: "POST" }), workerEnv);
		expect(posted.status).toBe(404);
		const open = await worker.fetch(new Request("https://3aik.test/ai-news/api/stats"), workerEnv);
		expect(open.status).toBe(404);
		expect((await open.text())).not.toContain(SECRET_TITLE);
	});

	it("serves JSON and HTML to the ingest bearer and excludes bots", async () => {
		const repo = desk();
		const now = new Date("2026-10-26T13:00:00.000Z");
		await repo.recordPageView({
			viewedAt: "2026-10-26T12:30:00.000Z",
			slug: "short-bulletin",
			page: "article",
			referrerHost: "www.google.com",
			referrerPath: "/search",
			sourceClass: "search",
			searchEngine: "Google",
			searchQuery: "robot hands",
			utmSource: "newsletter",
			utmMedium: "email",
			utmCampaign: "fall",
			utmTerm: "",
			country: "US",
			deviceClass: "desktop",
			bot: 0,
		});
		await repo.recordPageView({
			viewedAt: "2026-10-20T12:30:00.000Z",
			slug: "short-bulletin",
			page: "article",
			referrerHost: "",
			referrerPath: "",
			sourceClass: "direct",
			searchEngine: "",
			searchQuery: "",
			utmSource: "",
			utmMedium: "",
			utmCampaign: "",
			utmTerm: "",
			country: "DE",
			deviceClass: "mobile",
			bot: 0,
		});
		await repo.recordPageView({
			viewedAt: "2026-10-26T12:40:00.000Z",
			slug: "short-bulletin",
			page: "article",
			referrerHost: "",
			referrerPath: "",
			sourceClass: "direct",
			searchEngine: "",
			searchQuery: "",
			utmSource: "",
			utmMedium: "",
			utmCampaign: "",
			utmTerm: "",
			country: "US",
			deviceClass: "other",
			bot: 1,
		});
		const headers = { authorization: `Bearer ${TOKEN}` };
		const jsonResponse = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats", { headers }),
			env(),
			{ repo, now },
		);
		expect(jsonResponse.status).toBe(200);
		expect(jsonResponse.headers.get("content-type")).toContain("application/json");
		expect(jsonResponse.headers.get("cache-control")).toContain("no-store");
		expect(jsonResponse.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		expect(jsonResponse.headers.get("access-control-allow-origin")).toBeNull();
		const body = await jsonResponse.json() as {
			totals: { views: number; last24h: number; last7d: number; botHitsExcluded: number };
			articles: Array<{ slug: string; title: string; views: number; last24h: number; last7d: number }>;
			queries: Array<{ query: string }>;
			countries: Array<{ country: string }>;
			sources: Array<{ source: string }>;
		};
		expect(body.totals).toEqual({ views: 2, last24h: 1, last7d: 2, botHitsExcluded: 1 });
		expect(body.articles[0]).toMatchObject({ slug: "short-bulletin", title: SECRET_TITLE, views: 2, last24h: 1, last7d: 2 });
		expect(body.queries.map((row) => row.query)).toEqual(["robot hands"]);
		expect(body.countries.map((row) => row.country).sort()).toEqual(["DE", "US"]);
		expect(body.sources.map((row) => row.source).sort()).toEqual(["direct", "search"]);
		expect(JSON.stringify(body)).not.toContain(IP);

		const dashboard = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats/dashboard", { headers }),
			env(),
			{ repo, now },
		);
		expect(dashboard.status).toBe(200);
		expect(dashboard.headers.get("content-type")).toContain("text/html");
		const html = await dashboard.text();
		expect(html).toContain(SECRET_TITLE);
		expect(html).toContain("robot hands");
		expect(html).toContain("Last 24 hours");
		expect(html).not.toContain("adsbygoogle");
		expect(html).not.toContain(IP);

		const sitemap = await handleNewsRequest(new Request("https://3aik.test/ai-news/sitemap.xml"), env(), { repo });
		expect(await sitemap.text()).not.toContain("/ai-news/api/stats");
		const page = await handleNewsRequest(new Request("https://3aik.test/ai-news"), env(), { repo });
		expect(await page.text()).not.toContain("/ai-news/api/stats");
	});

	it("records a pageview after the response and never stores the IP or user agent", async () => {
		const repo = desk();
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started = false;
		const stored: unknown[] = [];
		repo.recordPageView = async (event) => {
			started = true;
			await gate;
			stored.push(event);
			repo.pageViews.push(event);
		};
		const jobs: Array<Promise<unknown>> = [];
		const ctx = { waitUntil(job: Promise<unknown>) { jobs.push(job); } } as ExecutionContext;
		const request = new Request("https://3aik.test/ai-news/article/short-bulletin?fbclid=SECRETCLICK", {
			headers: {
				referer: "https://www.google.com/search?q=robot+hands&oq=SECRET_OQ",
				"user-agent": AGENT,
				"cf-connecting-ip": IP,
			},
		});
		const pending = handleNewsRequest(request, env(), { repo }, ctx);
		const response = await Promise.race([
			pending,
			new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("handler waited on the pageview write")), 400)),
		]);
		expect(response.status).toBe(200);
		expect(started).toBe(true);
		expect(stored).toHaveLength(0);
		release();
		await Promise.all(jobs);
		expect(stored).toHaveLength(1);
		const packed = JSON.stringify(stored[0]);
		expect(packed).not.toContain(IP);
		expect(packed).not.toContain("UniqueAgentTokenXYZ");
		expect(packed).not.toContain("SECRET_OQ");
		expect(packed).not.toContain("SECRETCLICK");
		expect(packed).toContain("robot hands");
	});

	it("writes only the allowlisted columns to D1", async () => {
		const calls: Array<{ sql: string; binds: unknown[] }> = [];
		const db = {
			prepare(sql: string) {
				return {
					bind(...binds: unknown[]) {
						return {
							async run() {
								calls.push({ sql, binds });
								return { meta: { changes: 1 } };
							},
						};
					},
				};
			},
		};
		const repo = new D1NewsRepository(db as unknown as D1Database);
		const request = new Request("https://3aik.test/ai-news/article/short-bulletin", {
			headers: { "user-agent": AGENT, "cf-connecting-ip": IP },
		});
		const event = pageViewFromRequest(request, { slug: "short-bulletin", page: "article" }, new Date("2026-10-26T13:00:00.000Z"), "3aik.com");
		await repo.recordPageView(event);
		const insert = calls.find((call) => call.sql.toLowerCase().includes("insert into page_views"));
		expect(insert).toBeTruthy();
		const packedSql = calls.map((call) => call.sql.toLowerCase()).join("\n");
		expect(packedSql).toContain("insert into page_views");
		expect(packedSql).toContain("stats_daily");
		expect(packedSql).not.toMatch(/user_agent|cf_connecting_ip|\bip\b|cookie/);
		const packed = JSON.stringify(calls.flatMap((call) => call.binds));
		expect(packed).not.toContain(IP);
		expect(packed).not.toContain("UniqueAgentTokenXYZ");
	});
});
