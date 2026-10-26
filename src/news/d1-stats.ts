import type { ArticleCatalogEntry, NamedCount, NewsStatsReport, PageCount, PageViewEvent, SeriesPoint, StatsQuery } from "./pageviews";
import { emptyStatsReport, STATS_NOTE, summarizePageViews } from "./pageviews";
import { authorById } from "./authors";
import { isCategory, wordCount } from "./text";
import type { StoredArticle } from "./types";

interface StatsDb {
	prepare(sql: string): {
		bind(...values: unknown[]): {
			all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
			first<T = Record<string, unknown>>(): Promise<T | null>;
		};
	};
}

const SAMPLE_CAP = 400;

function num(row: Record<string, unknown> | null, key: string): number {
	if (!row) return 0;
	const value = Number(row[key]);
	return Number.isFinite(value) ? value : 0;
}

function text(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	return typeof value === "string" ? value : "";
}

async function rows(db: StatsDb, sql: string, binds: unknown[]): Promise<Record<string, unknown>[]> {
	const result = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
	return result.results ?? [];
}

async function optionalRows(db: StatsDb, sql: string, binds: unknown[]): Promise<Record<string, unknown>[]> {
	try {
		return await rows(db, sql, binds);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/no such (table|column)/i.test(message)) return [];
		throw error;
	}
}

