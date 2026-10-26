import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleNewsRequest } from "../src/news/routes";
import { MemoryNewsRepository } from "../src/news/repository";
import { rawRetentionCutoff, randomDaySalt, summarizePageViews, visitorHmac, type PageViewEvent } from "../src/news/pageviews";
import type { StoredArticle } from "../src/news/types";

const STATS_BEARER = ["stats", "desk", "bearer", "0123456789abcdef", "0123456789abcd"].join("-");
const STATS_SHA = createHash("sha256").update(STATS_BEARER).digest("hex");

const TOKEN = "cd".repeat(32);
const IP = "203.0.113.50";
const NOW = new Date("2026-10-26T13:00:00.000Z");

function article(): StoredArticle {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug: "short-bulletin",
		title: "SECRET_STORY_TITLE_ZZZ",
		description: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		category: "ai",
		tags: ["desk", "brief"],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The Verge reported a narrow product note about the desk.",
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
		publishedAt: "2026-10-26T08:00:00.000Z",
		updatedAt: "2026-10-26T08:00:00.000Z",
	};
}

function openLimiter() {
	return { async limit() { return { success: true }; } };
}

function env(limiter: { limit: () => Promise<{ success: boolean }> } = openLimiter()) {
	return {
		AI_NEWS_INGEST_TOKEN: TOKEN,
		AI_NEWS_STATS_TOKEN_SHA256: STATS_SHA,
		AI_NEWS_SITE_ORIGIN: "https://3aik.com",
		NEWS_STATS_RATE_LIMITER: limiter,
	};
}

function desk() {
	const repo = new MemoryNewsRepository();
	repo.articles.push(article());
	return repo;
}

function view(overrides: Partial<PageViewEvent> = {}): PageViewEvent {
	return {
		viewedAt: "2026-10-26T12:30:00.000Z",
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
		country: "PK",
		deviceClass: "desktop",
		bot: 0,
		visitorHash: "a".repeat(64),
		hourUtc: 12,
		hourKarachi: 17,
		eventKind: "view",
		...overrides,
	};
}

describe("salted daily visitor hmac", () => {
	it("uses a random HMAC salt and never embeds the address, user agent, or token", () => {
		const salt = randomDaySalt();
		const nextSalt = randomDaySalt();
		const first = visitorHmac(salt, IP, "Mozilla/5.0 UniqueAgentTokenXYZ");
		const same = visitorHmac(salt, IP, "Mozilla/5.0 UniqueAgentTokenXYZ");
		const next = visitorHmac(nextSalt, IP, "Mozilla/5.0 UniqueAgentTokenXYZ");
		expect(salt).toHaveLength(32);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(first).toBe(same);
		expect(first).not.toBe(next);
		expect(Buffer.from(salt).equals(Buffer.from(nextSalt))).toBe(false);
		expect(first).not.toContain(IP);
		expect(first).not.toContain("UniqueAgentTokenXYZ");
		expect(first).not.toContain(TOKEN);
		expect(first).not.toBe(createHash("sha256").update(`${TOKEN}|2026-10-26`).digest("hex"));
		expect(visitorHmac(salt, "", "ua")).toBe("");
		const cutoff = Date.parse(rawRetentionCutoff(NOW));
		expect(NOW.getTime() - cutoff).toBe(90 * 24 * 60 * 60 * 1000);
	});
});

