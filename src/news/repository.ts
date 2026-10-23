import type { Category, DeskStats, StoredArticle, StoredRelated, StoredSource } from "./types";
import { isCategory } from "./text";

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
}

export interface ImageStore {
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
	delete(key: string): Promise<void>;
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
		imageAlt: readString(row, "image_alt"),
		imageType: readString(row, "image_type"),
		publishedAt: readString(row, "published_at"),
		updatedAt: readString(row, "updated_at"),
	};
}

const ARTICLE_COLUMNS = `id, slug, title, description, category, tags_json, author_id, body_html, body_text,
	key_points_json, faq_json, sources_json, related_json, image_key, image_alt, image_type, published_at, updated_at`;

export class D1NewsRepository implements NewsRepository {
	constructor(private readonly db: D1Database) {}

	private async rows(sql: string, ...bindings: unknown[]): Promise<StoredArticle[]> {
		const result = await this.db.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
		return (result.results ?? []).map((row) => articleFromRow(row)).filter((article): article is StoredArticle => Boolean(article));
	}

	async listRecent(limit: number, category?: Category): Promise<StoredArticle[]> {
		if (category) {
			return this.rows(
				`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT ?`,
				category,
				limit,
			);
		}
		return this.rows(`SELECT ${ARTICLE_COLUMNS} FROM articles ORDER BY published_at DESC LIMIT ?`, limit);
	}

	async listByAuthor(authorId: string, limit: number): Promise<StoredArticle[]> {
		return this.rows(
			`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE author_id = ? ORDER BY published_at DESC LIMIT ?`,
			authorId,
			limit,
		);
	}

	async getBySlug(slug: string): Promise<StoredArticle | null> {
		const row = await this.db.prepare(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE slug = ?`).bind(slug).first<Record<string, unknown>>();
		const record = asRecord(row);
		return record ? articleFromRow(record) : null;
	}

	async getById(id: string): Promise<StoredArticle | null> {
		const row = await this.db.prepare(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE id = ?`).bind(id).first<Record<string, unknown>>();
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

	async insert(article: StoredArticle): Promise<void> {
		const statements = [
			this.db
				.prepare(
					`INSERT INTO articles (
						id, slug, title, description, category, tags_json, author_id, body_html, body_text,
						key_points_json, faq_json, sources_json, related_json, image_key, image_alt, image_type,
						published_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
					article.imageAlt,
					article.imageType,
					article.publishedAt,
					article.updatedAt,
				),
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
		await this.db.batch(statements);
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
}

export class MemoryNewsRepository implements NewsRepository {
	articles: StoredArticle[] = [];
	private lockUntil = 0;

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
}

export class MemoryImageStore implements ImageStore {
	readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

	async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
		this.objects.set(key, { bytes, contentType });
	}

	async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
		return this.objects.get(key) ?? null;
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}

export class R2ImageStore implements ImageStore {
	constructor(private readonly bucket: R2Bucket) {}

	async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
		await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
	}

	async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
		const object = await this.bucket.get(key);
		if (!object) return null;
		const bytes = new Uint8Array(await object.arrayBuffer());
		return { bytes, contentType: object.httpMetadata?.contentType ?? "application/octet-stream" };
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}
}
