import { authorById } from "./authors";
import type { ArticleCatalogEntry, NewsStatsReport, PageViewEvent, StatsQuery } from "./pageviews";
import { flushAggregates, queueAggregate, rowsWrittenOf } from "./aggregates";
import { STATS_DAILY_WRITE_CAP, type StatsBudget } from "./budget";
import { loadD1StatsReport } from "./d1-stats";
import { writeNewsEvent } from "./events";
import { continentLabel, emptyStatsReport, hexToSalt, normalizeEvent, rawRetentionCutoff, rememberDaySalt, saltToHex, summarizePageViews } from "./pageviews";
import type { Category, DeskStats, SitemapEntry, StoredArticle, StoredRelated, StoredSource } from "./types";
import { canonicalLeadKey } from "./lead";
import { breakingCutoff, visibleCategory } from "./sections";
import { isCategory, wordCount } from "./text";

const readCountCache = new Map<string, { at: number; views: number }>();

export interface NewsRepository {
	listRecent(limit: number, category?: Category, offset?: number, now?: Date): Promise<StoredArticle[]>;
	readCounts(slugs: string[]): Promise<Map<string, number>>;
	listByAuthor(authorId: string, limit: number, offset?: number): Promise<StoredArticle[]>;
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
	listSitemap(limit: number, offset?: number): Promise<SitemapEntry[]>;
	countArticles(category?: Category): Promise<number>;
	countByAuthor(authorId: string): Promise<number>;
	expiredArticles(cutoffIso: string, limit: number): Promise<Array<{ id: string; imageKey: string }>>;
	deleteArticle(id: string): Promise<void>;
	findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null>;
	/** Pending crop list. Empty string means every crop is stored. Absent ids are unknown. */
	variantPending(ids: string[]): Promise<Map<string, string>>;
	/** Articles that can be resized now. Future retries and terminal failures are omitted. */
	listForBackfill(limit: number, nowIso: string): Promise<StoredArticle[]>;
	countForBackfill(nowIso: string): Promise<number>;
	/** Hide the article until retryAfter. Returns false when a later retry is already scheduled. */
	holdBackfill(articleId: string, updatedAt: string, retryAfter: string): Promise<boolean>;
	readBackfill(articleId: string): Promise<{ reason: string; retryAfter: string; pending: string; attempts: number } | null>;
	/** Retryable failure or the next variant. An empty retryAfter is terminal. */
	deferBackfill(articleId: string, reason: string, updatedAt: string, retryAfter: string, pending: string, attempts: number): Promise<void>;
	clearBackfill(articleId: string): Promise<void>;
	updateLeadImage(id: string, image: { imageKey: string; imageCommit: string; imageType: string; imageCredit: string; imageSourceUrl: string; updatedAt: string }): Promise<void>;
	listRecentSourceUrls(limit: number): Promise<string[]>;
	/** Hourly ingest counter stored in runtime_lock. True when this request is inside the cap. */
	consumeIngest(bucket: string, limit: number): Promise<boolean>;
	/**
	 * One IndexNow submit-all per window, stored in runtime_lock.
	 * `allowed` is false when a previous claim is still inside the window.
	 */
	claimIndexNowSubmit(nowIso: string, untilIso: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
	recordPageView(event: PageViewEvent): Promise<void>;
	persistDaySalt(day: string, saltHex: string): Promise<string>;
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
		section: readString(row, "section"),
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

export interface NewsStatsOptions {
	budget?: StatsBudget;
	analytics?: AnalyticsEngineDataset;
}

export class D1NewsRepository implements NewsRepository {
	private fullColumns: boolean | null = null;

	constructor(private readonly db: D1Database, private readonly statsOptions: NewsStatsOptions = {}) {}

	private sectionColumn: boolean | null = null;

	private async articleColumns(): Promise<string> {
		let base: string;
		if (this.fullColumns === true) base = ARTICLE_COLUMNS_FULL;
		else if (this.fullColumns === false) base = ARTICLE_COLUMNS_LEGACY;
		else {
			try {
				await this.db.prepare("SELECT image_credit, image_source_url FROM articles LIMIT 1").first();
				this.fullColumns = true;
				base = ARTICLE_COLUMNS_FULL;
			} catch (error) {
				if (!missingSchema(error)) throw error;
				this.fullColumns = false;
				base = ARTICLE_COLUMNS_LEGACY;
			}
		}
		if (this.sectionColumn === null) {
			try {
				await this.db.prepare("SELECT section FROM articles LIMIT 1").first();
				this.sectionColumn = true;
			} catch (error) {
				if (!missingColumn(error) && !missingSchema(error)) throw error;
				this.sectionColumn = false;
			}
		}
		return this.sectionColumn ? `${base}, section` : base;
	}

	private async rows(sql: string, ...bindings: unknown[]): Promise<StoredArticle[]> {
		const columns = await this.articleColumns();
		const result = await this.db.prepare(sql.replaceAll("{{columns}}", columns)).bind(...bindings).all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => articleFromRow(row)).filter((article): article is StoredArticle => Boolean(article));
	}

	private categoryClause(category: Category, now: Date): { sql: string; binds: unknown[] } {
		const cutoff = breakingCutoff(now.getTime());
		if (category === "breaking") {
			return { sql: "category = 'breaking' AND published_at > ?", binds: [cutoff] };
		}
		return {
			sql: "(category = ? OR (category = 'breaking' AND section = ? AND published_at <= ?))",
			binds: [category, category, cutoff],
		};
	}

	async listRecent(limit: number, category?: Category, offset = 0, now = new Date()): Promise<StoredArticle[]> {
		const start = Math.max(0, offset);
		if (!category) {
			return this.rows(`SELECT {{columns}} FROM articles ORDER BY published_at DESC LIMIT ? OFFSET ?`, limit, start);
		}
		try {
			const clause = this.categoryClause(category, now);
			return await this.rows(
				`SELECT {{columns}} FROM articles WHERE ${clause.sql} ORDER BY published_at DESC LIMIT ? OFFSET ?`,
				...clause.binds,
				limit,
				start,
			);
		} catch (error) {
			if (!missingColumn(error)) throw error;
			return this.rows(
				`SELECT {{columns}} FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT ? OFFSET ?`,
				category,
				limit,
				start,
			);
		}
	}

	async listByAuthor(authorId: string, limit: number, offset = 0): Promise<StoredArticle[]> {
		return this.rows(
			`SELECT {{columns}} FROM articles WHERE author_id = ? ORDER BY published_at DESC LIMIT ? OFFSET ?`,
			authorId,
			limit,
			Math.max(0, offset),
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

	private articleInsert(article: StoredArticle, full: boolean, withSection = false): D1PreparedStatement {
		const section = article.section ?? "";
		if (withSection && full) {
			return this.db
				.prepare(
					`INSERT INTO articles (
						id, slug, title, description, category, tags_json, author_id, body_html, body_text,
						key_points_json, faq_json, sources_json, related_json, image_key, image_commit, image_alt, image_type,
						image_credit, image_source_url, section, published_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
					section,
					article.publishedAt,
					article.updatedAt,
				);
		}
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

	private insertBatch(article: StoredArticle, full: boolean, withSection = false): D1PreparedStatement[] {
		return [
			this.articleInsert(article, full, withSection),
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
			await this.db.batch(this.insertBatch(article, full, true));
			if (full) this.fullColumns = true;
			this.sectionColumn = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (missingColumn(error) && /section/i.test(message)) {
				this.sectionColumn = false;
				await this.db.batch(this.insertBatch(article, full, false));
				if (full) this.fullColumns = true;
				return;
			}
			if (!full || !missingSchema(error)) throw error;
			this.fullColumns = false;
			await this.db.batch(this.insertBatch(article, false, false));
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

	async listSitemap(limit: number, offset = 0): Promise<SitemapEntry[]> {
		const result = await this.db
			.prepare("SELECT slug, title, published_at, updated_at FROM articles ORDER BY published_at DESC LIMIT ? OFFSET ?")
			.bind(limit, offset)
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

	async variantPending(ids: string[]): Promise<Map<string, string>> {
		const unique = [...new Set(ids.filter(Boolean))].slice(0, 80);
		const out = new Map<string, string>();
		if (!unique.length) return out;
		try {
			await this.ensureBackfillTable();
			const marks = unique.map(() => "?").join(", ");
			const result = await this.db
				.prepare(`SELECT article_id, reason, pending FROM article_image_backfill WHERE article_id IN (${marks})`)
				.bind(...unique)
				.all<Record<string, unknown>>();
			for (const row of result.results ?? []) {
				const id = readString(row, "article_id");
				if (!id) continue;
				const reason = readString(row, "reason");
				const pending = readString(row, "pending");
				out.set(id, reason === "ready" && !pending ? "" : pending);
			}
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
		return out;
	}

	async findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null> {
		const canonical = canonicalLeadKey(imageKey) ?? imageKey;
		const row = await this.db
			.prepare("SELECT image_key, image_type FROM articles WHERE image_commit = ? AND image_key IN (?, ?) LIMIT 1")
			.bind(imageCommit, imageKey, canonical)
			.first<Record<string, unknown>>();
		const record = asRecord(row);
		const contentType = record ? readString(record, "image_type") : "";
		const storedKey = record ? readString(record, "image_key") : "";
		if (!contentType || !storedKey) return null;
		if (storedKey === imageKey) return { contentType };
		if (storedKey === canonical && canonical.endsWith("-16x9.webp")) return { contentType: "image/webp" };
		return null;
	}

	private backfillTable: Promise<void> | null = null;

	private ensureBackfillTable(): Promise<void> {
		if (!this.backfillTable) {
			this.backfillTable = this.prepareBackfillTable().catch((error: unknown) => {
				this.backfillTable = null;
				throw error;
			});
		}
		return this.backfillTable;
	}

	private async prepareBackfillTable(): Promise<void> {
		await this.db
			.prepare(
				`CREATE TABLE IF NOT EXISTS article_image_backfill (
					article_id TEXT PRIMARY KEY,
					reason TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					retry_after TEXT NOT NULL DEFAULT '',
					attempts INTEGER NOT NULL DEFAULT 0,
					pending TEXT NOT NULL DEFAULT ''
				)`,
			)
			.run();
		for (const sql of [
			"ALTER TABLE article_image_backfill ADD COLUMN retry_after TEXT NOT NULL DEFAULT ''",
			"ALTER TABLE article_image_backfill ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
			"ALTER TABLE article_image_backfill ADD COLUMN pending TEXT NOT NULL DEFAULT ''",
		]) {
			try {
				await this.db.prepare(sql).run();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!/duplicate column/i.test(message)) throw error;
			}
		}
	}

	private backfillWhere(nowIso: string): { sql: string; binds: string[] } {
		const sql = `id IN (
			SELECT a.id FROM articles a
			LEFT JOIN article_image_backfill b ON b.article_id = a.id
			WHERE (
				b.article_id IS NULL
				AND a.image_key NOT LIKE '%-16x9.webp'
				AND (a.image_key != '' OR a.image_source_url != '')
			) OR (
				b.retry_after != '' AND b.retry_after <= ?
			) OR (
				IFNULL(b.retry_after, '') = ''
				AND b.reason IN ('resize_incomplete', 'resize_too_large', 'github_commit_failed', 'started', 'transient')
			) OR (
				IFNULL(b.pending, '') != '' AND IFNULL(b.retry_after, '') <= ?
			)
		)`;
		return { sql, binds: [nowIso, nowIso] };
	}

	async listForBackfill(limit: number, nowIso: string): Promise<StoredArticle[]> {
		await this.ensureBackfillTable();
		const where = this.backfillWhere(nowIso);
		try {
			return await this.rows(
				`SELECT {{columns}} FROM articles WHERE ${where.sql} ORDER BY published_at DESC LIMIT ?`,
				...where.binds,
				limit,
			);
		} catch (error) {
			if (!missingColumn(error)) throw error;
			return this.rows(
				`SELECT {{columns}} FROM articles
				 WHERE image_key != '' AND image_key NOT LIKE '%-16x9.webp'
				 ORDER BY published_at DESC LIMIT ?`,
				limit,
			);
		}
	}

	async countForBackfill(nowIso: string): Promise<number> {
		await this.ensureBackfillTable();
		const where = this.backfillWhere(nowIso);
		try {
			const row = await this.db
				.prepare(`SELECT COUNT(*) AS n FROM articles WHERE ${where.sql}`)
				.bind(...where.binds)
				.first<Record<string, unknown>>();
			return Number(asRecord(row)?.n) || 0;
		} catch (error) {
			if (!missingColumn(error)) throw error;
			const row = await this.db
				.prepare("SELECT COUNT(*) AS n FROM articles WHERE image_key != '' AND image_key NOT LIKE '%-16x9.webp'")
				.first<Record<string, unknown>>();
			return Number(asRecord(row)?.n) || 0;
		}
	}

	async readBackfill(articleId: string): Promise<{ reason: string; retryAfter: string; pending: string; attempts: number } | null> {
		await this.ensureBackfillTable();
		const row = await this.db
			.prepare("SELECT reason, retry_after, pending, attempts FROM article_image_backfill WHERE article_id = ?")
			.bind(articleId)
			.first<Record<string, unknown>>();
		const record = asRecord(row);
		if (!record) return null;
		return {
			reason: readString(record, "reason"),
			retryAfter: readString(record, "retry_after"),
			pending: readString(record, "pending"),
			attempts: Number(record.attempts) || 0,
		};
	}

	async holdBackfill(articleId: string, updatedAt: string, retryAfter: string): Promise<boolean> {
		await this.ensureBackfillTable();
		const current = await this.readBackfill(articleId);
		if (current?.retryAfter && current.retryAfter > updatedAt) return false;
		if (current && !current.retryAfter && !current.pending && (current.reason === "no_source" || current.reason === "unprocessable_source" || current.reason === "ready")) {
			return false;
		}
		await this.db
			.prepare(
				`INSERT INTO article_image_backfill (article_id, reason, updated_at, retry_after, attempts, pending)
				 VALUES (?, 'started', ?, ?, ?, ?)
				 ON CONFLICT(article_id) DO UPDATE SET
				   reason = 'started',
				   updated_at = excluded.updated_at,
				   retry_after = excluded.retry_after`,
			)
			.bind(articleId, updatedAt, retryAfter, current?.attempts ?? 0, current?.pending ?? "")
			.run();
		return true;
	}

	async deferBackfill(articleId: string, reason: string, updatedAt: string, retryAfter: string, pending: string, attempts: number): Promise<void> {
		await this.ensureBackfillTable();
		await this.db
			.prepare(
				`INSERT INTO article_image_backfill (article_id, reason, updated_at, retry_after, attempts, pending)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(article_id) DO UPDATE SET
				   reason = excluded.reason,
				   updated_at = excluded.updated_at,
				   retry_after = excluded.retry_after,
				   attempts = excluded.attempts,
				   pending = excluded.pending`,
			)
			.bind(articleId, reason, updatedAt, retryAfter, attempts, pending)
			.run();
	}

	async clearBackfill(articleId: string): Promise<void> {
		await this.ensureBackfillTable();
		await this.db.prepare("DELETE FROM article_image_backfill WHERE article_id = ?").bind(articleId).run();
	}

	async updateLeadImage(id: string, image: { imageKey: string; imageCommit: string; imageType: string; imageCredit: string; imageSourceUrl: string; updatedAt: string }): Promise<void> {
		try {
			await this.db
				.prepare(
					`UPDATE articles
					 SET image_key = ?, image_commit = ?, image_type = ?, image_credit = ?, image_source_url = ?, updated_at = ?
					 WHERE id = ?`,
				)
				.bind(image.imageKey, image.imageCommit, image.imageType, image.imageCredit, image.imageSourceUrl, image.updatedAt, id)
				.run();
		} catch (error) {
			if (!missingColumn(error)) throw error;
			await this.db
				.prepare("UPDATE articles SET image_key = ?, image_commit = ?, image_type = ?, updated_at = ? WHERE id = ?")
				.bind(image.imageKey, image.imageCommit, image.imageType, image.updatedAt, id)
				.run();
		}
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

	async claimIndexNowSubmit(nowIso: string, untilIso: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
		const name = "indexnow-submit";
		const result = await this.db
			.prepare(
				`INSERT INTO runtime_lock (name, locked_until) VALUES (?, ?)
				 ON CONFLICT(name) DO UPDATE SET locked_until = excluded.locked_until
				 WHERE runtime_lock.locked_until <= ?`,
			)
			.bind(name, untilIso, nowIso)
			.run();
		if ((result.meta?.changes ?? 0) > 0) return { allowed: true, retryAfterSeconds: 0 };
		const row = await this.db
			.prepare("SELECT locked_until FROM runtime_lock WHERE name = ?")
			.bind(name)
			.first<Record<string, unknown>>();
		const until = Date.parse(typeof row?.locked_until === "string" ? row.locked_until : "");
		const now = Date.parse(nowIso);
		const retryAfterSeconds = Number.isFinite(until) ? Math.max(1, Math.ceil((until - now) / 1000)) : 600;
		return { allowed: false, retryAfterSeconds };
	}

	async persistDaySalt(day: string, saltHex: string): Promise<string> {
		const proposed = saltHex.toLowerCase();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[0-9a-f]{64}$/.test(proposed)) return "";
		try {
			await this.db
				.prepare(`INSERT INTO stats_day_salt (day, salt) VALUES (?, ?) ON CONFLICT(day) DO NOTHING`)
				.bind(day, proposed)
				.run();
			const row = await this.db
				.prepare(`SELECT salt FROM stats_day_salt WHERE day = ?`)
				.bind(day)
				.first<Record<string, unknown>>();
			const stored = typeof row?.salt === "string" && /^[0-9a-f]{64}$/.test(row.salt) ? row.salt : proposed;
			const salt = hexToSalt(stored);
			if (salt) rememberDaySalt(day, salt);
			return stored;
		} catch (error) {
			const salt = hexToSalt(proposed);
			if (salt) rememberDaySalt(day, salt);
			if (!missingSchema(error)) throw error;
			return proposed;
		}
	}

	async countArticles(category?: Category, now = new Date()): Promise<number> {
		if (!category) {
			const row = await this.db.prepare("SELECT COUNT(*) AS n FROM articles").bind().first<Record<string, unknown>>();
			const value = Number(row?.n);
			return Number.isFinite(value) ? value : 0;
		}
		try {
			const clause = this.categoryClause(category, now);
			const row = await this.db
				.prepare(`SELECT COUNT(*) AS n FROM articles WHERE ${clause.sql}`)
				.bind(...clause.binds)
				.first<Record<string, unknown>>();
			const value = Number(row?.n);
			return Number.isFinite(value) ? value : 0;
		} catch (error) {
			if (!missingColumn(error)) throw error;
			const row = await this.db.prepare("SELECT COUNT(*) AS n FROM articles WHERE category = ?").bind(category).first<Record<string, unknown>>();
			const value = Number(row?.n);
			return Number.isFinite(value) ? value : 0;
		}
	}

	async readCounts(slugs: string[]): Promise<Map<string, number>> {
		const unique = [...new Set(slugs.filter(Boolean))].slice(0, 80);
		const out = new Map<string, number>();
		if (!unique.length) return out;
		const now = Date.now();
		const missing: string[] = [];
		for (const slug of unique) {
			const hit = readCountCache.get(slug);
			if (hit && now - hit.at < 60_000) out.set(slug, hit.views);
			else missing.push(slug);
		}
		if (!missing.length) return out;
		const marks = missing.map(() => "?").join(", ");
		try {
			const result = await this.db
				.prepare(`SELECT slug, SUM(views) AS views FROM stats_article_hour WHERE slug IN (${marks}) GROUP BY slug`)
				.bind(...missing)
				.all<Record<string, unknown>>();
			const found = new Set<string>();
			for (const row of result.results ?? []) {
				const slug = readString(row, "slug");
				const views = Number(row.views) || 0;
				if (!slug) continue;
				found.add(slug);
				readCountCache.set(slug, { at: now, views });
				out.set(slug, views);
			}
			for (const slug of missing) {
				if (found.has(slug)) continue;
				readCountCache.set(slug, { at: now, views: 0 });
				out.set(slug, 0);
			}
		} catch (error) {
			if (!missingSchema(error)) throw error;
			for (const slug of missing) out.set(slug, 0);
		}
		return out;
	}

	async countByAuthor(authorId: string): Promise<number> {
		const row = await this.db.prepare("SELECT COUNT(*) AS n FROM articles WHERE author_id = ?").bind(authorId).first<Record<string, unknown>>();
		const value = Number(row?.n);
		return Number.isFinite(value) ? value : 0;
	}

	async recordPageView(event: PageViewEvent): Promise<void> {
		const row = normalizeEvent(event);
		const day = row.viewedAt.slice(0, 10);
		const aggregated = row.eventKind === "404" || row.eventKind === "feed" || row.bot === 1;
		if (aggregated && row.eventKind === "404" && !/^\/ai-news\/article\/[a-z0-9-]{1,120}$/.test(row.page)) return;
		const allowed = await this.budgetOpen(day);
		writeNewsEvent({ AI_NEWS_EVENTS: this.statsOptions.analytics }, {
			kind: row.eventKind,
			slug: row.slug,
			host: row.referrerHost,
			country: row.country,
			device: row.deviceClass,
			botName: row.botName,
			engagedMs: row.engagedMs,
			scrollPct: row.scrollPct,
		}, !allowed);
		if (!allowed) return;
		if (aggregated) {
			if (row.eventKind === "404") queueAggregate("miss", day, row.page || "/ai-news/article");
			if (row.eventKind === "feed") queueAggregate("feed", day, row.page || "/ai-news");
			if (row.bot === 1) queueAggregate("bot", day, row.botName || "bot");
			try {
				for (const rows of await flushAggregates(this.db, true)) await this.chargeRows(rows, day);
			} catch (error) {
				if (!missingSchema(error)) throw error;
			}
			return;
		}
		try {
			if (row.eventKind === "view") await this.rollupView(row, day);
			else if (row.eventKind === "engage") await this.rollupEngage(row, day);
			else if (row.eventKind === "click" && row.clickHost) await this.rollupClick(row, day);
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
	}

	private async budgetOpen(day: string): Promise<boolean> {
		if (this.statsOptions.budget) return this.statsOptions.budget.open(day);
		try {
			const row = await this.db.prepare("SELECT writes FROM stats_write_budget WHERE day = ?").bind(day).first<{ writes?: number }>();
			const writes = Number(row?.writes ?? 0);
			return !Number.isFinite(writes) || writes < STATS_DAILY_WRITE_CAP;
		} catch (error) {
			if (!missingSchema(error)) throw error;
			return false;
		}
	}

	private async chargeRows(rows: number, day: string): Promise<void> {
		if (rows <= 0) return;
		if (this.statsOptions.budget) {
			await this.statsOptions.budget.charge(rows, day);
			return;
		}
		try {
			const result = await this.db
				.prepare(
					`INSERT INTO stats_write_budget (day, writes) VALUES (?, ?)
					 ON CONFLICT(day) DO UPDATE SET writes = writes + excluded.writes`,
				)
				.bind(day, rows)
				.run();
			const extra = rowsWrittenOf(result);
			if (extra > 0) {
				await this.db
					.prepare("UPDATE stats_write_budget SET writes = writes + ? WHERE day = ?")
					.bind(extra, day)
					.run();
			}
		} catch (error) {
			if (!missingSchema(error)) throw error;
		}
	}

	private async runCharged(day: string, sql: string, ...binds: unknown[]): Promise<{ meta?: { changes?: number; rows_written?: number } } | null> {
		if (!(await this.budgetOpen(day))) return null;
		const result = await this.db.prepare(sql).bind(...binds).run();
		await this.chargeRows(rowsWrittenOf(result), day);
		return result;
	}

	private async rollupView(event: ReturnType<typeof normalizeEvent>, day: string): Promise<void> {
		let uniques = 0;
		if (event.visitorHash) {
			const inserted = await this.runCharged(day, `INSERT OR IGNORE INTO stats_visitor_day (day, visitor_hash) VALUES (?, ?)`, day, event.visitorHash);
			if (!inserted) return;
			uniques = inserted.meta?.changes ?? 0;
		}
		const hour = await this.runCharged(
			day,
			`INSERT INTO stats_article_hour (day, hour_utc, slug, views, uniques, engaged_ms, engage_n, scroll_sum)
			 VALUES (?, ?, ?, 1, ?, 0, 0, 0)
			 ON CONFLICT(day, hour_utc, slug) DO UPDATE SET
			 views = views + 1,
			 uniques = uniques + excluded.uniques`,
			day,
			event.hourUtc,
			event.slug || event.page || "article",
			uniques,
		);
		if (!hour) return;
		await this.rollupFacets(event, day);
	}

	/** One counter row per dimension. No IP, user agent, cookie, or visitor hash. */
	private async rollupFacets(event: ReturnType<typeof normalizeEvent>, day: string): Promise<void> {
		const slug = event.slug || event.page || "article";
		for (const [facet, value] of facetPairs(event, slug)) {
			try {
				const wrote = await this.runCharged(
					day,
					`INSERT INTO stats_facet_daily (day, slug, facet, value, hits) VALUES (?, ?, ?, ?, 1)
					 ON CONFLICT(day, slug, facet, value) DO UPDATE SET hits = hits + 1`,
					day,
					slug,
					facet,
					value,
				);
				if (!wrote) return;
			} catch (error) {
				if (!missingSchema(error)) throw error;
				return;
			}
		}
	}

	private async rollupEngage(event: ReturnType<typeof normalizeEvent>, day: string): Promise<void> {
		await this.runCharged(
			day,
			`INSERT INTO stats_article_hour (day, hour_utc, slug, views, uniques, engaged_ms, engage_n, scroll_sum)
			 VALUES (?, ?, ?, 0, 0, ?, 1, ?)
			 ON CONFLICT(day, hour_utc, slug) DO UPDATE SET
			 engaged_ms = engaged_ms + excluded.engaged_ms,
			 engage_n = engage_n + 1,
			 scroll_sum = scroll_sum + excluded.scroll_sum`,
			day,
			event.hourUtc,
			event.slug || "article",
			event.engagedMs,
			event.scrollPct,
		);
	}

	private async rollupClick(event: ReturnType<typeof normalizeEvent>, day: string): Promise<void> {
		await this.runCharged(
			day,
			`INSERT INTO stats_click_daily (day, slug, kind, host, path, hits) VALUES (?, ?, ?, ?, ?, 1)
			 ON CONFLICT(day, slug, kind, host, path) DO UPDATE SET hits = hits + 1`,
			day,
			event.slug || "article",
			event.clickKind,
			event.clickHost,
			event.clickPath || "/",
		);
	}

	async pruneStatsRetention(now: Date): Promise<void> {
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
		const cutoff = rawRetentionCutoff(now);
		const today = now.toISOString().slice(0, 10);
		const keepDaily = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const statements = [
			[`DELETE FROM page_views WHERE id IN (SELECT id FROM page_views WHERE viewed_at < ? LIMIT 200)`, cutoff],
			[`DELETE FROM stats_visitor_day WHERE day < ?`, cutoff.slice(0, 10)],
			[`DELETE FROM stats_day_salt WHERE day < ?`, today],
			[`DELETE FROM stats_article_hour WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_bot_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_miss_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_feed_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_click_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_facet_daily WHERE day < ?`, keepDaily],
			[`DELETE FROM stats_write_budget WHERE day < ?`, keepDaily],
		] as const;
		for (const [sql, bind] of statements) {
			try {
				const freesStorage = sql.startsWith("DELETE FROM stats_visitor_day") || sql.startsWith("DELETE FROM stats_day_salt");
				if (!freesStorage && !(await this.budgetOpen(today))) continue;
				const result = await this.db.prepare(sql).bind(bind).run();
				await this.chargeRows(rowsWrittenOf(result), today);
			} catch (error) {
				if (!missingSchema(error)) throw error;
			}
		}
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
		return loadD1StatsReport(this.db, now, query);
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

function referrerGroup(source: PageViewEvent["sourceClass"]): string {
	if (source === "search" || source === "social") return source;
	if (source === "other") return "other sites";
	return "direct";
}

function facetValue(value: string): string {
	// Tab is the field separator. Component text is already clipped without control characters.
	return value.replace(/[\u0000-\u0008\u000a-\u001f\u007f]/g, "").trim().slice(0, 400);
}

/** Counters for one human view. A view is one session because raw timestamps are not stored. */
function facetPairs(event: ReturnType<typeof normalizeEvent>, slug: string): Array<[string, string]> {
	const pairs: Array<[string, string]> = [];
	const add = (facet: string, value: string) => {
		const cleaned = facetValue(value);
		if (!cleaned) return;
		pairs.push([facet, cleaned]);
	};
	add("country", event.country);
	add("city", event.city);
	add("region", event.region);
	add("continent", event.continent ? continentLabel(event.continent) : "");
	if (event.referrerHost) add("referrer", `${event.referrerHost}\t${event.referrerPath || "/"}`);
	add("referrer_group", referrerGroup(event.sourceClass));
	add("source", event.sourceClass);
	if (event.searchQuery) add("query", `${event.searchEngine}\t${event.searchQuery}`);
	if (event.utmTerm && event.utmTerm !== event.searchQuery) add("query", `utm\t${event.utmTerm}`);
	add("device", event.deviceClass);
	add("browser", event.browser);
	add("os", event.os);
	if (event.screen) add("screen", event.screen);
	if (event.lang) add("language", event.lang);
	if (event.utmSource || event.utmMedium || event.utmCampaign || event.utmTerm) {
		add("campaign", [event.utmSource, event.utmMedium, event.utmCampaign, event.utmTerm].join("\t"));
	}
	const page = event.page === "article" && slug ? `/ai-news/article/${slug}` : (event.page || slug);
	add("landing", page);
	add("exit", page);
	add("audience", "session");
	if (event.returning === 0) add("audience", "new");
	if (event.returning === 1) add("audience", "returning");
	return pairs;
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

	private reads = new Map<string, number>();

	async listRecent(limit: number, category?: Category, offset = 0, now = new Date()): Promise<StoredArticle[]> {
		const start = Math.max(0, offset);
		return this.articles
			.filter((article) => !category || visibleCategory(article, now.getTime()) === category)
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(start, start + limit);
	}

	async readCounts(slugs: string[]): Promise<Map<string, number>> {
		const out = new Map<string, number>();
		for (const slug of slugs) out.set(slug, this.reads.get(slug) ?? 0);
		return out;
	}

	async listByAuthor(authorId: string, limit: number, offset = 0): Promise<StoredArticle[]> {
		const start = Math.max(0, offset);
		return this.articles
			.filter((article) => article.authorId === authorId)
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(start, start + limit);
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

	async listSitemap(limit: number, offset = 0): Promise<SitemapEntry[]> {
		return this.articles
			.slice()
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(offset, offset + limit)
			.map((article) => ({
				slug: article.slug,
				title: article.title,
				publishedAt: article.publishedAt,
				updatedAt: article.updatedAt,
			}));
	}

	async countArticles(category?: Category, now = new Date()): Promise<number> {
		return this.articles.filter((article) => !category || visibleCategory(article, now.getTime()) === category).length;
	}

	async countByAuthor(authorId: string): Promise<number> {
		return this.articles.filter((article) => article.authorId === authorId).length;
	}

	async persistDaySalt(day: string, saltHex: string): Promise<string> {
		const salt = hexToSalt(saltHex);
		if (!salt) return "";
		rememberDaySalt(day, salt);
		return saltToHex(salt);
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

	async variantPending(ids: string[]): Promise<Map<string, string>> {
		const out = new Map<string, string>();
		for (const id of ids) {
			const job = this.backfillJobs.get(id);
			if (!job) continue;
			out.set(id, job.reason === "ready" && !job.pending ? "" : job.pending);
		}
		return out;
	}

	async findImage(imageKey: string, imageCommit: string): Promise<{ contentType: string } | null> {
		const direct = this.articles.find((entry) => entry.imageKey === imageKey && entry.imageCommit === imageCommit);
		if (direct?.imageType) return { contentType: direct.imageType };
		const canonical = canonicalLeadKey(imageKey);
		if (!canonical || canonical === imageKey) return null;
		const primary = this.articles.find((entry) => entry.imageKey === canonical && entry.imageCommit === imageCommit);
		return primary?.imageType ? { contentType: "image/webp" } : null;
	}

	backfillJobs = new Map<string, { reason: string; retryAfter: string; pending: string; attempts: number }>();

	private eligibleForBackfill(article: StoredArticle, nowIso: string): boolean {
		const job = this.backfillJobs.get(article.id);
		if (job?.retryAfter && job.retryAfter > nowIso) return false;
		if (job && !job.retryAfter && !job.pending && (job.reason === "no_source" || job.reason === "unprocessable_source" || job.reason === "ready")) return false;
		if (job?.retryAfter && job.retryAfter <= nowIso) return true;
		if (job && !job.retryAfter && ["resize_incomplete", "resize_too_large", "github_commit_failed", "started", "transient"].includes(job.reason)) {
			return true;
		}
		if (job?.pending && (!job.retryAfter || job.retryAfter <= nowIso)) return true;
		if (job) return false;
		return !article.imageKey.endsWith("-16x9.webp") && Boolean(article.imageKey || article.imageSourceUrl);
	}

	async listForBackfill(limit: number, nowIso: string): Promise<StoredArticle[]> {
		return this.articles
			.filter((article) => this.eligibleForBackfill(article, nowIso))
			.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
			.slice(0, limit);
	}

	async countForBackfill(nowIso: string): Promise<number> {
		return this.articles.filter((article) => this.eligibleForBackfill(article, nowIso)).length;
	}

	async readBackfill(articleId: string): Promise<{ reason: string; retryAfter: string; pending: string; attempts: number } | null> {
		return this.backfillJobs.get(articleId) ?? null;
	}

	async holdBackfill(articleId: string, updatedAt: string, retryAfter: string): Promise<boolean> {
		const current = this.backfillJobs.get(articleId);
		if (current?.retryAfter && current.retryAfter > updatedAt) return false;
		if (current && !current.retryAfter && !current.pending && (current.reason === "no_source" || current.reason === "unprocessable_source" || current.reason === "ready")) {
			return false;
		}
		this.backfillJobs.set(articleId, {
			reason: "started",
			retryAfter,
			pending: current?.pending ?? "",
			attempts: current?.attempts ?? 0,
		});
		void updatedAt;
		return true;
	}

	async deferBackfill(articleId: string, reason: string, updatedAt: string, retryAfter: string, pending: string, attempts: number): Promise<void> {
		void updatedAt;
		this.backfillJobs.set(articleId, { reason, retryAfter, pending, attempts });
	}

	async clearBackfill(articleId: string): Promise<void> {
		this.backfillJobs.delete(articleId);
	}

	async updateLeadImage(id: string, image: { imageKey: string; imageCommit: string; imageType: string; imageCredit: string; imageSourceUrl: string; updatedAt: string }): Promise<void> {
		const article = this.articles.find((entry) => entry.id === id);
		if (!article) return;
		article.imageKey = image.imageKey;
		article.imageCommit = image.imageCommit;
		article.imageType = image.imageType;
		article.imageCredit = image.imageCredit;
		article.imageSourceUrl = image.imageSourceUrl;
		article.updatedAt = image.updatedAt;
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
	private indexNowUntil = 0;

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

	async claimIndexNowSubmit(nowIso: string, untilIso: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
		const now = Date.parse(nowIso);
		const until = Date.parse(untilIso);
		if (!Number.isFinite(now) || !Number.isFinite(until)) return { allowed: false, retryAfterSeconds: 600 };
		if (this.indexNowUntil > now) {
			return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((this.indexNowUntil - now) / 1000)) };
		}
		this.indexNowUntil = until;
		return { allowed: true, retryAfterSeconds: 0 };
	}

	async recordPageView(event: PageViewEvent): Promise<void> {
		this.pageViews.push(event);
		if (event.bot === 0 && event.slug && event.eventKind !== "404" && event.eventKind !== "feed") {
			this.reads.set(event.slug, (this.reads.get(event.slug) ?? 0) + 1);
		}
	}

	async pageViewReport(now: Date, query?: StatsQuery): Promise<NewsStatsReport> {
		return summarizePageViews(this.pageViews, now, catalogFromArticles(this.articles), query);
	}
}