describe("detailed stats", () => {
	it("counts uniques, sessions, geo, devices, and period comparison without storing an address", () => {
		const events = [
			view(),
			view({
				viewedAt: "2026-10-26T12:40:00.000Z",
				page: "index",
				slug: "",
				visitorHash: "a".repeat(64),
				sourceClass: "search",
				referrerHost: "www.google.com",
				referrerPath: "/search",
				searchEngine: "Google",
				searchQuery: "robot hands",
				city: "Karachi",
				region: "Sindh",
				continent: "AS",
				browser: "Chrome",
				os: "Windows",
				lang: "en-PK",
				utmTerm: "robot hands",
			}),
			view({
				viewedAt: "2026-10-26T14:00:00.000Z",
				visitorHash: "b".repeat(64),
				hourUtc: 14,
				hourKarachi: 19,
			}),
			view({ viewedAt: "2026-10-19T12:00:00.000Z", visitorHash: "c".repeat(64), slug: "short-bulletin" }),
			view({ bot: 1, botName: "Googlebot", visitorHash: "" }),
		];
		const report = summarizePageViews(events, NOW, new Map([["short-bulletin", {
			slug: "short-bulletin",
			title: "SECRET_STORY_TITLE_ZZZ",
			category: "ai",
			tags: ["desk"],
			authorId: "mira-ellison",
			authorName: "Mira Ellison",
			publishedAt: "2026-10-26T08:00:00.000Z",
			words: 12,
		}]]));
		expect(report.totals.views).toBe(4);
		expect(report.totals.botHitsExcluded).toBe(1);
		expect(report.audience.uniques).toBe(3);
		expect(report.audience.sessions).toBe(3);
		expect(report.audience.bounces).toBe(2);
		expect(report.cities.map((row) => row.name)).toContain("Karachi");
		expect(report.regions.map((row) => row.name)).toContain("Sindh");
		expect(report.continents.map((row) => row.name)).toContain("Asia (AS)");
		expect(report.browsers.map((row) => row.name)).toContain("Chrome");
		expect(report.operatingSystems.map((row) => row.name)).toContain("Windows");
		expect(report.languages.map((row) => row.name)).toContain("en-PK");
		expect(report.heatmap.utc[12]).toBeGreaterThan(0);
		expect(report.heatmap.karachi[17]).toBeGreaterThan(0);
		expect(report.bots).toEqual([{ name: "Googlebot", views: 1 }]);
		expect(report.authors[0]?.name).toBe("Mira Ellison");
		expect(report.categories[0]?.name).toBe("ai");
		expect(report.tags[0]?.name).toBe("desk");
		expect(report.comparison.current.views).toBeGreaterThan(0);
		expect(report.comparison.previous.views).toBe(1);
		expect(report.series.day.length).toBeGreaterThan(0);
		expect(report.series.week.length).toBeGreaterThan(0);
		expect(report.series.month.length).toBeGreaterThan(0);
		expect(JSON.stringify(report)).not.toContain(IP);
	});

	it("serves filters, drilldown, and CSV only to the bearer header", async () => {
		const repo = desk();
		await repo.recordPageView(view({ city: "Karachi", region: "Sindh", continent: "AS", browser: "Chrome", os: "Windows", lang: "en-PK" }));
		await repo.recordPageView(view({ viewedAt: "2026-10-20T12:00:00.000Z", visitorHash: "b".repeat(64) }));
		const headers = { authorization: `Bearer ${STATS_BEARER}` };
		const filtered = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats?from=2026-10-26&to=2026-10-26", { headers }),
			env(),
			{ repo, now: NOW },
		);
		expect(filtered.status).toBe(200);
		const body = await filtered.json() as { totals: { views: number }; cities: Array<{ name: string }>; heatmap: { karachi: number[] } };
		expect(body.totals.views).toBe(1);
		expect(body.cities[0]?.name).toBe("Karachi");
		expect(body.heatmap.karachi[17]).toBe(1);

		const leaked = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/api/stats?from=2026-10-01&token=${TOKEN}`, { headers }),
			env(),
			{ repo, now: NOW },
		);
		expect(leaked.status).toBe(404);
		expect(await leaked.text()).not.toContain("Karachi");

		const drill = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats/article/short-bulletin", { headers }),
			env(),
			{ repo, now: NOW },
		);
		expect(drill.status).toBe(200);
		const drillHtml = await drill.text();
		expect(drillHtml).toContain("Article stats: short-bulletin");
		expect(drillHtml).toContain("SECRET_STORY_TITLE_ZZZ");
		expect(drillHtml).toContain("Asia/Karachi");
		expect(drillHtml).toContain("<svg");
		expect(drillHtml).not.toContain(IP);

		const csv = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/stats.csv", { headers }),
			env(),
			{ repo, now: NOW },
		);
		expect(csv.status).toBe(200);
		expect(csv.headers.get("content-type")).toContain("text/csv");
		expect(csv.headers.get("cache-control")).toContain("no-store");
		expect(csv.headers.get("x-robots-tag")).toBe("noindex, nofollow");
		expect(csv.headers.get("access-control-allow-origin")).toBeNull();
		const sheet = await csv.text();
		expect(sheet).toContain("short-bulletin");
		expect(sheet).toContain("Karachi");
		expect(sheet).not.toContain(IP);

		const hiddenCsv = await handleNewsRequest(new Request("https://3aik.test/ai-news/api/stats.csv"), env(), { repo, now: NOW });
		expect(hiddenCsv.status).toBe(404);
		expect(await hiddenCsv.text()).not.toContain("Karachi");
	});

	it("records engagement, clicks, 404s, and feed fetches without a second view", async () => {
		const repo = desk();
		const jobs: Array<Promise<unknown>> = [];
		const ctx = { waitUntil(job: Promise<unknown>) { jobs.push(job); } } as ExecutionContext;
		const page = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin", {
				headers: { "cf-connecting-ip": IP, "user-agent": "Mozilla/5.0 UniqueAgentTokenXYZ", "accept-language": "en-PK,en;q=0.8" },
			}),
			env(),
			{ repo, now: NOW },
			ctx,
		);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain("/ai-news/api/collect");
		expect(html).not.toContain('nonce="');
		expect(html).not.toContain("/ai-news/api/stats");
		expect(page.headers.get("cache-control")).toContain("public");
		expect(page.headers.get("content-security-policy")).toContain("'sha256-");
		expect(page.headers.get("content-security-policy")).not.toContain("'nonce-");
		expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'");
		expect(page.headers.get("content-security-policy")).toContain("script-src https://pagead2.googlesyndication.com");
		await Promise.all(jobs);
		expect(repo.pageViews).toHaveLength(0);

		const beaconHeaders = {
			origin: "https://3aik.test",
			"content-type": "application/json",
			"cf-connecting-ip": IP,
			"accept-language": "en-PK,en;q=0.8",
			"user-agent": "Mozilla/5.0 UniqueAgentTokenXYZ",
			cookie: `token=${TOKEN}`,
		};
		const viewed = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: beaconHeaders,
				body: JSON.stringify({ kind: "view", page: "article", slug: "short-bulletin", returning: 0 }),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(viewed.status).toBe(204);
		expect(repo.pageViews).toHaveLength(1);
		expect(JSON.stringify(repo.pageViews[0])).not.toContain(IP);
		expect(repo.pageViews[0]?.lang).toBe("en-PK");
		expect(repo.pageViews[0]?.visitorHash).toMatch(/^[0-9a-f]{64}$/);
		const unknown = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: beaconHeaders,
				body: JSON.stringify({ kind: "view", page: "article", slug: "not-a-real-slug", returning: 0 }),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(unknown.status).toBe(204);
		expect(repo.pageViews).toHaveLength(1);
		const engage = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: beaconHeaders,
				body: JSON.stringify({
					kind: "engage",
					page: "article",
					slug: "short-bulletin",
					engagedMs: 4200,
					scroll: 80,
					screen: "md",
					returning: 0,
					id: "SESSIONSECRET",
					cookie: TOKEN,
				}),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(engage.status).toBe(204);
		expect(engage.headers.get("access-control-allow-origin")).toBeNull();
		expect(engage.headers.get("cache-control")).toContain("no-store");
		const click = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: beaconHeaders,
				body: JSON.stringify({
					kind: "click",
					page: "article",
					slug: "short-bulletin",
					href: "https://www.theverge.com/story?secret=DROP",
					clickKind: "source",
					returning: 1,
				}),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(click.status).toBe(204);
		const outbound = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: beaconHeaders,
				body: JSON.stringify({
					kind: "click",
					page: "article",
					slug: "short-bulletin",
					href: "https://example.com/away",
					clickKind: "outbound",
				}),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(outbound.status).toBe(204);
		const cross = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: { origin: "https://evil.test", "content-type": "application/json" },
				body: JSON.stringify({ kind: "engage", page: "index", slug: "", engagedMs: 10, scroll: 1, screen: "lg", returning: 1 }),
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(cross.status).toBe(404);
		expect(cross.headers.get("access-control-allow-origin")).toBeNull();

		const missingJobs: Array<Promise<unknown>> = [];
		const missingCtx = { waitUntil(job: Promise<unknown>) { missingJobs.push(job); } } as ExecutionContext;
		const missing = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/article/missing-story?token=SECRETCLICK", { headers: { "user-agent": "Mozilla/5.0" } }),
			env(),
			{ repo, now: NOW },
			missingCtx,
		);
		expect(missing.status).toBe(404);
		await Promise.all(missingJobs);
		const feedJobs: Array<Promise<unknown>> = [];
		const feedCtx = { waitUntil(job: Promise<unknown>) { feedJobs.push(job); } } as ExecutionContext;
		const feed = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/feed.xml", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" } }),
			env(),
			{ repo, now: NOW },
			feedCtx,
		);
		expect(feed.status).toBe(200);
		await Promise.all(feedJobs);

		const packed = JSON.stringify(repo.pageViews);
		expect(packed).not.toContain(IP);
		expect(packed).not.toContain("SESSIONSECRET");
		expect(packed).not.toContain("SECRETCLICK");
		expect(packed).not.toContain("DROP");
		expect(packed).not.toContain(TOKEN);
		const report = await repo.pageViewReport(NOW);
		expect(report.totals.views).toBe(1);
		expect(report.audience.avgEngagedMs).toBe(4200);
		expect(report.audience.avgScrollPct).toBe(80);
		expect(report.audience.newVisitors).toBe(1);
		expect(report.screens).toEqual([{ name: "md", views: 1 }]);
		expect(report.sourceClicks[0]).toMatchObject({ host: "www.theverge.com", path: "/story" });
		expect(report.outbound[0]).toMatchObject({ host: "example.com", path: "/away" });
		expect(report.notFound.map((row) => row.name)).toContain("/ai-news/article/missing-story");
		expect(report.feeds.map((row) => row.name)).toContain("/ai-news/feed.xml");
		expect(report.bots.map((row) => row.name)).toContain("Googlebot");
		expect(report.publishLog[0]).toMatchObject({ slug: "short-bulletin", author: "Mira Ellison", category: "ai" });
		expect(report.publishLog[0]?.words).toBeGreaterThan(0);
	});

	it("drops an oversized or flooded collect body before writing", async () => {
		const repo = desk();
		const headers = { origin: "https://3aik.test", "content-type": "application/json", "content-length": "9000", "cf-connecting-ip": "203.0.113.77" };
		const oversized = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers,
				body: "{}",
			}),
			env(),
			{ repo, now: NOW },
		);
		expect(oversized.status).toBe(204);
		expect(repo.pageViews).toHaveLength(0);
		const beacon = {
			kind: "engage",
			page: "article",
			slug: "short-bulletin",
			engagedMs: 1000,
			scroll: 10,
			screen: "sm",
			returning: 0,
		};
		let remaining = 3;
		const limiter = {
			async limit() {
				if (remaining <= 0) return { success: false };
				remaining -= 1;
				return { success: true };
			},
		};
		let limited = 0;
		for (let index = 0; index < 8; index += 1) {
			const response = await handleNewsRequest(
				new Request("https://3aik.test/ai-news/api/collect", {
					method: "POST",
					headers: { origin: "https://3aik.test", "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" },
					body: JSON.stringify(beacon),
				}),
				env(limiter),
				{ repo, now: NOW },
			);
			expect(response.status).toBe(204);
			if (repo.pageViews.length === index) limited += 1;
		}
		expect(repo.pageViews).toHaveLength(3);
		expect(limited).toBeGreaterThan(0);
		const throwing = {
			async limit() {
				throw new Error("binding down");
			},
		};
		const failed = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: { origin: "https://3aik.test", "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" },
				body: JSON.stringify(beacon),
			}),
			env(throwing),
			{ repo, now: NOW },
		);
		expect(failed.status).toBe(204);
		expect(repo.pageViews).toHaveLength(3);
	});

	it("returns 204 and hides the stats desk when stats are switched off", async () => {
		const repo = desk();
		const disabled = { ...env(), AI_NEWS_STATS_ENABLED: "false" };
		const collect = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/collect", {
				method: "POST",
				headers: { origin: "https://3aik.test", "content-type": "application/json", "cf-connecting-ip": IP },
				body: JSON.stringify({ kind: "view", page: "article", slug: "short-bulletin", returning: 0 }),
			}),
			disabled,
			{ repo, now: NOW },
		);
		expect(collect.status).toBe(204);
		expect(repo.pageViews).toHaveLength(0);
		const headers = { authorization: `Bearer ${STATS_BEARER}` };
		const publicMiss = await handleNewsRequest(new Request("https://3aik.test/ai-news/not-a-real-page"), disabled, { repo, now: NOW });
		for (const path of ["/ai-news/api/stats", "/ai-news/api/stats/dashboard", "/ai-news/api/stats.csv", "/ai-news/api/stats/article/short-bulletin"]) {
			const response = await handleNewsRequest(new Request(`https://3aik.test${path}`, { headers }), disabled, { repo, now: NOW });
			expect(response.status).toBe(404);
			expect(response.headers.get("cache-control")).toBe(publicMiss.headers.get("cache-control"));
			expect(response.headers.get("x-robots-tag")).toBe(publicMiss.headers.get("x-robots-tag"));
			expect(await response.text()).not.toContain("SECRET_STORY_TITLE_ZZZ");
		}
		const page = await handleNewsRequest(new Request("https://3aik.test/ai-news/article/short-bulletin"), disabled, { repo, now: NOW });
		expect(page.status).toBe(200);
		const ingest = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/ingest/meta", { headers: { authorization: `Bearer ${TOKEN}` } }),
			disabled,
			{ repo, now: NOW },
		);
		expect(ingest.status).toBe(200);
	});
});
