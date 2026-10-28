import { authorById, personaBriefs } from "./authors";
import { backfillLeads, backfillLimit } from "./backfill";
import {
	CATEGORY_LABEL,
	COPY_WINDOW,
	INGEST_IMAGE_MAX_BYTES,
	INGEST_REQUESTS_PER_HOUR,
	MAX_WORDS,
	MIN_WORDS,
	SIMILARITY_LIMIT,
	hourStartIso,
	siteOrigin,
	type NewsEnv,
} from "./config";
import { readBodyCapped, sameSiteHost } from "./feeds";
import { GITHUB_IMAGE_MAX_BYTES, commitImageFile, deleteImageFile, githubImagePath } from "./github-images";
import { filesForStoredImage, imageCandidates } from "./lead";
import { isBlockedHost, publicHttpsUrl } from "./net";
import { indexNowPublishUrls, pingIndexNow } from "./indexnow";
import { bearerToken, tokensMatch } from "./tokens";
import { SLOP_PATTERNS, assessDraft } from "./quality";
import type { NewsRepository } from "./repository";
import type { ArticleDraft, Category, FaqItem, SourceRef, StoredArticle } from "./types";
import { isDurableCategory } from "./sections";
import { CATEGORIES } from "./types";
import {
	decodeEntities,
	detectImageType,
	isCategory,
	normalizeSourceUrl,
	sentenceCaseHeadline,
	slugify,
	stripHtml,
	tokenJaccard,
	wordCount,
	words,
} from "./text";

export { bearerToken, tokensMatch };

const MAX_BODY_BYTES = 2_600_000;
const MAX_SOURCE_BYTES = 200_000;
const MAX_SOURCES = 4;
const RECENT_SOURCE_LIMIT = 40;
const USER_AGENT = "3aik-news/1.0 (+https://3aik.com/ai-news/about)";

export interface IngestDeps {
	repo: NewsRepository | null;
	fetchImpl?: typeof fetch;
	now?: Date;
}

export function ingestApiPath(pathname: string): "post" | "meta" | "backfill" | null {
	const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	if (path === "/ai-news/api/ingest") return "post";
	if (path === "/ai-news/api/ingest/meta") return "meta";
	if (path === "/ai-news/api/ingest/backfill") return "backfill";
	return null;
}

function json(body: unknown, status: number, extra?: HeadersInit): Response {
	const headers = new Headers(extra);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("cache-control", "no-store");
	headers.set("x-content-type-options", "nosniff");
	return new Response(JSON.stringify(body), { status, headers });
}

function reasons(list: string[], status = 422): Response {
	return json({ reasons: [...new Set(list)] }, status);
}

function methodNotAllowed(allowed: string[]): Response {
	return json({ error: "method_not_allowed" }, 405, { allow: allowed.join(", ") });
}

function secondsUntilNextHour(now: Date): number {
	const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + 1);
	return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string") return value.trim();
	}
	return "";
}

function categoryOf(raw: string): Category | null {
	const value = raw.trim().toLowerCase();
	if (value === "tech") return "technology";
	if ((CATEGORIES as readonly string[]).includes(value)) return value as Category;
	return null;
}

function paragraphsFromMarkdown(markdown: string): string[] {
	return markdown
		.replace(/\r\n/g, "\n")
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.replace(/[ \t]*\n[ \t]*/g, " ").replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}

function paragraphsFromHtml(html: string): string[] {
	const marked = html
		.replace(/\r\n/g, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|h1|h2|h3|h4|li|div|blockquote|section)>/gi, "\n\n");
	const decoded = decodeEntities(marked.replace(/<[^>]+>/g, " "));
	return decoded
		.split(/\n\s*\n|\n/)
		.map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
		.filter(Boolean);
}

function stringList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	if (!value.every((item) => typeof item === "string")) return null;
	return value.map((item) => item.trim()).filter(Boolean);
}

function faqOf(value: unknown): FaqItem[] | null {
	if (!Array.isArray(value)) return null;
	const items: FaqItem[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || typeof entry.question !== "string" || typeof entry.answer !== "string") return null;
		items.push({ question: entry.question.trim(), answer: entry.answer.trim() });
	}
	return items;
}

