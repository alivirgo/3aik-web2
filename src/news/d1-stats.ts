import type { ArticleCatalogEntry, NamedCount, NewsStatsReport, PageCount, SeriesPoint, StatsQuery } from "./pageviews";
import { emptyStatsReport, STATS_NOTE } from "./pageviews";
import { authorById } from "./authors";
import { isCategory, wordCount } from "./text";

interface StatsDb {
	prepare(sql: string): {
		bind(...values: unknown[]): {
			all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
			first<T = Record<string, unknown>>(): Promise<T | null>;
		};
	};
}

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
 * Dashboard numbers come from daily and hourly rollups, each query LIMITed.
 * Raw events are in Analytics Engine. This function does not scan page_views.
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
	const prevStartDay = new Date(startMs - length).toISOString().slice(0, 10);
	const prevEndDay = new Date(startMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const slug = query.slug ?? "";
	const hour = now.getUTCHours();
	const today = now.toISOString().slice(0, 10);
	const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

	const dayRows = await optionalRows(
		db,
		`SELECT day AS label, SUM(views) AS views, SUM(uniques) AS uniques
		 FROM stats_article_hour WHERE day >= ? AND day <= ? AND ${whereSlug()}
		 GROUP BY day ORDER BY day LIMIT 120`,
		[prevStartDay, endDay, slug, slug],
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

	const hourRows = await optionalRows(
		db,
		`SELECT printf('%sT%02d', day, hour_utc) AS label, SUM(views) AS views, SUM(uniques) AS uniques
		 FROM stats_article_hour WHERE day >= ? AND day <= ? AND ${whereSlug()}
		 GROUP BY day, hour_utc ORDER BY day DESC, hour_utc DESC LIMIT 48`,
		[yesterday, endDay, slug, slug],
	);
	report.series.hour = hourRows.map((row) => ({
		label: text(row, "label"),
		views: num(row, "views"),
		uniques: num(row, "uniques"),
	})).reverse();

	const sumViews = async (fromDay: string, toDay: string): Promise<number> => {
		const list = await optionalRows(
			db,
			`SELECT COALESCE(SUM(views), 0) AS views FROM stats_article_hour WHERE day >= ? AND day <= ? AND ${whereSlug()}`,
			[fromDay, toDay, slug, slug],
		);
		return num(list[0] ?? null, "views");
	};
	const lastDay = await optionalRows(
		db,
		`SELECT COALESCE(SUM(views), 0) AS views FROM stats_article_hour
		 WHERE ${whereSlug()} AND ((day = ? AND hour_utc >= ?) OR day = ?)`,
		[slug, slug, yesterday, hour, today],
	);
	// All-time is the retained window. Older rows are deleted, and a day range
	// on the (day, hour_utc, slug) primary key avoids a scan from year 1970.
	const retainedFrom = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const totalsSql = slug
		? `SELECT COALESCE(SUM(views), 0) AS views FROM stats_article_hour WHERE day >= ? AND day <= ? AND slug = ?`
		: `SELECT COALESCE(SUM(views), 0) AS views FROM stats_article_hour WHERE day >= ? AND day <= ?`;
	const totalsBinds = slug ? [retainedFrom, today, slug] : [retainedFrom, today];
	const totals = await optionalRows(db, totalsSql, totalsBinds);
	report.totals.views = num(totals[0] ?? null, "views");
	report.totals.last24h = num(lastDay[0] ?? null, "views");
	report.totals.last7d = await sumViews(weekAgo, today);
	report.audience.uniques = report.series.day.reduce((sum, point) => sum + point.uniques, 0);

	const botRows = await optionalRows(
		db,
		`SELECT bot_name AS name, SUM(hits) AS views FROM stats_bot_daily WHERE day >= ? AND day <= ? GROUP BY bot_name ORDER BY views DESC LIMIT 30`,
		[startDay, endDay],
	);
	report.bots = named(botRows, "name");
	const botWindow = async (fromDay: string, toDay: string) => {
		const list = await optionalRows(
			db,
			`SELECT COALESCE(SUM(hits), 0) AS bots FROM stats_bot_daily WHERE day >= ? AND day <= ?`,
			[fromDay, toDay],
		);
		return num(list[0] ?? null, "bots");
	};
	report.totals.botHitsExcluded = await botWindow(startDay, endDay);

	const engageOf = async (fromDay: string, toDay: string) => {
		const list = await optionalRows(
			db,
			`SELECT COALESCE(SUM(engaged_ms), 0) AS ms, COALESCE(SUM(engage_n), 0) AS n, COALESCE(SUM(scroll_sum), 0) AS scroll
			 FROM stats_article_hour WHERE day >= ? AND day <= ? AND ${whereSlug()}`,
			[fromDay, toDay, slug, slug],
		);
		const row = list[0] ?? null;
		const n = num(row, "n");
		return {
			avgEngagedMs: n ? Math.round(num(row, "ms") / n) : 0,
			avgScrollPct: n ? Math.round(num(row, "scroll") / n) : 0,
		};
	};
	const currentEngage = await engageOf(startDay, endDay);
	const previousEngage = await engageOf(prevStartDay, prevEndDay);
	const previousDays = days.filter((point) => inPrevious(point.label));
	report.comparison = {
		current: {
			from: startDay,
			to: endDay,
			views: report.series.day.reduce((sum, point) => sum + point.views, 0),
			uniques: report.audience.uniques,
			bots: report.totals.botHitsExcluded,
			avgEngagedMs: currentEngage.avgEngagedMs,
			avgScrollPct: currentEngage.avgScrollPct,
			bounceRate: null,
		},
		previous: {
			from: prevStartDay,
			to: prevEndDay,
			views: previousDays.reduce((sum, point) => sum + point.views, 0),
			uniques: previousDays.reduce((sum, point) => sum + point.uniques, 0),
			bots: await botWindow(prevStartDay, prevEndDay),
			avgEngagedMs: previousEngage.avgEngagedMs,
			avgScrollPct: previousEngage.avgScrollPct,
			bounceRate: null,
		},
	};
	report.audience.bounceRate = null;
	report.audience.avgEngagedMs = currentEngage.avgEngagedMs;
	report.audience.avgScrollPct = currentEngage.avgScrollPct;

	const articleRows = await optionalRows(
		db,
		`SELECT slug, SUM(views) AS views, SUM(uniques) AS uniques,
			SUM(CASE WHEN day >= ? THEN views ELSE 0 END) AS last24h,
			SUM(CASE WHEN day >= ? THEN views ELSE 0 END) AS last7d,
			SUM(engaged_ms) AS ms, SUM(engage_n) AS n, SUM(scroll_sum) AS scroll
		 FROM stats_article_hour WHERE day >= ? AND day <= ? AND ${whereSlug()}
		 GROUP BY slug HAVING views > 0 ORDER BY views DESC LIMIT 40`,
		[yesterday, weekAgo, startDay, endDay, slug, slug],
	);
	const catalogRows = await optionalRows(
		db,
		`SELECT slug, title, category, tags_json, author_id, body_text, published_at FROM articles ORDER BY published_at DESC LIMIT 80`,
		[],
	);
	const catalog = new Map<string, ArticleCatalogEntry>();
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
	}
	report.articles = articleRows.map((row) => {
		const articleSlug = text(row, "slug");
		const n = num(row, "n");
		return {
			slug: articleSlug,
			title: catalog.get(articleSlug)?.title ?? "",
			views: num(row, "views"),
			uniques: num(row, "uniques"),
			last24h: num(row, "last24h"),
			last7d: num(row, "last7d"),
			avgEngagedMs: n ? Math.round(num(row, "ms") / n) : 0,
			avgScrollPct: n ? Math.round(num(row, "scroll") / n) : 0,
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
	report.publishLog = [...catalog.values()].slice(0, 30).map((article) => ({
		slug: article.slug,
		title: article.title,
		publishedAt: article.publishedAt,
		words: article.words,
		category: article.category,
		author: article.authorName,
		tags: article.tags.join(", "),
	}));
	report.pages = report.articles.slice(0, 40).map((row): PageCount => ({
		page: "article",
		slug: row.slug,
		label: row.slug,
		views: row.views,
	}));
	const liveRows = await optionalRows(
		db,
		`SELECT slug, SUM(views) AS views FROM stats_article_hour
		 WHERE day = ? AND hour_utc = ? AND ${whereSlug()}
		 GROUP BY slug ORDER BY views DESC LIMIT 20`,
		[today, hour, slug, slug],
	);
	report.realtime.pages = liveRows.map((row): PageCount => ({
		page: "article",
		slug: text(row, "slug"),
		label: text(row, "slug"),
		views: num(row, "views"),
	}));
	report.realtime.views = report.realtime.pages.reduce((sum, row) => sum + row.views, 0);

	const topRows = await optionalRows(
		db,
		`SELECT day, slug, SUM(views) AS views FROM stats_article_hour
		 WHERE day >= ? AND day <= ? AND ${whereSlug()}
		 GROUP BY day, slug ORDER BY day DESC, views DESC LIMIT 80`,
		[startDay, endDay, slug, slug],
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
		if (report.topByDay.length >= 14) break;
	}

	const clicks = async (kind: string) => (await optionalRows(
		db,
		`SELECT host, path, SUM(hits) AS views FROM stats_click_daily
		 WHERE kind = ? AND day >= ? AND day <= ? AND ${whereSlug()}
		 GROUP BY host, path ORDER BY views DESC LIMIT 30`,
		[kind, startDay, endDay, slug, slug],
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
	const earliest = await optionalRows(
		db,
		`SELECT MIN(day) AS since FROM stats_article_hour WHERE ${whereSlug()}`,
		[slug, slug],
	);
	report.since = text(earliest[0] ?? {}, "since") || null;
	report.range = { from: query.from, to: query.to };
	return report;
}
