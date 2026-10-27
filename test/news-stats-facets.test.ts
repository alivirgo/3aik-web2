import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { beaconSource, beaconToEvent, handleCollectRequest } from "../src/news/collect";
import type { NewsEnv } from "../src/news/config";
import { D1NewsRepository } from "../src/news/repository";
import { renderStatsDashboard } from "../src/news/stats";

const IP = "203.0.113.44";
const NOW = new Date("2026-10-26T13:00:00.000Z");
const SLUG = "short-bulletin";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FACET_SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../migrations/0008_ai_news_stats_facets.sql"), "utf8");

const BASE_SQL = `
CREATE TABLE articles (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'ai',
  tags_json TEXT NOT NULL DEFAULT '[]',
  author_id TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE stats_day_salt (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
CREATE TABLE stats_visitor_day (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
CREATE TABLE stats_article_hour (
  day TEXT NOT NULL,
  hour_utc INTEGER NOT NULL,
  slug TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  uniques INTEGER NOT NULL DEFAULT 0,
  engaged_ms INTEGER NOT NULL DEFAULT 0,
  engage_n INTEGER NOT NULL DEFAULT 0,
  scroll_sum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour_utc, slug)
);
CREATE TABLE stats_click_daily (
  day TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, slug, kind, host, path)
);
CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  viewed_at TEXT NOT NULL,
  visitor_hash TEXT NOT NULL DEFAULT ''
);
INSERT INTO articles (slug, title, category, tags_json, author_id, body_text, published_at)
VALUES ('${SLUG}', 'A short bulletin', 'ai', '[]', 'mira-ellison', 'A short bulletin.', '2026-10-26T08:00:00.000Z');
`;

function sqliteRepo(sql: string) {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(sql);
	const db = {
		prepare(statement: string) {
			return {
				bind(...values: unknown[]) {
					const prepared = sqlite.prepare(statement);
					const args = values as never[];
					return {
						async run() {
							const info = prepared.run(...args);
							const changes = Number(info.changes ?? 0);
							return { meta: { changes, rows_written: changes } };
						},
						async all() {
							return { results: prepared.all(...args) as Record<string, unknown>[] };
						},
						async first() {
							return (prepared.get(...args) as Record<string, unknown> | undefined) ?? null;
						},
					};
				},
			};
		},
	};
	return {
		sqlite,
		repo: new D1NewsRepository(db as unknown as D1Database, {
			budget: { async open() { return true; }, async charge() {} },
		}),
	};
}

function env(): NewsEnv & { NEWS_STATS_RATE_LIMITER: { limit: () => Promise<{ success: boolean }> } } {
	return {
		AI_NEWS_STATS_ENABLED: "true",
		NEWS_STATS_RATE_LIMITER: { async limit() { return { success: true }; } },
	} as NewsEnv & { NEWS_STATS_RATE_LIMITER: { limit: () => Promise<{ success: boolean }> } };
}

function beacon(body: Record<string, unknown>, address = IP): Request {
	const request = new Request("https://3aik.test/ai-news/api/collect", {
		method: "POST",
		headers: {
			origin: "https://3aik.test",
			"content-type": "application/json",
			"cf-connecting-ip": address,
			"user-agent": UA,
			"accept-language": "ur-PK,ur;q=0.9,en;q=0.8",
			referer: "https://3aik.test/ai-news/article/short-bulletin",
		},
		body: JSON.stringify(body),
	});
	Object.defineProperty(request, "cf", {
		value: { country: "PK", city: "Karachi", region: "Sindh", continent: "AS" },
	});
	return request;
}