function weekLabel(day: string): string {
	const date = new Date(`${day}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return day;
	const weekday = date.getUTCDay();
	const delta = weekday === 0 ? 6 : weekday - 1;
	date.setUTCDate(date.getUTCDate() - delta);
	return date.toISOString().slice(0, 10);
}

function bucketDays(points: SeriesPoint[], month: boolean): SeriesPoint[] {
	const map = new Map<string, SeriesPoint>();
	for (const point of points) {
		const label = month ? point.label.slice(0, 7) : weekLabel(point.label);
		const row = map.get(label) ?? { label, views: 0, uniques: 0 };
		row.views += point.views;
		row.uniques += point.uniques;
		map.set(label, row);
	}
	return [...map.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function named(list: Record<string, unknown>[], nameKey: string): NamedCount[] {
	return list.map((row) => ({ name: text(row, nameKey) || "(none)", views: num(row, "views") })).filter((row) => row.name);
}

function whereSlug(column = "slug"): string {
	return `(? = '' OR ${column} = ?)`;
}

/**
 * Dashboard numbers come from indexed GROUP BY queries and daily rollups.
 * The only raw pull is a capped sample used to sessionize bounces.
 */
export async function loadD1StatsReport(db: StatsDb, now: Date, query: StatsQuery): Promise<NewsStatsReport> {
	const report = emptyStatsReport(now);
	report.ready = true;
	report.note = STATS_NOTE;
	const endDay = query.to ?? now.toISOString().slice(0, 10);
	const startDay = query.from ?? new Date(Date.parse(`${endDay}T00:00:00.000Z`) - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const endMs = Date.parse(`${endDay}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
	const startMs = Date.parse(`${startDay}T00:00:00.000Z`);
	const length = Math.max(24 * 60 * 60 * 1000, endMs - startMs);
	const startIso = new Date(startMs).toISOString();
	const endIso = new Date(endMs - 1).toISOString();
	const prevStartIso = new Date(startMs - length).toISOString();
	const prevEndIso = new Date(startMs - 1).toISOString();
	const prevStartDay = prevStartIso.slice(0, 10);
	const prevEndDay = new Date(startMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const slug = query.slug ?? "";
	const span = [prevStartIso, endIso, slug, slug];
	const current = [startIso, endIso, slug, slug];
	const human = `bot = 0 AND event_kind = 'view' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}`;

	const dayRows = await rows(
		db,
		`SELECT substr(viewed_at, 1, 10) AS label, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
		 FROM page_views WHERE ${human}
		 GROUP BY label ORDER BY label LIMIT 120`,
		span,
	);
	const days: SeriesPoint[] = dayRows.map((row) => ({
		label: text(row, "label"),
		views: num(row, "views"),
		uniques: num(row, "uniques"),
	}));
	const inCurrent = (label: string) => label >= startDay && label <= endDay;
	const inPrevious = (label: string) => label >= prevStartDay && label <= prevEndDay;
	report.series.day = days.filter((point) => inCurrent(point.label));
	report.series.week = bucketDays(report.series.day, false);
	report.series.month = bucketDays(report.series.day, true);

	const hourRows = await rows(
		db,
		`SELECT substr(viewed_at, 1, 13) AS label, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniques
		 FROM page_views WHERE bot = 0 AND event_kind = 'view' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}
		 GROUP BY label ORDER BY label DESC LIMIT 48`,
		[new Date(endMs - 48 * 60 * 60 * 1000).toISOString(), endIso, slug, slug],
	);
	report.series.hour = hourRows.map((row) => ({
		label: text(row, "label"),
		views: num(row, "views"),
		uniques: num(row, "uniques"),
	})).reverse();

	const countBetween = async (fromIso: string, toIso: string): Promise<number> => {
		const row = await db.prepare(
			`SELECT COUNT(*) AS views FROM page_views WHERE bot = 0 AND event_kind = 'view' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}`,
		).bind(fromIso, toIso, slug, slug).first<Record<string, unknown>>();
		return num(row, "views");
	};
	const rawViews = slug
		? await countBetween("1970-01-01T00:00:00.000Z", "9999-12-31T00:00:00.000Z")
		: num(await db.prepare(
			`SELECT COUNT(*) AS views FROM page_views WHERE bot = 0 AND event_kind = 'view'`,
		).bind().first<Record<string, unknown>>(), "views");
	const rolled = slug ? null : await optionalRows(db, `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(uniques), 0) AS uniques, COALESCE(SUM(bots), 0) AS bots FROM stats_daily`, []);
	const roll = rolled?.[0] ?? null;
	report.totals.views = Math.max(rawViews, num(roll, "views"));
	report.totals.last24h = await countBetween(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), now.toISOString());
	report.totals.last7d = await countBetween(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), now.toISOString());
	report.totals.botHitsExcluded = num(roll, "bots");
	const botRows = await optionalRows(
		db,
		`SELECT bot_name AS name, SUM(hits) AS views FROM stats_bot_daily WHERE day >= ? AND day <= ? GROUP BY bot_name ORDER BY views DESC LIMIT 30`,
		[startDay, endDay],
	);
	report.bots = named(botRows, "name");
	if (!report.totals.botHitsExcluded) {
		report.totals.botHitsExcluded = report.bots.reduce((sum, row) => sum + row.views, 0);
	}
	report.audience.uniques = num(roll, "uniques") || report.series.day.reduce((sum, point) => sum + point.uniques, 0);

	const currentViews = report.series.day.reduce((sum, point) => sum + point.views, 0);
	const currentUniques = report.series.day.reduce((sum, point) => sum + point.uniques, 0);
	const previousDays = days.filter((point) => inPrevious(point.label));
	const previousViews = previousDays.reduce((sum, point) => sum + point.views, 0);
	const previousUniques = previousDays.reduce((sum, point) => sum + point.uniques, 0);
	const botWindow = async (fromDay: string, toDay: string) => {
		const list = await optionalRows(db, `SELECT COALESCE(SUM(bots), 0) AS bots FROM stats_daily WHERE day >= ? AND day <= ?`, [fromDay, toDay]);
		return num(list[0] ?? null, "bots");
	};
	const engageWindow = async (fromIso: string, toIso: string) => {
		const row = await db.prepare(
			`SELECT AVG(engaged_ms) AS avg_ms, AVG(scroll_pct) AS avg_scroll, COUNT(*) AS n
			 FROM page_views WHERE bot = 0 AND event_kind = 'engage' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}`,
		).bind(fromIso, toIso, slug, slug).first<Record<string, unknown>>();
		return {
			avgEngagedMs: row && num(row, "n") ? Math.round(num(row, "avg_ms")) : 0,
			avgScrollPct: row && num(row, "n") ? Math.round(num(row, "avg_scroll")) : 0,
		};
	};
	const currentEngage = await engageWindow(startIso, endIso);
	const previousEngage = await engageWindow(prevStartIso, prevEndIso);

	const sample = await rows(
		db,
		`SELECT viewed_at, slug, page, visitor_hash, seen_before, hour_utc, hour_karachi
		 FROM page_views WHERE ${human}
		 ORDER BY viewed_at DESC LIMIT ${SAMPLE_CAP}`,
		current,
	);
	report.truncated = sample.length >= SAMPLE_CAP;
	const sampleEvents: PageViewEvent[] = sample.map((row) => ({
		viewedAt: text(row, "viewed_at"),
		slug: text(row, "slug"),
		page: text(row, "page"),
		referrerHost: "",
		referrerPath: "",
		sourceClass: "direct",
		searchEngine: "",
		searchQuery: "",
		utmSource: "",
		utmMedium: "",
		utmCampaign: "",
		utmTerm: "",
		country: "",
		deviceClass: "other",
		bot: 0,
		visitorHash: text(row, "visitor_hash"),
		hourUtc: num(row, "hour_utc"),
		hourKarachi: num(row, "hour_karachi"),
		eventKind: "view",
		returning: num(row, "seen_before") === 0 || num(row, "seen_before") === 1 ? num(row, "seen_before") as 0 | 1 : -1,
	}));
	const bounced = summarizePageViews(sampleEvents, now, new Map(), { from: startDay, to: endDay, slug: query.slug });
	report.audience.sessions = bounced.audience.sessions;
	report.audience.bounces = bounced.audience.bounces;
	report.audience.bounceRate = bounced.audience.bounceRate;
	report.audience.newVisitors = bounced.audience.newVisitors;
	report.audience.returningVisitors = bounced.audience.returningVisitors;
	report.landing = bounced.landing;
	report.exit = bounced.exit;
	report.heatmap = bounced.heatmap;

	const previousBounce = summarizePageViews(
		sampleEvents.filter((event) => event.viewedAt >= prevStartIso && event.viewedAt <= prevEndIso),
		now,
		new Map(),
		{ from: prevStartDay, to: prevEndDay, slug: query.slug },
	);
	report.comparison = {
		current: {
			from: startDay,
			to: endDay,
			views: currentViews,
			uniques: currentUniques,
			bots: await botWindow(startDay, endDay),
			avgEngagedMs: currentEngage.avgEngagedMs,
			avgScrollPct: currentEngage.avgScrollPct,
			bounceRate: bounced.audience.bounceRate,
		},
		previous: {
			from: prevStartDay,
			to: prevEndDay,
			views: previousViews,
			uniques: previousUniques,
			bots: await botWindow(prevStartDay, prevEndDay),
			avgEngagedMs: previousEngage.avgEngagedMs,
			avgScrollPct: previousEngage.avgScrollPct,
			bounceRate: previousBounce.audience.bounceRate,
		},
	};
	report.audience.avgEngagedMs = currentEngage.avgEngagedMs;
	report.audience.avgScrollPct = currentEngage.avgScrollPct;

	const articleRows = await rows(
		db,
		`SELECT slug,
			SUM(CASE WHEN event_kind = 'view' AND bot = 0 THEN 1 ELSE 0 END) AS views,
			COUNT(DISTINCT CASE WHEN event_kind = 'view' AND bot = 0 AND visitor_hash != '' THEN visitor_hash END) AS uniques,
			SUM(CASE WHEN event_kind = 'view' AND bot = 0 AND viewed_at >= ? THEN 1 ELSE 0 END) AS last24h,
			SUM(CASE WHEN event_kind = 'view' AND bot = 0 AND viewed_at >= ? THEN 1 ELSE 0 END) AS last7d,
			AVG(CASE WHEN event_kind = 'engage' AND bot = 0 THEN engaged_ms END) AS avg_ms,
			AVG(CASE WHEN event_kind = 'engage' AND bot = 0 THEN scroll_pct END) AS avg_scroll
		 FROM page_views
		 WHERE viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}
		 GROUP BY slug
		 HAVING views > 0
		 ORDER BY views DESC
		 LIMIT 40`,
		[
			new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
			new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
			startIso,
			endIso,
			slug,
			slug,
		],
	);
	const catalogRows = await optionalRows(
		db,
		`SELECT slug, title, category, tags_json, author_id, body_text, published_at FROM articles ORDER BY published_at DESC LIMIT 80`,
		[],
	);
	const catalog = new Map<string, ArticleCatalogEntry>();
	const stored: StoredArticle[] = [];
	for (const row of catalogRows) {
		const category = text(row, "category");
		if (!isCategory(category)) continue;
		let tags: string[] = [];
		try {
			const parsed = JSON.parse(text(row, "tags_json") || "[]") as unknown;
			if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
		} catch {
			tags = [];
		}
		const entry: ArticleCatalogEntry = {
			slug: text(row, "slug"),
			title: text(row, "title"),
			category,
			tags,
			authorId: text(row, "author_id"),
			authorName: authorById(text(row, "author_id"))?.name ?? text(row, "author_id"),
			publishedAt: text(row, "published_at"),
			words: wordCount(text(row, "body_text")),
		};
		catalog.set(entry.slug, entry);
		stored.push({
			id: "",
			slug: entry.slug,
			title: entry.title,
			description: "",
			category,
			tags,
			authorId: entry.authorId,
			bodyHtml: "",
			bodyText: text(row, "body_text"),
			keyPoints: [],
			faq: [],
			sources: [],
			related: [],
			imageKey: "",
			imageCommit: "",
			imageAlt: "",
			imageType: "",
			imageCredit: "",
			imageSourceUrl: "",
			publishedAt: entry.publishedAt,
			updatedAt: entry.publishedAt,
		});
	}
	report.articles = articleRows.map((row) => {
		const articleSlug = text(row, "slug");
		return {
			slug: articleSlug,
			title: catalog.get(articleSlug)?.title ?? "",
			views: num(row, "views"),
			uniques: num(row, "uniques"),
			last24h: num(row, "last24h"),
			last7d: num(row, "last7d"),
			avgEngagedMs: Math.round(num(row, "avg_ms")),
			avgScrollPct: Math.round(num(row, "avg_scroll")),
		};
	});
	const categoryCounts = new Map<string, number>();
	const tagCounts = new Map<string, number>();
	const authorCounts = new Map<string, number>();
	for (const article of report.articles) {
		const meta = catalog.get(article.slug);
		if (!meta) continue;
		categoryCounts.set(meta.category, (categoryCounts.get(meta.category) ?? 0) + article.views);
		authorCounts.set(meta.authorName, (authorCounts.get(meta.authorName) ?? 0) + article.views);
		for (const tag of meta.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + article.views);
	}
	const asNamed = (map: Map<string, number>) => [...map.entries()]
		.map(([name, views]) => ({ name, views }))
		.sort((left, right) => right.views - left.views)
		.slice(0, 30);
	report.categories = asNamed(categoryCounts);
	report.tags = asNamed(tagCounts);
	report.authors = asNamed(authorCounts);
	report.publishLog = stored.slice(0, 30).map((article) => ({
		slug: article.slug,
		title: article.title,
		publishedAt: article.publishedAt,
		words: wordCount(article.bodyText),
		category: article.category,
		author: authorById(article.authorId)?.name ?? article.authorId,
		tags: article.tags.join(", "),
	}));

	const pageRows = await rows(
		db,
		`SELECT page, slug, COUNT(*) AS views FROM page_views WHERE ${human} GROUP BY page, slug ORDER BY views DESC LIMIT 40`,
		current,
	);
	report.pages = pageRows.map((row): PageCount => ({
		page: text(row, "page"),
		slug: text(row, "slug"),
		label: text(row, "slug") || text(row, "page"),
		views: num(row, "views"),
	}));
	const liveRows = await rows(
		db,
		`SELECT page, slug, COUNT(*) AS views FROM page_views
		 WHERE bot = 0 AND event_kind = 'view' AND viewed_at >= ? AND ${whereSlug()}
		 GROUP BY page, slug ORDER BY views DESC LIMIT 20`,
		[new Date(now.getTime() - 30 * 60 * 1000).toISOString(), slug, slug],
	);
	report.realtime.pages = liveRows.map((row): PageCount => ({
		page: text(row, "page"),
		slug: text(row, "slug"),
		label: text(row, "slug") || text(row, "page"),
		views: num(row, "views"),
	}));
	report.realtime.views = report.realtime.pages.reduce((sum, row) => sum + row.views, 0);

	const topRows = await rows(
		db,
		`SELECT substr(viewed_at, 1, 10) AS day, slug, COUNT(*) AS views
		 FROM page_views WHERE ${human}
		 GROUP BY day, slug ORDER BY day DESC, views DESC LIMIT 180`,
		current,
	);
	const seenDays = new Set<string>();
	report.topByDay = [];
	for (const row of topRows) {
		const day = text(row, "day");
		if (!day || seenDays.has(day)) continue;
		seenDays.add(day);
		const articleSlug = text(row, "slug");
		report.topByDay.push({
			day,
			slug: articleSlug,
			title: catalog.get(articleSlug)?.title ?? "",
			views: num(row, "views"),
		});
		if (report.topByDay.length >= 45) break;
	}

	const grouped = async (sql: string, binds: unknown[]) => rows(db, sql, binds);
	report.referrers = (await grouped(
		`SELECT referrer_host AS host, referrer_path AS path, COUNT(*) AS views FROM page_views
		 WHERE ${human} AND referrer_host != '' GROUP BY host, path ORDER BY views DESC LIMIT 30`,
		current,
	)).map((row) => ({ host: text(row, "host"), path: text(row, "path"), views: num(row, "views") }));
	report.sources = (await grouped(
		`SELECT source_class AS source, COUNT(*) AS views FROM page_views WHERE ${human} GROUP BY source_class ORDER BY views DESC LIMIT 8`,
		current,
	)).map((row) => ({ source: text(row, "source") as NewsStatsReport["sources"][number]["source"], views: num(row, "views") }));
	report.referrerGroups = (await grouped(
		`SELECT CASE source_class WHEN 'search' THEN 'Search' WHEN 'social' THEN 'Social' WHEN 'direct' THEN 'Direct' WHEN 'internal' THEN 'Direct' ELSE 'Other sites' END AS name,
			COUNT(*) AS views FROM page_views WHERE ${human} GROUP BY name ORDER BY views DESC LIMIT 8`,
		current,
	)).map((row) => ({ name: text(row, "name"), views: num(row, "views") }));
	report.queries = (await grouped(
		`SELECT search_engine AS engine, search_query AS query, COUNT(*) AS views FROM page_views
		 WHERE bot = 0 AND event_kind = 'view' AND search_query != '' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}
		 GROUP BY engine, query ORDER BY views DESC LIMIT 30`,
		current,
	)).map((row) => ({ engine: text(row, "engine"), query: text(row, "query"), views: num(row, "views") }));
	report.countries = (await grouped(
		`SELECT country, COUNT(*) AS views FROM page_views WHERE ${human} AND country != '' GROUP BY country ORDER BY views DESC LIMIT 30`,
		current,
	)).map((row) => ({ country: text(row, "country"), views: num(row, "views") }));
	report.cities = named(await grouped(
		`SELECT city AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND city != '' GROUP BY city ORDER BY views DESC LIMIT 30`,
		current,
	), "name");
	report.regions = named(await grouped(
		`SELECT region AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND region != '' GROUP BY region ORDER BY views DESC LIMIT 30`,
		current,
	), "name");
	report.continents = named(await grouped(
		`SELECT continent AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND continent != '' GROUP BY continent ORDER BY views DESC LIMIT 12`,
		current,
	), "name");
	report.devices = (await grouped(
		`SELECT device_class AS device, COUNT(*) AS views FROM page_views WHERE ${human} GROUP BY device_class ORDER BY views DESC LIMIT 8`,
		current,
	)).map((row) => ({ device: text(row, "device") as NewsStatsReport["devices"][number]["device"], views: num(row, "views") }));
	report.browsers = named(await grouped(
		`SELECT browser AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND browser != '' GROUP BY browser ORDER BY views DESC LIMIT 20`,
		current,
	), "name");
	report.operatingSystems = named(await grouped(
		`SELECT os AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND os != '' GROUP BY os ORDER BY views DESC LIMIT 20`,
		current,
	), "name");
	report.screens = named(await grouped(
		`SELECT screen AS name, COUNT(*) AS views FROM page_views
		 WHERE bot = 0 AND event_kind = 'engage' AND screen != '' AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}
		 GROUP BY screen ORDER BY views DESC LIMIT 8`,
		current,
	), "name");
	report.languages = named(await grouped(
		`SELECT lang AS name, COUNT(*) AS views FROM page_views WHERE ${human} AND lang != '' GROUP BY lang ORDER BY views DESC LIMIT 20`,
		current,
	), "name");
	report.campaigns = (await grouped(
		`SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, utm_term AS term, COUNT(*) AS views
		 FROM page_views WHERE ${human} AND (utm_source != '' OR utm_medium != '' OR utm_campaign != '' OR utm_term != '')
		 GROUP BY source, medium, campaign, term ORDER BY views DESC LIMIT 30`,
		current,
	)).map((row) => ({
		source: text(row, "source"),
		medium: text(row, "medium"),
		campaign: text(row, "campaign"),
		term: text(row, "term"),
		views: num(row, "views"),
	}));
	const clicks = async (kind: string) => (await grouped(
		`SELECT click_host AS host, click_path AS path, COUNT(*) AS views FROM page_views
		 WHERE bot = 0 AND event_kind = 'click' AND click_kind = ? AND viewed_at >= ? AND viewed_at <= ? AND ${whereSlug()}
		 GROUP BY host, path ORDER BY views DESC LIMIT 30`,
		[kind, startIso, endIso, slug, slug],
	)).map((row) => ({ host: text(row, "host"), path: text(row, "path"), views: num(row, "views") }));
	report.outbound = await clicks("outbound");
	report.sourceClicks = await clicks("source");
	report.notFound = named(await optionalRows(
		db,
		`SELECT path AS name, SUM(hits) AS views FROM stats_miss_daily WHERE day >= ? AND day <= ? GROUP BY path ORDER BY views DESC LIMIT 30`,
		[startDay, endDay],
	), "name");
	report.feeds = named(await optionalRows(
		db,
		`SELECT path AS name, SUM(hits) AS views FROM stats_feed_daily WHERE day >= ? AND day <= ? GROUP BY path ORDER BY views DESC LIMIT 20`,
		[startDay, endDay],
	), "name");

	const earliest = await db.prepare(
		`SELECT MIN(viewed_at) AS since FROM page_views WHERE bot = 0 AND event_kind = 'view'`,
	).bind().first<Record<string, unknown>>();
	report.since = text(earliest ?? {}, "since") || null;
	report.range = { from: query.from, to: query.to };
	const rolledDays = await optionalRows(
		db,
		`SELECT day AS label, views, uniques FROM stats_daily WHERE day >= ? AND day <= ? ORDER BY day LIMIT 120`,
		[startDay, endDay],
	);
	if (!report.series.day.length && rolledDays.length) {
		report.series.day = rolledDays.map((row) => ({ label: text(row, "label"), views: num(row, "views"), uniques: num(row, "uniques") }));
		report.series.week = bucketDays(report.series.day, false);
		report.series.month = bucketDays(report.series.day, true);
	}
	return report;
}