function publicSourceUrl(raw: string): string | null {
	let normalized: string;
	try {
		normalized = normalizeSourceUrl(raw);
	} catch {
		return null;
	}
	return publicHttpsUrl(normalized);
}

function decodeBase64(input: string): Uint8Array | null {
	const trimmed = input.trim().replace(/^data:[^,]+,/i, "").replace(/\s+/g, "");
	if (!trimmed || trimmed.length > 2_300_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
	try {
		const binary = atob(trimmed);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
		return bytes;
	} catch {
		return null;
	}
}

interface ParsedImage {
	bytes: Uint8Array;
	alt: string;
}

interface ParsedSource {
	url: string;
	publisher: string;
	title: string;
	excerpt: string;
}

interface ParsedSourceImage {
	url: string;
	credit: string;
}

interface ParsedIngest {
	reasons: string[];
	draft: ArticleDraft | null;
	sources: ParsedSource[];
	image: ParsedImage | null;
	sourceImage: ParsedSourceImage | null;
	category: Category | null;
	section: string;
	authorId: string | null;
}

const SOURCE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function validCredit(raw: string): boolean {
	if (raw.length > 80) return false;
	if (/[<>]/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return false;
	return true;
}

function creditLine(raw: string, publisher: string): string {
	const clean = raw.replace(/\s+/g, " ").trim();
	const fallback = publisher ? `Image: ${publisher}` : "Image: Source";
	if (!clean) return fallback.slice(0, 80);
	const rest = clean.replace(/^image\s*:\s*/i, "").trim();
	return (rest ? `Image: ${rest}` : fallback).slice(0, 80);
}

function readSourceImage(record: Record<string, unknown>, publisher: string): { reasons: string[]; sourceImage: ParsedSourceImage | null } {
	const hasField = "image_source_url" in record || "imageSourceUrl" in record;
	const rawUrl = readString(record, "image_source_url", "imageSourceUrl");
	const rawCredit = readString(record, "image_credit", "imageCredit");
	if (!hasField) return { reasons: [], sourceImage: null };
	if (!rawUrl) return { reasons: ["image_source_url"], sourceImage: null };
	const url = publicHttpsUrl(rawUrl);
	if (!url) return { reasons: ["image_source_url"], sourceImage: null };
	if (rawCredit && !validCredit(rawCredit)) return { reasons: ["image_credit"], sourceImage: null };
	return { reasons: [], sourceImage: { url, credit: creditLine(rawCredit, publisher) } };
}

function readImage(record: Record<string, unknown>): { reasons: string[]; image: ParsedImage | null } {
	if (!("image" in record) || record.image == null) return { reasons: [], image: null };
	const image = record.image;
	let data = "";
	let alt = readString(record, "image_alt", "imageAlt");
	if (typeof image === "string") {
		data = image.trim();
	} else if (isRecord(image)) {
		data = readString(image, "data", "base64");
		alt = readString(image, "alt") || alt;
	} else {
		return { reasons: ["image_encoding"], image: null };
	}
	if (!data) return { reasons: ["image_encoding"], image: null };
	if (data.replace(/^data:[^,]+,/i, "").replace(/\s+/g, "").length > 2_300_000) return { reasons: ["image_bytes"], image: null };
	const bytes = decodeBase64(data);
	if (!bytes) return { reasons: ["image_encoding"], image: null };
	if (bytes.byteLength > INGEST_IMAGE_MAX_BYTES) return { reasons: ["image_bytes"], image: null };
	const detected = detectImageType(bytes);
	if (!detected || (detected.mime !== "image/jpeg" && detected.mime !== "image/png" && detected.mime !== "image/webp")) {
		return { reasons: ["image_type"], image: null };
	}
	return { reasons: [], image: { bytes, alt } };
}

function parseIngest(value: unknown): ParsedIngest {
	const problems: string[] = [];
	if (!isRecord(value)) return { reasons: ["invalid_json"], draft: null, sources: [], image: null, sourceImage: null, category: null, section: "", authorId: null };
	const title = readString(value, "title");
	const description = readString(value, "dek", "summary", "description");
	const category = categoryOf(readString(value, "category"));
	const sectionRaw = categoryOf(readString(value, "section", "subcategory"));
	const section = sectionRaw && isDurableCategory(sectionRaw) ? sectionRaw : "";
	const authorId = readString(value, "author_slug", "authorSlug");
	if (!title) problems.push("title");
	if (!description) problems.push("dek");
	if (!category) problems.push("category");
	if (category === "breaking" && !section) problems.push("section");
	const author = authorId ? authorById(authorId) : null;
	const authorDesk = category === "breaking" ? section : category;
	if (!author) problems.push("author_slug");
	else if (authorDesk && author.category !== authorDesk) problems.push("author_category");

	const markdown = readString(value, "body_markdown", "bodyMarkdown");
	const html = readString(value, "body_html", "html", "bodyHtml");
	const paragraphs = markdown ? paragraphsFromMarkdown(markdown) : html ? paragraphsFromHtml(html) : [];
	if (!paragraphs.length) problems.push("body");
	if ((markdown || html).length > 60_000) problems.push("body_too_large");

	const tags = stringList(value.tags ?? value.tag);
	if (value.tags != null && tags === null) problems.push("tags");
	const keyPoints = stringList(value.key_points ?? value.keyPoints);
	if ((value.key_points != null || value.keyPoints != null) && keyPoints === null) problems.push("key_points");
	const faq = faqOf(value.faq ?? []);
	if (value.faq != null && faq === null) problems.push("faq");

	const sources: ParsedSource[] = [];
	if (!Array.isArray(value.sources)) problems.push("sources");
	else {
		if (value.sources.length < 1) problems.push(category === "showbiz" ? "showbiz_source" : "sources");
		if (value.sources.length > MAX_SOURCES) problems.push("sources");
		const seen = new Set<string>();
		for (const entry of value.sources) {
			if (!isRecord(entry)) {
				problems.push("source_shape");
				continue;
			}
			const url = publicSourceUrl(readString(entry, "url"));
			const publisher = readString(entry, "publisher", "outlet");
			const sourceTitle = readString(entry, "title");
			if (!url) problems.push("source_url");
			if (!publisher) problems.push("source_publisher");
			if (!sourceTitle) problems.push("source_title");
			if (!url || !publisher || !sourceTitle) continue;
			if (seen.has(url)) problems.push("duplicate_source");
			seen.add(url);
			sources.push({
				url,
				publisher: publisher.slice(0, 80),
				title: sourceTitle.slice(0, 300),
				excerpt: readString(entry, "excerpt").slice(0, 8_000),
			});
		}
	}

	const sourceImage = readSourceImage(value, sources[0]?.publisher ?? "");
	problems.push(...sourceImage.reasons);
	const image = sourceImage.sourceImage ? { reasons: [] as string[], image: null } : readImage(value);
	problems.push(...image.reasons);
	const alt = readString(value, "image_alt", "imageAlt") || image.image?.alt || "";

	const draft: ArticleDraft = {
		title,
		description,
		tags: (tags ?? []).map((tag) => tag.toLowerCase()),
		keyPoints: keyPoints ?? [],
		faq: faq ?? [],
		paragraphs,
		imageAlt: sourceImage.sourceImage ? alt : (image.image?.alt ?? ""),
		imagePrompt: "",
	};
	return {
		reasons: [...new Set(problems)],
		draft: problems.length ? null : draft,
		sources,
		image: image.image,
		sourceImage: sourceImage.sourceImage,
		category,
		section: category === "breaking" ? section : "",
		authorId: author?.id ?? null,
	};
}

async function fetchSourceText(url: string, fetchImpl: typeof fetch): Promise<{ text: string; html: string }> {
	let current = url;
	const originalHost = new URL(url).hostname;
	for (let hop = 0; hop < 3; hop += 1) {
		let response: Response;
		try {
			response = await fetchImpl(current, {
				redirect: "manual",
				headers: { accept: "text/html, text/plain;q=0.5", "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(8_000),
			});
		} catch {
			return { text: "", html: "" };
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			await response.body?.cancel();
			if (!location) return { text: "", html: "" };
			let next: URL;
			try {
				next = new URL(location, current);
			} catch {
				return { text: "", html: "" };
			}
			if (next.protocol !== "https:" || !sameSiteHost(next.hostname, originalHost) || isBlockedHost(next.hostname)) return { text: "", html: "" };
			current = next.toString();
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			return { text: "", html: "" };
		}
		const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
		if (type && type !== "text/html" && type !== "text/plain" && type !== "application/xhtml+xml") {
			await response.body?.cancel();
			return { text: "", html: "" };
		}
		const body = await readBodyCapped(response, MAX_SOURCE_BYTES);
		if (!body) return { text: "", html: "" };
		return { text: stripHtml(body).slice(0, 8_000), html: body };
	}
	return { text: "", html: "" };
}

function mediaType(header: string | null): string {
	return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

async function readBytesCapped(response: Response, limit: number): Promise<Uint8Array | null> {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} catch {
		await reader.cancel().catch(() => undefined);
		return null;
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

interface FetchedImage {
	bytes: Uint8Array;
	mime: string;
	finalUrl: string;
	/** The publisher file is larger than GitHub will store. Keep the URL for a later resize. */
	overflow?: boolean;
}

/** Fetch a publisher image. Redirects stay on public https. A failed fetch returns null. */
async function fetchPublisherImage(url: string, fetchImpl: typeof fetch): Promise<FetchedImage | null> {
	let current = url;
	for (let hop = 0; hop < 3; hop += 1) {
		let response: Response;
		try {
			response = await fetchImpl(current, {
				redirect: "manual",
				headers: { accept: "image/jpeg, image/png, image/webp, image/*;q=0.8", "user-agent": USER_AGENT },
				signal: AbortSignal.timeout(8_000),
			});
		} catch {
			return null;
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			await response.body?.cancel().catch(() => undefined);
			if (!location) return null;
			let next: URL;
			try {
				next = new URL(location, current);
			} catch {
				return null;
			}
			next.hash = "";
			if (next.protocol !== "https:" || next.username || next.password || isBlockedHost(next.hostname)) return null;
			current = next.toString();
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			return null;
		}
		const declared = Number(response.headers.get("content-length") ?? "");
		if (Number.isFinite(declared) && declared > GITHUB_IMAGE_MAX_BYTES) {
			await response.body?.cancel().catch(() => undefined);
			return { bytes: new Uint8Array(), mime: "", finalUrl: current, overflow: true };
		}
		const type = mediaType(response.headers.get("content-type"));
		if (!SOURCE_IMAGE_TYPES.has(type)) {
			await response.body?.cancel().catch(() => undefined);
			return null;
		}
		const bytes = await readBytesCapped(response, GITHUB_IMAGE_MAX_BYTES);
		if (!bytes) return { bytes: new Uint8Array(), mime: "", finalUrl: current, overflow: true };
		const detected = detectImageType(bytes);
		const normalized = type === "image/jpg" ? "image/jpeg" : type;
		if (!detected || detected.mime !== normalized) return null;
		return { bytes, mime: detected.mime, finalUrl: current };
	}
	return null;
}

async function sourceRefs(sources: ParsedSource[], fetchImpl: typeof fetch): Promise<{ refs: SourceRef[]; reasons: string[]; html: string }> {
	const reasons: string[] = [];
	const refs: SourceRef[] = [];
	let html = "";
	for (const source of sources) {
		const fetched = await fetchSourceText(source.url, fetchImpl);
		if (!html && fetched.html) html = fetched.html;
		const excerpt = [source.excerpt, fetched.text].filter(Boolean).join("\n");
		if (words(excerpt).length < COPY_WINDOW && words(source.title).length < COPY_WINDOW) {
			reasons.push(`source_unread:${new URL(source.url).host}`);
		}
		refs.push({ url: source.url, title: source.title, outlet: source.publisher, excerpt });
	}
	return { refs, reasons, html };
}

async function storeOriginalLead(
	env: NewsEnv,
	bytes: Uint8Array,
	slug: string,
	suffix: string,
	publishedAt: string,
	fetchImpl: typeof fetch,
) {
	const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	const detected = detectImageType(bytes);
	const extension = detected?.extension === "jpg" || detected?.extension === "png" || detected?.extension === "webp" ? detected.extension : null;
	if (!token || !extension || bytes.byteLength > GITHUB_IMAGE_MAX_BYTES) {
		return { imageKey: "", imageCommit: "", imageType: "", pause: false };
	}
	const path = githubImagePath(publishedAt, slug, extension, suffix);
	if (!path) return { imageKey: "", imageCommit: "", imageType: "", pause: false };
	const wrote = await commitImageFile(token, path, bytes, fetchImpl);
	if (!wrote.ok || !wrote.commitSha) {
		console.log(JSON.stringify({ message: "ai-news ingest image skipped", reason: wrote.pause ? "github_pause" : "github" }));
		return { imageKey: "", imageCommit: "", imageType: "", pause: wrote.pause };
	}
	return { imageKey: path, imageCommit: wrote.commitSha, imageType: detected?.mime ?? "application/octet-stream", pause: wrote.pause };
}

function qualityRules() {
	return {
		min_words: MIN_WORDS,
		max_words: MAX_WORDS,
		min_sentences: 8,
		short_sentence_max_words: 12,
		long_sentence_min_words: 25,
		paragraphs: { min: 5, max: 10 },
		title_chars: { min: 20, max: 110 },
		description_chars: { min: 90, max: 170 },
		key_points: { min: 3, max: 5, min_words: 8, max_words: 40 },
		faq: { count: 3, answer_min_words: 20, answer_max_words: 90 },
		tags: { min: 2, max: 4 },
		copy_window_words: COPY_WINDOW,
		slop: SLOP_PATTERNS.map((entry) => entry.id),
		dashes: "No em dash, no en dash used as a clause break, and no --- or spaced double hyphen.",
		attribution: "Fashion and showbiz copy must attribute claims. A dispute needs the outlet name or a reporting verb in the same sentence.",
		sources: "At least one https source is required. Showbiz requires one. Name the publisher in the body. An 8-word copy of the source title or text is rejected.",
		image: {
			optional: true,
			accepted: ["image/jpeg", "image/png", "image/webp"],
			max_bytes: INGEST_IMAGE_MAX_BYTES,
			alt_words: { min: 8, max: 32 },
			stored: ["image/jpeg", "image/png", "image/webp"],
			stored_max_bytes: GITHUB_IMAGE_MAX_BYTES,
			note: "Send image.data as base64 or a data URL. The post stores that file as-is when it fits in 1 MB. WebP crops are queued and are not made inside this request.",
			source_url: {
				field: "image_source_url",
				credit: "image_credit",
				max_bytes: GITHUB_IMAGE_MAX_BYTES,
				min_width: 0,
				accepted: ["image/jpeg", "image/png", "image/webp"],
				note: "https URL of the publisher image. A file larger than 1 MB is not downloaded. The URL is kept and a later resize stores the crops. Private hosts are rejected.",
			},
		},
	};
}

async function metaResponse(request: Request, env: NewsEnv, repo: NewsRepository | null): Promise<Response> {
	let recent: string[] = [];
	if (repo) {
		try {
			recent = await repo.listRecentSourceUrls(RECENT_SOURCE_LIMIT);
		} catch (error) {
			console.error(JSON.stringify({
				message: "ai-news ingest meta failed",
				error: error instanceof Error ? error.message : String(error),
			}));
			recent = [];
		}
	}
	const body = {
		personas: personaBriefs(),
		categories: CATEGORIES.map((id) => ({
			id,
			label: CATEGORY_LABEL[id],
			aliases: id === "technology" ? ["tech"] : [],
		})),
		quality: qualityRules(),
		limits: {
			requests_per_hour: INGEST_REQUESTS_PER_HOUR,
			sources_min: 1,
			sources_max: MAX_SOURCES,
			showbiz_sources_min: 1,
			image_max_bytes: INGEST_IMAGE_MAX_BYTES,
		},
		recent_source_urls: recent,
	};
	const headers = new Headers();
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("cache-control", "no-store");
	headers.set("x-content-type-options", "nosniff");
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(JSON.stringify(body), { status: 200, headers });
}

async function postArticle(request: Request, env: NewsEnv, deps: IngestDeps, now: Date): Promise<Response> {
	const repo = deps.repo;
	if (!repo) return json({ error: "unavailable" }, 503);
	let allowed = false;
	try {
		allowed = await repo.consumeIngest(hourStartIso(now), INGEST_REQUESTS_PER_HOUR);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news ingest limit failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		await request.body?.cancel();
		return json({ error: "unavailable" }, 503);
	}
	if (!allowed) {
		await request.body?.cancel();
		const retry = secondsUntilNextHour(now);
		return json({ error: "rate_limited", retry_after: retry }, 429, { "retry-after": String(retry) });
	}

	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		await request.body?.cancel();
		return reasons(["content_type"]);
	}
	const declared = Number(request.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
		await request.body?.cancel();
		return reasons(["body_too_large"]);
	}
	const raw = await readBodyCapped(new Response(request.body), MAX_BODY_BYTES);
	if (raw == null) return reasons(["body_too_large"]);
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return reasons(["invalid_json"]);
	}

	const parsed = parseIngest(payload);
	if (parsed.reasons.length || !parsed.draft || !parsed.category || !parsed.authorId) return reasons(parsed.reasons);

	const fetchImpl = deps.fetchImpl ?? fetch;
	const loaded = await sourceRefs(parsed.sources, fetchImpl);
	if (loaded.reasons.length) return reasons(loaded.reasons);

	const author = authorById(parsed.authorId);
	if (!author) return reasons(["author_slug"]);
	const origin = siteOrigin(env, request);
	let draft = parsed.draft;
	const titled = sentenceCaseHeadline(draft.title);
	const slug = slugify(titled);
	const conflicts: Array<{ field: "slug" | "source_url"; value: string }> = [];
	if (await repo.hasSlug(slug)) conflicts.push({ field: "slug", value: slug });
	for (const source of loaded.refs) {
		if (await repo.hasSource(source.url)) conflicts.push({ field: "source_url", value: source.url });
	}
	if (conflicts.length) return json({ error: "duplicate", conflicts }, 409);
	const deskCategory = parsed.category === "breaking" && isCategory(parsed.section) ? parsed.section : parsed.category;
	const recentArticles = await repo.listRecent(30, deskCategory ?? undefined);
	const related = recentArticles
		.map((article) => ({ article, score: tokenJaccard(draft.title, article.title) }))
		.sort((left, right) => right.score - left.score || right.article.publishedAt.localeCompare(left.article.publishedAt))
		.slice(0, 2);
	const first = related[0];
	const relatedHref = first ? `${origin}/ai-news/article/${first.article.slug}` : "";
	if (first && !draft.paragraphs.join("\n").includes(relatedHref)) {
		const line = author.relatedLine(first.article.title, relatedHref);
		draft = draft.paragraphs.length >= 10
			? { ...draft, paragraphs: [...draft.paragraphs.slice(0, -1), `${draft.paragraphs.at(-1)} ${line}`] }
			: { ...draft, paragraphs: [...draft.paragraphs, line] };
	}

	const corpus = await repo.similarityCorpus(SIMILARITY_LIMIT);
	const verdict = assessDraft({
		draft,
		category: deskCategory ?? parsed.category ?? "ai",
		sources: loaded.refs,
		recent: corpus,
		illustration: parsed.sourceImage || parsed.image ? "uploaded" : "none",
	});
	if (!verdict.ok) return reasons(verdict.reasons);
	draft = { ...draft, title: titled };

	const id = crypto.randomUUID();
	const nowIso = now.toISOString();
	const suffix = id.slice(0, 8);
	let picture = { imageKey: "", imageCommit: "", imageType: "", pause: false };
	let imageCredit = "";
	let imageSourceUrl = "";
	try {
		if (parsed.sourceImage) {
			const pageUrl = loaded.refs[0]?.url ?? parsed.sourceImage.url;
			let keptUrl = "";
			for (const candidate of imageCandidates(parsed.sourceImage.url, loaded.html, pageUrl)) {
				const fetched = await fetchPublisherImage(candidate, fetchImpl);
				if (!fetched) continue;
				if (fetched.overflow || !fetched.bytes.byteLength) {
					keptUrl = fetched.finalUrl;
					break;
				}
				const stored = await storeOriginalLead(env, fetched.bytes, slug, suffix, nowIso, fetchImpl);
				if (stored.imageKey) {
					picture = stored;
					keptUrl = fetched.finalUrl;
					break;
				}
				if (stored.pause) break;
			}
			if (keptUrl) {
				imageCredit = parsed.sourceImage.credit;
				imageSourceUrl = keptUrl;
			}
		} else if (parsed.image) {
			picture = await storeOriginalLead(env, parsed.image.bytes, slug, suffix, nowIso, fetchImpl);
		}
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news ingest image skipped",
			error: error instanceof Error ? error.message : String(error),
		}));
	}
	const article: StoredArticle = {
		id,
		slug,
		title: draft.title,
		description: draft.description,
		category: parsed.category ?? "ai",
		section: parsed.section,
		tags: draft.tags,
		authorId: author.id,
		bodyHtml: "",
		bodyText: draft.paragraphs.join("\n\n"),
		keyPoints: draft.keyPoints,
		faq: draft.faq,
		sources: loaded.refs.map(({ url, title, outlet }) => ({ url, title, outlet })),
		related: related.map(({ article: prior }) => ({ slug: prior.slug, title: prior.title })),
		imageKey: picture.imageKey,
		imageCommit: picture.imageCommit,
		imageAlt: picture.imageKey ? draft.imageAlt : "",
		imageType: picture.imageType,
		imageCredit,
		imageSourceUrl,
		publishedAt: nowIso,
		updatedAt: nowIso,
	};
	try {
		await repo.insert(article);
	} catch (error) {
		if (picture.imageKey) {
			const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
			for (const path of filesForStoredImage(picture.imageKey)) await deleteImageFile(token, path, fetchImpl);
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(JSON.stringify({ message: "ai-news ingest insert failed", error: message }));
		if (/duplicate|unique/i.test(message)) return json({ error: "duplicate", conflicts: [{ field: "slug", value: slug }] }, 409);
		return json({ error: "unavailable" }, 503);
	}
	const url = `${origin}/ai-news/article/${slug}`;
	try {
		await pingIndexNow(env, indexNowPublishUrls(origin, [url]), fetchImpl);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news indexnow error",
			error: error instanceof Error ? error.message : String(error),
		}));
	}
	console.log(JSON.stringify({
		message: "ai-news ingested",
		slug,
		category: parsed.category,
		authorId: author.id,
		image: Boolean(picture.imageKey),
		words: wordCount(article.bodyText),
	}));
	return json({ url, slug }, 201);
}