describe("D1 dimension rollups", () => {
	it("sends the article referrer, query string, and screen on the view beacon", () => {
		const source = beaconSource("article", SLUG);
		expect(source).toContain("ref:clip(document.referrer)");
		expect(source).toContain("search:clip(location.search)");
		expect(source).toContain('kind:"view"');
		expect(source).toContain("screen:bucket()");
		const request = beacon({ kind: "view", page: "article", slug: SLUG, returning: 0 });
		const dropped = beaconToEvent({
			kind: "view",
			page: "article",
			slug: SLUG,
			returning: 0,
			ref: "javascript:alert(1)",
		}, request, NOW, "3aik.test");
		expect(dropped?.referrerHost).toBe("");
		expect(JSON.stringify(dropped)).not.toContain("javascript");
		const credential = beaconToEvent({
			kind: "view",
			page: "article",
			slug: SLUG,
			returning: 0,
			ref: "https://user:secret@www.google.com/search?q=hidden-query",
		}, request, NOW, "3aik.test");
		expect(credential?.referrerHost).toBe("");
		expect(JSON.stringify(credential)).not.toContain("secret");
		expect(JSON.stringify(credential)).not.toContain("hidden-query");
		const fromUtm = beaconToEvent({
			kind: "view",
			page: "article",
			slug: SLUG,
			returning: 0,
			ref: "",
			search: "?utm_source=google&utm_medium=organic&utm_term=from-utm",
		}, request, NOW, "3aik.test");
		expect(fromUtm?.referrerHost).toBe("");
		expect(fromUtm?.sourceClass).toBe("search");
		expect(fromUtm?.searchQuery).toBe("from-utm");
		expect(fromUtm?.utmTerm).toBe("from-utm");
	});

	it("writes a beacon and reads country, referrer, query, device, session, and heatmap", async () => {
		const { sqlite, repo } = sqliteRepo(`${BASE_SQL}\n${FACET_SQL}`);
		sqlite.prepare(
			`INSERT INTO stats_article_hour (day, hour_utc, slug, views, uniques) VALUES ('2026-10-26', 3, ?, 4, 1)`,
		).run(SLUG);
		const view = {
			kind: "view",
			page: "article",
			slug: SLUG,
			returning: 0,
			ref: "https://www.google.com/search?q=quiet+desk",
			search: "?utm_source=google&utm_medium=organic&utm_campaign=desk&utm_term=karachi+brief",
			screen: "md",
		};
		const first = await handleCollectRequest(beacon(view), env(), repo, "https://3aik.test", undefined, NOW);
		expect(first.status).toBe(204);
		expect(first.headers.get("cache-control")).toContain("no-store");
		expect(first.headers.get("access-control-allow-origin")).toBeNull();
		const second = await handleCollectRequest(
			beacon({ ...view, returning: 1 }, "203.0.113.45"),
			env(),
			repo,
			"https://3aik.test",
			undefined,
			NOW,
		);
		expect(second.status).toBe(204);
		const click = await handleCollectRequest(beacon({
			kind: "click",
			page: "article",
			slug: SLUG,
			href: "https://example.com/away",
			clickKind: "outbound",
			returning: 1,
		}), env(), repo, "https://3aik.test", undefined, NOW);
		expect(click.status).toBe(204);

		const report = await repo.pageViewReport(NOW);
		expect(report.countries).toContainEqual({ country: "PK", views: 2 });
		expect(report.cities).toContainEqual({ name: "Karachi", views: 2 });
		expect(report.regions).toContainEqual({ name: "Sindh", views: 2 });
		expect(report.continents).toContainEqual({ name: "Asia (AS)", views: 2 });
		expect(report.referrers).toContainEqual({ host: "www.google.com", path: "/search", views: 2 });
		expect(report.referrerGroups).toContainEqual({ name: "search", views: 2 });
		expect(report.sources).toContainEqual({ source: "search", views: 2 });
		expect(report.queries).toContainEqual({ engine: "Google", query: "quiet desk", views: 2 });
		expect(report.queries).toContainEqual({ engine: "utm", query: "karachi brief", views: 2 });
		expect(report.devices).toContainEqual({ device: "desktop", views: 2 });
		expect(report.browsers).toContainEqual({ name: "Chrome", views: 2 });
		expect(report.operatingSystems).toContainEqual({ name: "Windows", views: 2 });
		expect(report.screens).toContainEqual({ name: "md", views: 2 });
		expect(report.languages).toContainEqual({ name: "ur-PK", views: 2 });
		expect(report.campaigns).toContainEqual({
			source: "google",
			medium: "organic",
			campaign: "desk",
			term: "karachi brief",
			views: 2,
		});
		expect(report.landing).toContainEqual({ name: `/ai-news/article/${SLUG}`, views: 2 });
		expect(report.exit).toContainEqual({ name: `/ai-news/article/${SLUG}`, views: 2 });
		expect(report.outbound).toContainEqual({ host: "example.com", path: "/away", views: 1 });
		expect(report.audience.sessions).toBe(2);
		expect(report.audience.newVisitors).toBe(1);
		expect(report.audience.returningVisitors).toBe(1);
		expect(report.audience.bounces).toBe(2);
		expect(report.audience.bounceRate).toBe(1);
		expect(report.comparison.current.bounceRate).toBe(1);
		expect(report.heatmap.utc[3]).toBe(4);
		expect(report.heatmap.karachi[8]).toBe(4);
		expect(report.heatmap.utc[13]).toBe(2);
		expect(report.heatmap.karachi[18]).toBe(2);
		expect(report.heatmap.utc.some((count) => count > 0)).toBe(true);
		expect(report.heatmap.karachi.some((count) => count > 0)).toBe(true);

		const stored = JSON.stringify(sqlite.prepare("SELECT facet, value FROM stats_facet_daily").all());
		expect(stored).not.toContain(IP);
		expect(stored).not.toContain("203.0.113.45");
		expect(stored).not.toContain("Mozilla");
		expect(stored).not.toContain(UA);
		const hashes = sqlite.prepare("SELECT visitor_hash FROM stats_visitor_day").all() as Array<{ visitor_hash: string }>;
		expect(hashes).toHaveLength(2);
		for (const row of hashes) {
			expect(row.visitor_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(stored).not.toContain(row.visitor_hash);
		}
		expect(sqlite.prepare("SELECT COUNT(*) AS n FROM page_views").get()).toEqual({ n: 0 });
		const html = renderStatsDashboard(report);
		expect(html).toContain("PK");
		expect(html).toContain("www.google.com");
		expect(html).toContain("quiet desk");
		expect(html).toContain("karachi brief");
		expect(html).toContain(">100%<");
		expect(html).not.toContain(IP);
	});

	it("keeps the hourly row when the facet table is not migrated yet", async () => {
		const { repo } = sqliteRepo(BASE_SQL);
		const response = await handleCollectRequest(beacon({
			kind: "view",
			page: "article",
			slug: SLUG,
			returning: 0,
			ref: "https://www.google.com/search?q=quiet+desk",
			screen: "md",
		}), env(), repo, "https://3aik.test", undefined, NOW);
		expect(response.status).toBe(204);
		const report = await repo.pageViewReport(NOW);
		expect(report.totals.views).toBe(1);
		expect(report.countries).toEqual([]);
		expect(report.referrers).toEqual([]);
		expect(report.audience.sessions).toBe(0);
		expect(report.audience.bounceRate).toBeNull();
		expect(report.heatmap.utc[13]).toBe(1);
		expect(report.heatmap.karachi[18]).toBe(1);
		expect(report.note).toContain("0008_ai_news_stats_facets.sql");
	});
});
