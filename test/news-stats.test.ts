import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleNewsRequest } from "../src/news/routes";
import { D1NewsRepository, MemoryNewsRepository } from "../src/news/repository";
import { emptyStatsReport, pageViewFromRequest } from "../src/news/pageviews";
import { formatDuration, formatPercent, renderStatsCsv, renderStatsDashboard } from "../src/news/stats";
import { resetAggregates } from "../src/news/aggregates";
import type { StoredArticle } from "../src/news/types";

const STATS_BEARER = "stats-desk-bearer-0123456789abcdef0123456789abcd";
const STATS_SHA = createHash("sha256").update(STATS_BEARER).digest("hex");

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
	return {
		AI_NEWS_INGEST_TOKEN: TOKEN,
		AI_NEWS_STATS_TOKEN_SHA256: STATS_SHA,
		AI_NEWS_SITE_ORIGIN: "https://3aik.com",
	};
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
		const publicMiss = await handleNewsRequest(new Request("https://3aik.test/ai-news/not-a-real-page"), env(), { repo });
		for (const request of cases) {
			const response = await handleNewsRequest(request, env(), { repo });
			expect(response.status, request.url).toBe(404);
			expect(response.headers.get("cache-control")).toBe(publicMiss.headers.get("cache-control"));
			expect(response.headers.get("x-robots-tag")).toBe(publicMiss.headers.get("x-robots-tag"));
			expect(response.headers.get("cdn-cache-control")).toBe(publicMiss.headers.get("cdn-cache-control"));
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			const strip = (value: string | null) => (value ?? "").replace(/'nonce-[^']+'/g, "'nonce'");
			expect(strip(response.headers.get("content-security-policy"))).toBe(strip(publicMiss.headers.get("content-security-policy")));
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
		const headers = { authorization: `Bearer ${STATS_BEARER}` };
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
		expect(packedSql).toContain("delete from stats_visitor_day");
		expect(packedSql).toContain("delete from stats_day_salt");
	});

	it("rejects the ingest token on every stats route", async () => {
		const repo = desk();
		const paths = [
			"/ai-news/api/stats",
			"/ai-news/api/stats/dashboard",
			"/ai-news/api/stats.csv",
			"/ai-news/api/stats/article/short-bulletin",
		];
		for (const path of paths) {
			const response = await handleNewsRequest(
				new Request(`https://3aik.test${path}`, { headers: { authorization: `Bearer ${TOKEN}` } }),
				env(),
				{ repo },
			);
			expect(response.status, path).toBe(404);
		}
		const locked = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats", { headers: { authorization: `Bearer ${TOKEN}` } }),
			{ AI_NEWS_INGEST_TOKEN: TOKEN, AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo },
		);
		expect(locked.status).toBe(404);
		const leaked = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/api/stats?from=2026-10-01&token=${STATS_BEARER}`, { headers: { authorization: `Bearer ${STATS_BEARER}` } }),
			env(),
			{ repo },
		);
		expect(leaked.status).toBe(404);
	});

	it("draws axis charts and formats engaged time and bounce rate", () => {
		expect(formatDuration(125000)).toBe("2:05");
		expect(formatDuration(4200)).toBe("0:04");
		expect(formatPercent(0.375)).toBe("37.5%");
		const report = emptyStatsReport(new Date("2026-10-26T13:00:00.000Z"));
		report.ready = true;
		report.comparison.current = { ...report.comparison.current, views: 40, uniques: 18, bots: 3, avgEngagedMs: 125000, avgScrollPct: 62, bounceRate: 0.375 };
		report.comparison.previous = { ...report.comparison.previous, views: 20, uniques: 10, bots: 6, avgEngagedMs: 60000, avgScrollPct: 40, bounceRate: 0.5 };
		report.series.day = [
			{ label: "2026-10-24", views: 10, uniques: 4 },
			{ label: "2026-10-25", views: 22, uniques: 9 },
			{ label: "2026-10-26", views: 8, uniques: 5 },
		];
		report.series.hour = [
			{ label: "2026-10-26T08", views: 3, uniques: 2 },
			{ label: "2026-10-26T09", views: 7, uniques: 4 },
		];
		report.queries = [{ engine: "Google", query: "robot hands", views: 2 }];
		const html = renderStatsDashboard(report);
		expect(html).toContain('class="axis"');
		expect(html).toContain('class="bar"');
		const widths = [...html.matchAll(/class="bar"[^>]*width="([0-9.]+)"/g)].map((match) => Number(match[1]));
		expect(widths.length).toBeGreaterThanOrEqual(4);
		expect(Math.max(...widths)).toBeLessThan(40);
		expect(html).toContain("2:05");
		expect(html).toContain("37.5%");
		expect(html).toContain("Last 24 hours");
		expect(html).toContain("Asia/Karachi");
		expect(html).toContain("<svg");
		expect(html).toContain("Last 7 days");
		expect(html).not.toMatch(/jsdelivr|chart\.js|cdnjs|unpkg/i);
		expect(html).not.toContain("<form");
		const csv = renderStatsCsv(report);
		expect(csv).toContain("robot hands");
		const sheet = renderStatsCsv({
			...report,
			queries: [{ engine: "Google", query: "=cmd", views: 1 }, { engine: "Google", query: " @hidden", views: 1 }],
		});
		expect(sheet).toContain(`"'=cmd"`);
		expect(sheet).toContain(`"' @hidden"`);
	});

	it("stores bots and unknown paths as daily counters, not pageview rows", async () => {
		resetAggregates();
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
		const base = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/missing", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }),
			{ slug: "", page: "/ai-news/article/missing" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		base.eventKind = "view";
		await repo.recordPageView(base);
		const botSql = calls.map((call) => call.sql.toLowerCase()).join("\n");
		expect(botSql).toContain("stats_bot_daily");
		expect(botSql).not.toContain("insert into page_views");
		calls.length = 0;
		resetAggregates();
		const miss = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/nope", { headers: { "user-agent": "Mozilla/5.0" } }),
			{ slug: "", page: "/ai-news/nope" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		miss.eventKind = "404";
		await repo.recordPageView(miss);
		const missSql = calls.map((call) => call.sql.toLowerCase()).join("\n");
		expect(missSql).toContain("stats_miss_daily");
		expect(missSql).not.toContain("insert into page_views");
	});

	it("strips email and phone strings from stored queries", () => {
		const event = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin?utm_term=reach+ada%40example.com+or+%2B1+202+555+0143"),
			{ slug: "short-bulletin", page: "article" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		expect(event.utmTerm).not.toContain("ada@example.com");
		expect(event.utmTerm).not.toContain("202");
		expect(event.utmTerm.toLowerCase()).toContain("redacted");
	});
});
