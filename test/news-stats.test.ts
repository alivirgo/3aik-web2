import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleNewsRequest } from "../src/news/routes";
import { D1NewsRepository, MemoryNewsRepository } from "../src/news/repository";
import { emptyStatsReport, pageViewFromRequest } from "../src/news/pageviews";
import { expectedStatsDigest, formatDuration, formatPercent, NEWS_STATS_DIGEST, renderStatsCsv, renderStatsDashboard, resetStatsDigestWarning, statsQueryFromUrl } from "../src/news/stats";
import { allowStatsLane } from "../src/news/ratelimit";
import { loadD1StatsReport } from "../src/news/d1-stats";
import { NewsStatsBudget, STATS_DAILY_WRITE_CAP } from "../src/news/budget";
import { resetAggregates } from "../src/news/aggregates";
import type { StoredArticle } from "../src/news/types";

const STATS_BEARER = ["stats", "desk", "bearer", "0123456789abcdef", "0123456789abcd"].join("-");
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
		NEWS_STATS_RATE_LIMITER: { async limit() { return { success: true }; } },
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

	it("serves JSON and HTML to the stats bearer and excludes bots", async () => {
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

	it("records a beacon view after the response and never stores the IP or user agent", async () => {
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
		const page = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin?fbclid=SECRETCLICK", {
				headers: {
					referer: "https://www.google.com/search?q=robot+hands&oq=SECRET_OQ",
					"user-agent": AGENT,
					"cf-connecting-ip": IP,
				},
			}),
			env(),
			{ repo },
			ctx,
		);
		expect(page.status).toBe(200);
		expect(started).toBe(false);
		expect(jobs).toHaveLength(0);
		const request = new Request("https://3aik.test/ai-news/api/collect?fbclid=SECRETCLICK", {
			method: "POST",
			headers: {
				origin: "https://3aik.test",
				"content-type": "application/json",
				referer: "https://www.google.com/search?q=robot+hands&oq=SECRET_OQ",
				"user-agent": AGENT,
				"cf-connecting-ip": IP,
			},
			body: JSON.stringify({ kind: "view", page: "article", slug: "short-bulletin", returning: 0 }),
		});
		const pending = handleNewsRequest(request, env(), { repo }, ctx);
		const response = await Promise.race([
			pending,
			new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("handler waited on the pageview write")), 400)),
		]);
		expect(response.status).toBe(204);
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
		const repo = new D1NewsRepository(db as unknown as D1Database, { budget: { async open() { return true; }, async charge() {} } });
		const request = new Request("https://3aik.test/ai-news/article/short-bulletin", {
			headers: { "user-agent": AGENT, "cf-connecting-ip": IP },
		});
		const event = pageViewFromRequest(request, { slug: "short-bulletin", page: "article" }, new Date("2026-10-26T13:00:00.000Z"), "3aik.com");
		event.visitorHash = "ab".repeat(32);
		await repo.recordPageView(event);
		const packedSql = calls.map((call) => call.sql.toLowerCase()).join("\n");
		expect(packedSql).toContain("stats_visitor_day");
		expect(packedSql).toContain("stats_article_hour");
		expect(packedSql).not.toContain("insert into page_views");
		expect(packedSql).not.toContain("stats_daily");
		expect(packedSql).not.toMatch(/user_agent|cf_connecting_ip|\bip\b|cookie/);
		const packed = JSON.stringify(calls.flatMap((call) => call.binds));
		expect(packed).not.toContain(IP);
		expect(packed).not.toContain("UniqueAgentTokenXYZ");
		expect(packedSql).not.toContain("delete from stats_visitor_day");
		expect(packedSql).not.toContain("delete from stats_day_salt");
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
		const repo = new D1NewsRepository(db as unknown as D1Database, { budget: { async open() { return true; }, async charge() {} } });
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
		expect(botSql).not.toContain("stats_daily");
		calls.length = 0;
		resetAggregates();
		const ignored = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/nope", { headers: { "user-agent": "Mozilla/5.0" } }),
			{ slug: "", page: "/ai-news/nope" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		ignored.eventKind = "404";
		await repo.recordPageView(ignored);
		expect(calls).toHaveLength(0);
		const miss = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/missing-note", { headers: { "user-agent": "Mozilla/5.0" } }),
			{ slug: "", page: "/ai-news/article/missing-note" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		miss.eventKind = "404";
		await repo.recordPageView(miss);
		const missSql = calls.map((call) => call.sql.toLowerCase()).join("\n");
		expect(missSql).toContain("stats_miss_daily");
		expect(missSql).not.toContain("insert into page_views");
	});

	it("strips email, phone, and long digit runs, and keeps one referrer segment", () => {
		const event = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin?utm_term=reach+ada%40example.com+or+%2B1+202+555+0143+id+123456789012", {
				headers: { referer: "https://news.example.com/section/very/long/path?q=ada@example.com" },
			}),
			{ slug: "short-bulletin", page: "article" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		expect(event.utmTerm).not.toContain("ada@example.com");
		expect(event.utmTerm).not.toContain("202");
		expect(event.utmTerm).not.toContain("123456789012");
		expect(event.utmTerm.toLowerCase()).toContain("redacted");
		expect(event.utmTerm.length).toBeLessThanOrEqual(80);
		expect(event.referrerHost).toBe("news.example.com");
		expect(event.referrerPath).toBe("/section");
		const long = pageViewFromRequest(
			new Request(`https://3aik.test/ai-news/article/short-bulletin?utm_source=${"a".repeat(200)}`),
			{ slug: "short-bulletin", page: "article" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		expect(long.utmSource).toHaveLength(80);
	});

	it("prunes salts and daily rollups from the cron path", async () => {
		const calls: string[] = [];
		const db = {
			prepare(sql: string) {
				return {
					bind() {
						return {
							async run() {
								calls.push(sql.toLowerCase());
								return { meta: { changes: 1, rows_written: 3 } };
							},
						};
					},
				};
			},
		};
		const charged: number[] = [];
		const repo = new D1NewsRepository(db as unknown as D1Database, {
			budget: {
				async open() { return true; },
				async charge(rows: number) { charged.push(rows); },
			},
		});
		await repo.pruneStatsRetention(new Date("2026-10-26T13:00:00.000Z"));
		const packed = calls.join("\n");
		expect(charged).toEqual(Array(10).fill(3));
		expect(packed).toContain("delete from stats_visitor_day");
		expect(packed).toContain("delete from stats_day_salt");
		expect(packed).toContain("delete from stats_article_hour");
		expect(packed).toContain("delete from stats_bot_daily");
		expect(packed).toContain("delete from stats_miss_daily");
		expect(packed).toContain("delete from stats_feed_daily");
		expect(packed).toContain("delete from stats_click_daily");
		expect(packed).toContain("delete from stats_write_budget");
		expect(packed).toContain("stats-prune");
	});

	it("drops rollups when the daily budget is exhausted and still accepts a point sample", async () => {
		const calls: string[] = [];
		let points = 0;
		const db = {
			prepare(sql: string) {
				return {
					bind() {
						return {
							async run() {
								calls.push(sql.toLowerCase());
								return { meta: { changes: 1 } };
							},
						};
					},
				};
			},
		};
		const repo = new D1NewsRepository(db as unknown as D1Database, {
			budget: { async open() { return false; }, async charge() {} },
			analytics: { writeDataPoint() { points += 1; } },
		});
		const event = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ slug: "short-bulletin", page: "article" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		event.visitorHash = "ab".repeat(32);
		for (let index = 0; index < 19; index += 1) await repo.recordPageView(event);
		expect(points).toBe(0);
		await repo.recordPageView(event);
		expect(points).toBe(1);
		expect(calls.join("\n")).not.toContain("stats_article_hour");
		expect(calls.join("\n")).not.toContain("page_views");
	});

	it("rejects a malformed stats digest override and keeps the committed digest", () => {
		resetStatsDigestWarning();
		const errors: string[] = [];
		const spy = vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
			errors.push(String(message));
		});
		expect(expectedStatsDigest("not-a-digest")).toBe(NEWS_STATS_DIGEST);
		expect(errors.join("\n")).toContain("ai-news stats digest override rejected");
		expect(expectedStatsDigest("ab".repeat(32))).toBe("ab".repeat(32));
		spy.mockRestore();
	});

	it("stops the durable object counter at the daily cap", async () => {
		const rows = new Map<string, number>();
		const sql = {
			exec(query: string, ...bindings: unknown[]) {
				if (query.startsWith("CREATE")) return { next: () => ({ done: true }) };
				if (query.startsWith("SELECT")) {
					const writes = rows.get(String(bindings[0]));
					return { next: () => (writes == null ? { done: true } : { done: false, value: { writes } }) };
				}
				const day = String(bindings[0]);
				const amount = Number(bindings[1]);
				rows.set(day, (rows.get(day) ?? 0) + amount);
				return { next: () => ({ done: true }) };
			},
		};
		const state = {
			blockConcurrencyWhile: async (fn: () => Promise<void>) => fn(),
			storage: { sql },
		};
		const budget = new NewsStatsBudget(state as never, {} as never);
		const day = "2026-10-26";
		const charged = await budget.fetch(new Request("https://stats-budget.internal/", {
			method: "POST",
			body: JSON.stringify({ op: "charge", rows: 7, day }),
		}));
		expect(await charged.json()).toEqual({ ok: true });
		expect(rows.get(day)).toBe(7);
		rows.set(day, STATS_DAILY_WRITE_CAP - 1);
		const crossing = await budget.fetch(new Request("https://stats-budget.internal/", {
			method: "POST",
			body: JSON.stringify({ op: "charge", rows: 4, day }),
		}));
		expect(await crossing.json()).toEqual({ ok: false });
		expect(rows.get(day)).toBe(STATS_DAILY_WRITE_CAP + 3);
		const blocked = await budget.fetch(new Request("https://stats-budget.internal/", {
			method: "POST",
			body: JSON.stringify({ op: "open", day }),
		}));
		expect(await blocked.json()).toEqual({ ok: false });
	});

	it("charges D1 rows_written for a view and for prune deletes", async () => {
		const calls: string[] = [];
		const charged: number[] = [];
		let open = true;
		const db = {
			prepare(sql: string) {
				return {
					bind() {
						return {
							async run() {
								calls.push(sql.toLowerCase());
								return { meta: { changes: 1, rows_written: 5 } };
							},
						};
					},
				};
			},
		};
		const repo = new D1NewsRepository(db as unknown as D1Database, {
			budget: {
				async open() { return open; },
				async charge(rows: number) { charged.push(rows); },
			},
		});
		const event = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ slug: "short-bulletin", page: "article" },
			new Date("2026-10-26T13:00:00.000Z"),
			"3aik.com",
		);
		event.visitorHash = "ab".repeat(32);
		await repo.recordPageView(event);
		expect(charged).toEqual([5, 5]);
		expect(calls.join("\n")).toContain("stats_visitor_day");
		expect(calls.join("\n")).toContain("stats_article_hour");
		calls.length = 0;
		open = false;
		await repo.recordPageView(event);
		expect(calls).toHaveLength(0);
		expect(charged).toEqual([5, 5]);
		open = true;
		await repo.pruneStatsRetention(new Date("2026-10-26T13:00:00.000Z"));
		const deletes = calls.filter((sql) => sql.startsWith("delete from"));
		expect(deletes.length).toBeGreaterThan(0);
		expect(charged.slice(2)).toEqual(deletes.map(() => 5));
		expect(calls.some((sql) => sql.includes("stats-prune"))).toBe(true);
		expect(charged.length).toBe(2 + deletes.length);
	});

	it("clamps a stats range to 400 days and does not present a fake bounce rate", () => {
		const now = new Date("2026-10-26T13:00:00.000Z");
		const query = statsQueryFromUrl(new URL("https://3aik.test/ai-news/api/stats?from=2020-01-01&to=2026-10-26"), null, now);
		expect(query.to).toBe("2026-10-26");
		expect(query.from).toBe("2025-09-22");
		const report = emptyStatsReport(now);
		report.ready = true;
		report.truncated = true;
		report.comparison.current.bounceRate = null;
		report.comparison.previous.bounceRate = null;
		const html = renderStatsDashboard(report);
		expect(html).toContain(">n/a<");
		expect(html).toContain("Not computed from rollups");
		expect(html).not.toContain("newest 400");
	});

	it("shares one rate-limit key across lanes and fails closed when the binding throws", async () => {
		const keys: string[] = [];
		const limiter = {
			async limit(options: { key: string }) {
				keys.push(options.key);
				return { success: true };
			},
		};
		expect(await allowStatsLane(limiter, "203.0.113.9", "collect")).toBe(true);
		expect(await allowStatsLane(limiter, "203.0.113.9", "counter")).toBe(true);
		expect(keys[0]).toBe(keys[1]);
		expect(keys[0]).not.toContain("collect");
		const broken = { async limit() { throw new Error("binding down"); } };
		expect(await allowStatsLane(broken, "203.0.113.9", "collect")).toBe(false);
	});

	it("still deletes visitor hashes and salts after the write budget is closed", async () => {
		const calls: string[] = [];
		const charged: number[] = [];
		const db = {
			prepare(sql: string) {
				return {
					bind() {
						return {
							async run() {
								calls.push(sql.toLowerCase());
								return { meta: { changes: 1, rows_written: 2 } };
							},
						};
					},
				};
			},
		};
		const repo = new D1NewsRepository(db as unknown as D1Database, {
			budget: {
				async open() { return false; },
				async charge(rows: number) { charged.push(rows); },
			},
		});
		await repo.pruneStatsRetention(new Date("2026-10-26T13:00:00.000Z"));
		const deletes = calls.filter((sql) => sql.startsWith("delete from"));
		expect(deletes.some((sql) => sql.includes("stats_visitor_day"))).toBe(true);
		expect(deletes.some((sql) => sql.includes("stats_day_salt"))).toBe(true);
		expect(deletes.some((sql) => sql.includes("stats_article_hour"))).toBe(false);
		expect(charged).toEqual([2, 2]);
	});

	it("bounds all-time view totals to the retained rollup window", async () => {
		const sqls: string[] = [];
		const binds: unknown[][] = [];
		const db = {
			prepare(sql: string) {
				return {
					bind(...values: unknown[]) {
						return {
							async all() {
								sqls.push(sql);
								binds.push(values);
								return { results: [] };
							},
						};
					},
				};
			},
		};
		const now = new Date("2026-10-26T13:00:00.000Z");
		const retainedFrom = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		await loadD1StatsReport(db, now, { from: null, to: null, slug: null });
		expect(sqls.join("\n")).not.toContain("1970-01-01");
		expect(sqls.join("\n")).not.toContain("9999-12-31");
		const totals = sqls.findIndex((sql) => sql.includes("SUM(views)") && sql.includes("day >= ?") && !sql.includes("OR"));
		expect(totals).toBeGreaterThanOrEqual(0);
		expect(binds[totals]).toEqual([retainedFrom, "2026-10-26"]);
	});
});