export async function handleIngestRequest(request: Request, env: NewsEnv, deps: IngestDeps): Promise<Response> {
	const secret = env.AI_NEWS_INGEST_TOKEN?.trim() ?? "";
	if (!secret) return json({ error: "not_found" }, 404);
	const matches = await tokensMatch(bearerToken(request.headers.get("authorization")), secret);
	if (!matches) return json({ error: "unauthorized" }, 401, { "www-authenticate": "Bearer" });

	const kind = ingestApiPath(new URL(request.url).pathname);
	if (kind === "meta") {
		if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(["GET", "HEAD"]);
		return metaResponse(request, env, deps.repo);
	}
	if (kind === "post") {
		if (request.method !== "POST") return methodNotAllowed(["POST"]);
		return postArticle(request, env, deps, deps.now ?? new Date());
	}
	if (kind === "backfill") {
		if (request.method !== "POST") return methodNotAllowed(["POST"]);
		return backfillResponse(request, env, deps);
	}
	return json({ error: "not_found" }, 404);
}

async function backfillResponse(request: Request, env: NewsEnv, deps: IngestDeps): Promise<Response> {
	const repo = deps.repo;
	if (!repo) return json({ error: "unavailable" }, 503);
	const raw = await readBodyCapped(new Response(request.body), 20_000);
	if (raw == null) return reasons(["body_too_large"]);
	if (raw.trim()) {
		try {
			backfillLimit(JSON.parse(raw));
		} catch {
			return reasons(["invalid_json"]);
		}
	}
	try {
		const report = await backfillLeads(env, { repo, fetchImpl: deps.fetchImpl, now: deps.now });
		if (report.error) return json(report, 503);
		return json(report, 200);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news backfill failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		return json({ error: "unavailable" }, 503);
	}
}
