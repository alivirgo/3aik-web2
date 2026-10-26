import { authorById } from "./authors";
import type { ArticleCatalogEntry, NewsStatsReport, PageViewEvent, StatsQuery } from "./pageviews";
import { emptyStatsReport, normalizeEvent, rawRetentionCutoff, summarizePageViews } from "./pageviews";
import type { Category, DeskStats, SitemapEntry, StoredArticle, StoredRelated, StoredSource } from "./types";
import { isCategory, wordCount } from "./text";

export interface NewsRepository {
	listRecent(limit: number, category?: Category): Promise<StoredArticle[]>;
	listByAuthor(authorId: string, limit: number): Promise<StoredArticle[]>;
	getBySlug(slug: string): Promise<StoredArticle | null>;
	getById(id: string): Promise<StoredArticle | null>;
	hasSource(url: string): Promise<boolean>;
	hasSlug(slug: string): Promise<boolean>;
	similarityCorpus(limit: number): Promise<Array<{ title: string; bodyText: string; slug: string }>>;
	countPublishedSince(iso: string): Promise<number>;
	stats(): Promise<DeskStats>;
	insert(article: StoredArticle): Promise<void>;
	tryLock(untilIso: string, nowIso: string): Promise<boolean>;
	unlock(): Promise<void>;
	isRejected(url: string, nowIso: string): Promise<boolean>;
	rejectSource(url: string, reason: string, expiresAt: string): Promise<void>;
	forgetExpiredRejections(nowIso: string): Promise<void>;
	listSitemap(limit: number): Promise<SitemapEntry[]>;
	expiredArticles(cutoffIso: string, limit: number): Promise<Array<{ id: string; imageKey: string }>>;
	deleteArticle(id: string): Promise<void>;
	findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null>;
	listRecentSourceUrls(limit: number): Promise<string[]>;
	/** Hourly ingest counter stored in runtime_lock. True when this request is inside the cap. */
	consumeIngest(bucket: string, limit: number): Promise<boolean>;
	recordPageView(event: PageViewEvent): Promise<void>;
	pageViewReport(now: Date, query?: StatsQuery): Promise<NewsStatsReport>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readString(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	return typeof value === "string" ? value : "";
}

function readJson<T>(row: Record<string, unknown>, key: string, fallback: T): T {
	const value = row[key];
	if (typeof value !== "string" || !value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function articleFromRow(row: Record<string, unknown>): StoredArticle | null {
	const category = readString(row, "category");
	if (!isCategory(category)) return null;
	return {
		id: readString(row, "id"),
		slug: readString(row, "slug"),
		title: readString(row, "title"),
		description: readString(row, "description"),
		category,
		tags: readJson<string[]>(row, "tags_json", []),
		authorId: readString(row, "author_id"),
		bodyHtml: readString(row, "body_html"),
		bodyText: readString(row, "body_text"),
		keyPoints: readJson<string[]>(row, "key_points_json", []),
		faq: readJson(row, "faq_json", []),
		sources: readJson<StoredSource[]>(row, "sources_json", []),
		related: readJson<StoredRelated[]>(row, "related_json", []),
		imageKey: readString(row, "image_key"),
		imageCommit: readString(row, "image_commit"),
		imageAlt: readString(row, "image_alt"),
		imageType: readString(row, "image_type"),
		imageCredit: readString(row, "image_credit"),
		imageSourceUrl: readString(row, "image_source_url"),
		publishedAt: readString(row, "published_at"),
		updatedAt: readString(row, "updated_at"),
	};
}

const ARTICLE_COLUMNS_FULL = `id, slug, title, description, category, tags_json, author_id, body_html, body_text,
	key_points_json, faq_json, sources_json, related_json, image_key, image_commit, image_alt, image_type,
	image_credit, image_source_url, published_at, updated_at`;

const ARTICLE_COLUMNS_LEGACY = `id, slug, title, description, category, tags_json, author_id, body_html, body_text,
	key_points_json, faq_json, sources_json, related_json, image_key, image_commit, image_alt, image_type, published_at, updated_at`;

function missingSchema(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /no such column|no such table/i.test(message);
}

function missingColumn(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /no such column/i.test(message);
}

export class D1NewsRepository implements NewsRepository {
	private fullColumns: boolean | null = null;

	constructor(private readonly db: D1Database) {}

	private async articleColumns(): Promise<string> {
		if (this.fullColumns === true) return ARTICLE_COLUMNS_FULL;
		if (this.fullColumns === false) return ARTICLE_COLUMNS_LEGACY;
		try {
			await this.db.prepare("SELECT image_credit, image_source_url FROM articles LIMIT 1").first();
			this.fullColumns = true;
			return ARTICLE_COLUMNS_FULL;
		} catch (error) {
			if (!missingSchema(error)) throw error;
			this.fullColumns = false;
			return ARTICLE_COLUMNS_LEGACY;
		}
	}

	private async rows(sql: string, ...bindings: unknown[]): Promise<StoredArticle[]> {
		const columns = await this.articleColumns();
		const result = await this.db.prepare(sql.replaceAll("{{columns}}", columns)).bind(...bindings).all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => articleFromRow(row)).filter((article): article is StoredArticle => Boolean(article));
	}

	async listRecent(limit: number, category?: Category): Promise<StoredArticle[]> {
		if (category) {
			return this.rows(
				`SELECT {{columns}} FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT ?`,
				category,
				limit,
			);
		}
		return this.rows(`SELECT {{columns}} FROM articles ORDER BY published_at DESC LIMIT ?`, limit);
	}

	async listByAuthor(authorId: string, limit: number): Promise<StoredArticle[]> {
		return this.rows(
			`SELECT {{columns}} FROM articles WHERE author_id = ? ORDER BY published_at DESC LIMIT ?`,
			authorId,
			limit,
		);
	}

	async getBySlug(slug: string): Promise<StoredArticle | null> {
		const columns = await this.articleColumns();
		const row = await this.db.prepare(`SELECT ${columns} FROM articles WHERE slug = ?`).bind(slug).first<Record<string, unknown>>();
		const record = asRecord(row);
		return record ? articleFromRow(record) : null;
	}

	async getById(id: string): Promise<StoredArticle | null> {
		const columns = await this.articleColumns();
		const row = await this.db.prepare(`SELECT ${columns} FROM articles WHERE id = ?`).bind(id).first<Record<string, unknown>>();
		const record = asRecord(row);
		return record ? articleFromRow(record) : null;
	}

	async hasSource(url: string): Promise<boolean> {
		const row = await this.db.prepare("SELECT source_url FROM article_sources WHERE source_url = ?").bind(url).first();
		return Boolean(row);
	}

	async hasSlug(slug: string): Promise<boolean> {
		const row = await this.db.prepare("SELECT slug FROM articles WHERE slug = ?").bind(slug).first();
		return Boolean(row);
	}

	async similarityCorpus(limit: number): Promise<Array<{ title: string; bodyText: string; slug: string }>> {
		const result = await this.db
			.prepare("SELECT title, body_text, slug FROM articles ORDER BY published_at DESC LIMIT ?")
			.bind(limit)
			.all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => ({
			title: readString(row, "title"),
			bodyText: readString(row, "body_text"),
			slug: readString(row, "slug"),
		}));
	}

	async countPublishedSince(iso: string): Promise<number> {
		const row = await this.db
			.prepare("SELECT COUNT(*) AS n FROM articles WHERE published_at >= ?")
			.bind(iso)
			.first<Record<string, unknown>>();
		const record = asRecord(row);
		const count = record ? Number(record.n) : 0;
		return Number.isFinite(count) ? count : 0;
	}

	async stats(): Promise<DeskStats> {
		const authors = await this.db.prepare("SELECT author_id, publish_count, last_published_at FROM author_stats").all<Record<string, unknown>>();
		const categories = await this.db.prepare("SELECT category, publish_count, last_published_at FROM category_stats").all<Record<string, unknown>>();
		const authorMap: DeskStats["authors"] = {};
		for (const row of authors.results ?? []) {
			authorMap[readString(row, "author_id")] = {
				count: Number(row.publish_count) || 0,
				last: readString(row, "last_published_at") || null,
			};
		}
		const categoryMap: DeskStats["categories"] = {};
		for (const row of categories.results ?? []) {
			categoryMap[readString(row, "category")] = {
				count: Number(row.publish_count) || 0,
				last: readString(row, "last_published_at") || null,
			};
		}
		return { authors: authorMap, categories: categoryMap };
	}

	private articleInsert(article: StoredArticle, full: boolean): D1PreparedStatement {
		if (!full) {
			return this.db
				.prepare(
					`INSERT INTO articles (
						id, slug, title, description, category, tags_json, author_id, body_html, body_text,
						key_points_json, faq_json, sources_json, related_json, image_key, image_commit, image_alt, image_type,
						published_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					article.id,
					article.slug,
					article.title,
					article.description,
					article.category,
					JSON.stringify(article.tags),
					article.authorId,
					article.bodyHtml,
					article.bodyText,
					JSON.stringify(article.keyPoints),
					JSON.stringify(article.faq),
					JSON.stringify(article.sources),
					JSON.stringify(article.related),
					article.imageKey,
					article.imageCommit,
					article.imageAlt,
					article.imageType,
					article.publishedAt,
					article.updatedAt,
				);
		}
		return this.db
			.prepare(
				`INSERT INTO articles (
					id, slug, title, description, category, tags_json, author_id, body_html, body_text,
					key_points_json, faq_json, sources_json, related_json, image_key, image_commit, image_alt, image_type,
					image_credit, image_source_url, published_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				article.id,
				article.slug,
				article.title,
				article.description,
				article.category,
				JSON.stringify(article.tags),
				article.authorId,
				article.bodyHtml,
				article.bodyText,
				JSON.stringify(article.keyPoints),
				JSON.stringify(article.faq),
				JSON.stringify(article.sources),
				JSON.stringify(article.related),
				article.imageKey,
				article.imageCommit,
				article.imageAlt,
				article.imageType,
				article.imageCredit,
				article.imageSourceUrl,
				article.publishedAt,
				article.updatedAt,
			);
	}

	private insertBatch(article: StoredArticle, full: boolean): D1PreparedStatement[] {
		return [
			this.articleInsert(article, full),
			...article.sources.map((source) =>
				this.db
					.prepare("INSERT INTO article_sources (source_url, article_id, outlet, source_title) VALUES (?, ?, ?, ?)")
					.bind(source.url, article.id, source.outlet, source.title),
			),
			this.db
				.prepare(
					`INSERT INTO author_stats (author_id, publish_count, last_published_at) VALUES (?, 1, ?)
					 ON CONFLICT(author_id) DO UPDATE SET
					 publish_count = publish_count + 1,
					 last_published_at = excluded.last_published_at`,
				)
				.bind(article.authorId, article.publishedAt),
			this.db
				.prepare(
					`INSERT INTO category_stats (category, publish_count, last_published_at) VALUES (?, 1, ?)
					 ON CONFLICT(category) DO UPDATE SET
					 publish_count = publish_count + 1,
					 last_published_at = excluded.last_published_at`,
				)
				.bind(article.category, article.publishedAt),
		];
	}

	async insert(article: StoredArticle): Promise<void> {
		const full = this.fullColumns !== false;
		try {
			await this.db.batch(this.insertBatch(article, full));
			if (full) this.fullColumns = true;
		} catch (error) {
			if (!full || !missingSchema(error)) throw error;
			this.fullColumns = false;
			await this.db.batch(this.insertBatch(article, false));
		}
	}

	async tryLock(untilIso: string, nowIso: string): Promise<boolean> {
		const result = await this.db
			.prepare(
				`INSERT INTO runtime_lock (name, locked_until) VALUES ('publish', ?)
				 ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until
				 WHERE runtime_lock.locked_until <= ?`,
			)
			.bind(untilIso, nowIso)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async unlock(): Promise<void> {
		await this.db
			.prepare("UPDATE runtime_lock SET locked_until = '1970-01-01T00:00:00.000Z' WHERE name = 'publish'")
			.run();
	}

	async isRejected(url: string, nowIso: string): Promise<boolean> {
		const row = await this.db
			.prepare("SELECT source_url FROM source_rejections WHERE source_url = ? AND expires_at > ?")
			.bind(url, nowIso)
			.first();
		return Boolean(row);
	}

	async rejectSource(url: string, reason: string, expiresAt: string): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO source_rejections (source_url, reason, expires_at) VALUES (?, ?, ?)
				 ON CONFLICT(source_url) DO UPDATE SET reason = excluded.reason, expires_at = excluded.expires_at`,
			)
			.bind(url, reason.slice(0, 180), expiresAt)
			.run();
	}

	async forgetExpiredRejections(nowIso: string): Promise<void> {
		await this.db.prepare("DELETE FROM source_rejections WHERE expires_at <= ?").bind(nowIso).run();
	}

	async listSitemap(limit: number): Promise<SitemapEntry[]> {
		const result = await this.db
			.prepare("SELECT slug, title, published_at, updated_at FROM articles ORDER BY published_at DESC LIMIT ?")
			.bind(limit)
			.all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => ({
			slug: readString(row, "slug"),
			title: readString(row, "title"),
			publishedAt: readString(row, "published_at"),
			updatedAt: readString(row, "updated_at"),
		})).filter((entry) => entry.slug && entry.publishedAt);
	}

	async expiredArticles(cutoffIso: string, limit: number): Promise<Array<{ id: string; imageKey: string }>> {
		const result = await this.db
			.prepare("SELECT id, image_key FROM articles WHERE published_at < ? ORDER BY published_at ASC LIMIT ?")
			.bind(cutoffIso, limit)
			.all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => ({
			id: readString(row, "id"),
			imageKey: readString(row, "image_key"),
		})).filter((entry) => entry.id);
	}

	async deleteArticle(id: string): Promise<void> {
		await this.db.batch([
			this.db.prepare("DELETE FROM article_sources WHERE article_id = ?").bind(id),
			this.db.prepare("DELETE FROM articles WHERE id = ?").bind(id),
		]);
	}

	async findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null> {
		const row = await this.db
			.prepare("SELECT image_type FROM articles WHERE image_key = ? AND image_commit = ? LIMIT 1")
			.bind(imageKey, imageCommit)
			.first<Record<string, unknown>>();
		const record = asRecord(row);
		const contentType = record ? readString(record, "image_type") : "";
		return contentType ? { contentType } : null;
	}

	async listRecentSourceUrls(limit: number): Promise<string[]> {
		const result = await this.db
			.prepare(
				`SELECT article_sources.source_url AS source_url
				 FROM article_sources
				 INNER JOIN articles ON articles.id = article_sources.article_id
				 ORDER BY articles.published_at DESC
				 LIMIT ?`,
			)
			.bind(limit)
			.all<Record<string, unknown>>();
		const urls: string[] = [];
		const seen = new Set<string>();
		for (const row of result.results ?? []) {
			const url = readString(row, "source_url");
			if (!url || seen.has(url)) continue;
			seen.add(url);
			urls.push(url);
		}
		return urls;
	}

	async consumeIngest(bucket: string, limit: number): Promise<boolean> {
		const name = `ingest:${bucket}`;
		const cutoff = new Date(Date.parse(bucket) - 48 * 60 * 60 * 1000).toISOString();
		const results = await this.db.batch([
			this.db.prepare("DELETE FROM runtime_lock WHERE name LIKE 'ingest:%' AND name < ?").bind(`ingest:${cutoff}`),
			this.db
				.prepare(
					`INSERT INTO runtime_lock (name, locked_until) VALUES (?, '1')
					 ON CONFLICT(name) DO UPDATE SET locked_until = CAST((CAST(runtime_lock.locked_until AS INTEGER) + 1) AS TEXT)
					 WHERE CAST(runtime_lock.locked_until AS INTEGER) < ?`,
				)
				.bind(name, limit),
		]);
		return (results[1]?.meta?.changes ?? 0) > 0;
	}

	async recordPageView(event: PageViewEvent): Promise<void> {
		const row = normalizeEvent(event);
		try {
			await this.insertPageView(row, true);
		} catch (error) {
			if (!missingColumn(error)) throw error;
			await this.insertPageView(row, false);
		}
		try {
			await this.rollupPageView(row);
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
		try {
			await this.pruneRawEvents(new Date());
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
	}

	private async insertPageView(event: ReturnType<typeof normalizeEvent>, full: boolean): Promise<void> {
		if (!full) {
			await this.db
				.prepare(
					`INSERT INTO page_views (
						viewed_at, slug, page, referrer_host, referrer_path, source_class, search_engine, search_query,
						utm_source, utm_medium, utm_campaign, utm_term, country, device_class, bot
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					event.viewedAt,
					event.slug,
					event.page,
					event.referrerHost,
					event.referrerPath,
					event.sourceClass,
					event.searchEngine,
					event.searchQuery,
					event.utmSource,
					event.utmMedium,
					event.utmCampaign,
					event.utmTerm,
					event.country,
					event.deviceClass,
					event.bot,
				)
				.run();
			return;
		}
		await this.db
			.prepare(
				`INSERT INTO page_views (
					viewed_at, slug, page, referrer_host, referrer_path, source_class, search_engine, search_query,
					utm_source, utm_medium, utm_campaign, utm_term, country, region, city, continent, device_class,
					browser, os, screen, lang, bot, bot_name, visitor_hash, hour_utc, hour_karachi, event_kind,
					engaged_ms, scroll_pct, seen_before, click_host, click_path, click_kind
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				event.viewedAt,
				event.slug,
				event.page,
				event.referrerHost,
				event.referrerPath,
				event.sourceClass,
				event.searchEngine,
				event.searchQuery,
				event.utmSource,
				event.utmMedium,
				event.utmCampaign,
				event.utmTerm,
				event.country,
				event.region,
				event.city,
				event.continent,
				event.deviceClass,
				event.browser,
				event.os,
				event.screen,
				event.lang,
				event.bot,
				event.botName,
				event.visitorHash,
				event.hourUtc,
				event.hourKarachi,
				event.eventKind,
				event.engagedMs,
				event.scrollPct,
				event.returning,
				event.clickHost,
				event.clickPath,
				event.clickKind,
			)
			.run();
	}

	private async rollupPageView(event: ReturnType<typeof normalizeEvent>): Promise<void> {
		const day = event.viewedAt.slice(0, 10);
		if (event.eventKind === "view") {
			let uniques = 0;
			if (event.bot === 0 && event.visitorHash) {
				const inserted = await this.db
					.prepare(`INSERT OR IGNORE INTO stats_visitor_day (day, visitor_hash) VALUES (?, ?)`)
					.bind(day, event.visitorHash)
					.run();
				uniques = inserted.meta?.changes ?? 0;
			}
			await this.db
				.prepare(
					`INSERT INTO stats_daily (day, views, uniques, bots, engaged_ms, engage_n)
					 VALUES (?, ?, ?, ?, 0, 0)
					 ON CONFLICT(day) DO UPDATE SET
					 views = views + excluded.views,
					 uniques = uniques + excluded.uniques,
					 bots = bots + excluded.bots`,
				)
				.bind(day, event.bot === 0 ? 1 : 0, uniques, event.bot === 1 ? 1 : 0)
				.run();
			return;
		}
		if (event.eventKind === "engage" && event.bot === 0) {
			await this.db
				.prepare(
					`INSERT INTO stats_daily (day, views, uniques, bots, engaged_ms, engage_n)
					 VALUES (?, 0, 0, 0, ?, 1)
					 ON CONFLICT(day) DO UPDATE SET
					 engaged_ms = engaged_ms + excluded.engaged_ms,
					 engage_n = engage_n + 1`,
				)
				.bind(day, event.engagedMs)
				.run();
		}
	}

	private async pruneRawEvents(now: Date): Promise<void> {
		const until = new Date(now.getTime() + 60_000).toISOString();
		const lock = await this.db
			.prepare(
				`INSERT INTO runtime_lock (name, locked_until) VALUES ('stats-prune', ?)
				 ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until
				 WHERE runtime_lock.locked_until <= ?`,
			)
			.bind(until, now.toISOString())
			.run();
		if ((lock.meta?.changes ?? 0) < 1) return;
		await this.db
			.prepare(`DELETE FROM page_views WHERE id IN (SELECT id FROM page_views WHERE viewed_at < ? LIMIT 200)`)
			.bind(rawRetentionCutoff(now))
			.run();
	}

	async pageViewReport(now: Date, query: StatsQuery = { from: null, to: null, slug: null }): Promise<NewsStatsReport> {
		try {
			return await this.pageViewReportDetailed(now, query);
		} catch (error) {
			if (!missingSchema(error)) throw error;
			const report = emptyStatsReport(now);
			report.ready = false;
			return report;
		}
	}

	private async pageViewReportDetailed(now: Date, query: StatsQuery): Promise<NewsStatsReport> {
		const bounds = reportBounds(query, now);
		const rows = await this.db
			.prepare(
				`SELECT viewed_at, slug, page, referrer_host, referrer_path, source_class, search_engine, search_query,
					utm_source, utm_medium, utm_campaign, utm_term, country, region, city, continent, device_class,
					browser, os, screen, lang, bot, bot_name, visitor_hash, hour_utc, hour_karachi, event_kind,
					engaged_ms, scroll_pct, seen_before, click_host, click_path, click_kind
				 FROM page_views
				 WHERE (? IS NULL OR viewed_at >= ?) AND (? IS NULL OR viewed_at <= ?)
				 ORDER BY viewed_at DESC
				 LIMIT 20000`,
			)
			.bind(bounds.start, bounds.start, bounds.end, bounds.end)
			.all<Record<string, unknown>>();
		const articles = await this.db
			.prepare(
				`SELECT slug, title, category, tags_json, author_id, body_text, published_at
				 FROM articles
				 ORDER BY published_at DESC
				 LIMIT 500`,
			)
			.all<Record<string, unknown>>();
		const events = (rows.results ?? []).map(eventFromRow).reverse();
		const report = summarizePageViews(events, now, catalogFromRows(articles.results ?? []), query);
		report.truncated = (rows.results ?? []).length >= 20000;
		try {
			const daily = await this.db
				.prepare(`SELECT day, views, uniques, bots FROM stats_daily`)
				.all<Record<string, unknown>>();
			const seen = new Set(events.map((event) => event.viewedAt.slice(0, 10)));
			for (const row of daily.results ?? []) {
				const day = readString(row, "day");
				if (!day || seen.has(day)) continue;
				if (query.from && day < query.from) continue;
				if (query.to && day > query.to) continue;
				if (query.slug) continue;
				report.totals.views += numberOf(row, "views");
				report.totals.botHitsExcluded += numberOf(row, "bots");
				report.audience.uniques += numberOf(row, "uniques");
				report.series.day.push({ label: day, views: numberOf(row, "views"), uniques: numberOf(row, "uniques") });
			}
			report.series.day.sort((left, right) => left.label.localeCompare(right.label));
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
		return report;
	}

}

function numberOf(row: Record<string, unknown> | null, key: string): number {
	if (!row) return 0;
	const value = Number(row[key]);
	return Number.isFinite(value) ? value : 0;
}

function reportBounds(query: StatsQuery, now: Date): { start: string | null; end: string | null } {
	if (!query.from && !query.to) return { start: null, end: null };
	const endDay = query.to ?? now.toISOString().slice(0, 10);
	const startDay = query.from ?? endDay;
	const endMs = Date.parse(`${endDay}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
	const startMs = Date.parse(`${startDay}T00:00:00.000Z`);
	const length = Math.max(24 * 60 * 60 * 1000, endMs - startMs);
	return {
		start: new Date(startMs - length).toISOString(),
		end: new Date(endMs - 1).toISOString(),
	};
}

function asSource(value: string): PageViewEvent["sourceClass"] {
	if (value === "search" || value === "social" || value === "direct" || value === "internal" || value === "other") return value;
	return "other";
}

function asDevice(value: string): PageViewEvent["deviceClass"] {
	if (value === "desktop" || value === "mobile" || value === "tablet" || value === "other") return value;
	return "other";
}

function asKind(value: string): PageViewEvent["eventKind"] {
	if (value === "view" || value === "engage" || value === "click" || value === "404" || value === "feed") return value;
	return "view";
}

function asScreen(value: string): PageViewEvent["screen"] {
	if (value === "xs" || value === "sm" || value === "md" || value === "lg") return value;
	return "";
}

function asClick(value: string): PageViewEvent["clickKind"] {
	if (value === "outbound" || value === "source") return value;
	return "";
}

function eventFromRow(row: Record<string, unknown>): PageViewEvent {
	const returning = numberOf(row, "seen_before");
	return {
		viewedAt: readString(row, "viewed_at"),
		slug: readString(row, "slug"),
		page: readString(row, "page"),
		referrerHost: readString(row, "referrer_host"),
		referrerPath: readString(row, "referrer_path"),
		sourceClass: asSource(readString(row, "source_class")),
		searchEngine: readString(row, "search_engine"),
		searchQuery: readString(row, "search_query"),
		utmSource: readString(row, "utm_source"),
		utmMedium: readString(row, "utm_medium"),
		utmCampaign: readString(row, "utm_campaign"),
		utmTerm: readString(row, "utm_term"),
		country: readString(row, "country"),
		region: readString(row, "region"),
		city: readString(row, "city"),
		continent: readString(row, "continent"),
		deviceClass: asDevice(readString(row, "device_class")),
		browser: readString(row, "browser"),
		os: readString(row, "os"),
		screen: asScreen(readString(row, "screen")),
		lang: readString(row, "lang"),
		bot: numberOf(row, "bot") ? 1 : 0,
		botName: readString(row, "bot_name"),
		visitorHash: readString(row, "visitor_hash"),
		hourUtc: numberOf(row, "hour_utc"),
		hourKarachi: numberOf(row, "hour_karachi"),
		eventKind: asKind(readString(row, "event_kind")),
		engagedMs: numberOf(row, "engaged_ms"),
		scrollPct: numberOf(row, "scroll_pct"),
		returning: returning === 0 || returning === 1 ? returning : -1,
		clickHost: readString(row, "click_host"),
		clickPath: readString(row, "click_path"),
		clickKind: asClick(readString(row, "click_kind")),
	};
}

function catalogFromArticles(articles: StoredArticle[]): Map<string, ArticleCatalogEntry> {
	const map = new Map<string, ArticleCatalogEntry>();
	for (const article of articles) {
		map.set(article.slug, {
			slug: article.slug,
			title: article.title,
			category: article.category,
			tags: article.tags,
			authorId: article.authorId,
			authorName: authorById(article.authorId)?.name ?? article.authorId,
			publishedAt: article.publishedAt,
			words: wordCount(article.bodyText),
		});
	}
	return map;
}

function catalogFromRows(rows: Record<string, unknown>[]): Map<string, ArticleCatalogEntry> {
	const articles: StoredArticle[] = [];
	for (const row of rows) {
		const category = readString(row, "category");
		if (!isCategory(category)) continue;
		articles.push({
			id: "",
			slug: readString(row, "slug"),
			title: readString(row, "title"),
			description: "",
			category,
			tags: readJson<string[]>(row, "tags_json", []),
			authorId: readString(row, "author_id"),
			bodyHtml: "",
			bodyText: readString(row, "body_text"),
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
			publishedAt: readString(row, "published_at"),
			updatedAt: readString(row, "published_at"),
		});
	}
	return catalogFromArticles(articles);
}

export class MemoryNewsRepository implements NewsRepository {
	articles: StoredArticle[] = [];
	pageViews: PageViewEvent[] = [];
	private lockUntil = 0;
	private rejections = new Map<string, { reason: string; expiresAt: string }>();

	async listRecent(limit: number, category?: Category): Promise<StoredArticle[]> {
		return this.articles
			.filter((article) => !category || article.category === category)
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(0, limit);
	}

	async listByAuthor(authorId: string, limit: number): Promise<StoredArticle[]> {
		return this.articles
			.filter((article) => article.authorId === authorId)
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(0, limit);
	}

	async getBySlug(slug: string): Promise<StoredArticle | null> {
		return this.articles.find((article) => article.slug === slug) ?? null;
	}

	async getById(id: string): Promise<StoredArticle | null> {
		return this.articles.find((article) => article.id === id) ?? null;
	}

	async hasSource(url: string): Promise<boolean> {
		return this.articles.some((article) => article.sources.some((source) => source.url === url));
	}

	async hasSlug(slug: string): Promise<boolean> {
		return this.articles.some((article) => article.slug === slug);
	}

	async similarityCorpus(limit: number): Promise<Array<{ title: string; bodyText: string; slug: string }>> {
		return this.articles
			.slice()
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(0, limit)
			.map((article) => ({ title: article.title, bodyText: article.bodyText, slug: article.slug }));
	}

	async countPublishedSince(iso: string): Promise<number> {
		return this.articles.filter((article) => article.publishedAt >= iso).length;
	}

	async stats(): Promise<DeskStats> {
		const authors: DeskStats["authors"] = {};
		const categories: DeskStats["categories"] = {};
		for (const article of this.articles) {
			const author = authors[article.authorId] ?? { count: 0, last: null };
			author.count += 1;
			if (!author.last || article.publishedAt > author.last) author.last = article.publishedAt;
			authors[article.authorId] = author;
			const category = categories[article.category] ?? { count: 0, last: null };
			category.count += 1;
			if (!category.last || article.publishedAt > category.last) category.last = article.publishedAt;
			categories[article.category] = category;
		}
		return { authors, categories };
	}

	async insert(article: StoredArticle): Promise<void> {
		if (await this.hasSlug(article.slug)) throw new Error("duplicate_slug");
		for (const source of article.sources) {
			if (await this.hasSource(source.url)) throw new Error("duplicate_source");
		}
		this.articles.push(article);
	}

	async tryLock(untilIso: string, nowIso: string): Promise<boolean> {
		const now = Date.parse(nowIso);
		if (this.lockUntil > now) return false;
		this.lockUntil = Date.parse(untilIso);
		return true;
	}

	async unlock(): Promise<void> {
		this.lockUntil = 0;
	}

	async isRejected(url: string, nowIso: string): Promise<boolean> {
		const row = this.rejections.get(url);
		return Boolean(row && row.expiresAt > nowIso);
	}

	async rejectSource(url: string, reason: string, expiresAt: string): Promise<void> {
		this.rejections.set(url, { reason: reason.slice(0, 180), expiresAt });
	}

	async forgetExpiredRejections(nowIso: string): Promise<void> {
		for (const [url, row] of this.rejections) {
			if (row.expiresAt <= nowIso) this.rejections.delete(url);
		}
	}

	async listSitemap(limit: number): Promise<SitemapEntry[]> {
		return this.articles
			.slice()
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(0, limit)
			.map((article) => ({
				slug: article.slug,
				title: article.title,
				publishedAt: article.publishedAt,
				updatedAt: article.updatedAt,
			}));
	}

	async expiredArticles(cutoffIso: string, limit: number): Promise<Array<{ id: string; imageKey: string }>> {
		return this.articles
			.filter((article) => article.publishedAt < cutoffIso)
			.sort((left, right) => left.publishedAt.localeCompare(right.publishedAt))
			.slice(0, limit)
			.map((article) => ({ id: article.id, imageKey: article.imageKey }));
	}

	async deleteArticle(id: string): Promise<void> {
		this.articles = this.articles.filter((article) => article.id !== id);
	}

	async findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null> {
		const article = this.articles.find((entry) => entry.imageKey === imageKey && entry.imageCommit === imageCommit);
		return article?.imageType ? { contentType: article.imageType } : null;
	}

	async listRecentSourceUrls(limit: number): Promise<string[]> {
		const urls: string[] = [];
		const seen = new Set<string>();
		const ordered = this.articles.slice().sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
		for (const article of ordered) {
			for (const source of article.sources) {
				if (seen.has(source.url)) continue;
				seen.add(source.url);
				urls.push(source.url);
				if (urls.length >= limit) return urls;
			}
		}
		return urls;
	}

	private ingestHits = new Map<string, number>();

	async consumeIngest(bucket: string, limit: number): Promise<boolean> {
		const cutoffMs = Date.parse(bucket) - 48 * 60 * 60 * 1000;
		for (const key of this.ingestHits.keys()) {
			if (Date.parse(key) < cutoffMs) this.ingestHits.delete(key);
		}
		const hits = this.ingestHits.get(bucket) ?? 0;
		if (hits >= limit) return false;
		this.ingestHits.set(bucket, hits + 1);
		return true;
	}

	async recordPageView(event: PageViewEvent): Promise<void> {
		this.pageViews.push(event);
	}

	async pageViewReport(now: Date, query?: StatsQuery): Promise<NewsStatsReport> {
		return summarizePageViews(this.pageViews, now, catalogFromArticles(this.articles), query);
	}
}
