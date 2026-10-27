import { AUTHORS } from "./authors";
import { indexNowKey, siteOrigin, type NewsEnv } from "./config";
import type { NewsRepository } from "./repository";
import { bearerToken, tokensMatch } from "./tokens";
import { CATEGORIES } from "./types";

/** IndexNow accepts at most 10,000 URLs in one POST. */
export const INDEXNOW_BATCH_SIZE = 10_000;
export const INDEXNOW_SUBMIT_PATH = "/ai-news/api/indexnow/submit-all";
export const INDEXNOW_SUBMIT_WINDOW_MS = 10 * 60 * 1000;

const TRUST_PATHS = [
	"/ai-news/about",
	"/ai-news/editorial-policy",
	"/ai-news/corrections",
	"/ai-news/contact",
	"/ai-news/disclaimer",
];

export interface IndexNowBatch {
	status: number;
	count: number;
}

export interface IndexNowSubmitDeps {
	repo: NewsRepository | null;
	fetchImpl?: typeof fetch;
	now?: Date;
}

export function isIndexNowSubmitPath(pathname: string): boolean {
	const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	return path === INDEXNOW_SUBMIT_PATH;
}

/** Pages submitted with every new article, plus the two news sitemaps. */
export function indexNowPublishUrls(origin: string, articleUrls: string[]): string[] {
	const root = origin.replace(/\/$/, "");
	return [
		...articleUrls,
		`${root}/ai-news`,
		`${root}/ai-news/archive`,
		`${root}/ai-news/sitemap.xml`,
		`${root}/ai-news/news-sitemap.xml`,
	];
}

/** Index, archive, sections, personas, and trust pages. Articles are added by the caller. */
export function indexNowCatalogUrls(origin: string): string[] {
	const root = origin.replace(/\/$/, "");
	return [
		`${root}/ai-news`,
		`${root}/ai-news/archive`,
		...CATEGORIES.map((category) => `${root}/ai-news/${category}`),
		...AUTHORS.map((author) => `${root}/ai-news/author/${author.id}`),
		...TRUST_PATHS.map((path) => `${root}${path}`),
	];
}

function json(body: unknown, status: number, extra?: HeadersInit): Response {
	const headers = new Headers(extra);
	headers.set("content-type", "application/json; charset=utf-8");
	headers.set("cache-control", "no-store");
	headers.set("x-content-type-options", "nosniff");
	return new Response(JSON.stringify(body), { status, headers });
}

/**
 * POST url batches to IndexNow. A network error becomes status 0 for that
 * batch and does not throw. Callers that publish must keep going either way.
 */
export async function submitIndexNow(env: NewsEnv, urls: string[], fetchImpl: typeof fetch = fetch): Promise<IndexNowBatch[]> {
	const list = urls.filter(Boolean);
	if (!list.length) return [];
	const key = indexNowKey(env);
	const origin = siteOrigin(env);
	let host = "3aik.com";
	try {
		host = new URL(origin).host;
	} catch {
		host = "3aik.com";
	}
	const results: IndexNowBatch[] = [];
	for (let offset = 0; offset < list.length; offset += INDEXNOW_BATCH_SIZE) {
		const batch = list.slice(offset, offset + INDEXNOW_BATCH_SIZE);
		try {
			const response = await fetchImpl("https://api.indexnow.org/indexnow", {
				method: "POST",
				headers: { "content-type": "application/json; charset=utf-8" },
				body: JSON.stringify({
					host,
					key,
					keyLocation: `${origin}/${key}.txt`,
					urlList: batch,
				}),
			});
			results.push({ status: response.status, count: batch.length });
			await response.body?.cancel().catch(() => undefined);
		} catch (error) {
			console.error(JSON.stringify({
				message: "ai-news indexnow error",
				error: error instanceof Error ? error.message : String(error),
			}));
			results.push({ status: 0, count: batch.length });
		}
	}
	return results;
}

/** Fire-and-forget wrapper. Failures are logged and never thrown. */
export async function pingIndexNow(env: NewsEnv, urls: string[], fetchImpl: typeof fetch = fetch): Promise<void> {
	try {
		const results = await submitIndexNow(env, urls, fetchImpl);
		for (const batch of results) {
			if (batch.status < 200 || batch.status >= 300) {
				console.error(JSON.stringify({ message: "ai-news indexnow failed", status: batch.status, count: batch.count }));
			}
		}
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news indexnow error",
			error: error instanceof Error ? error.message : String(error),
		}));
	}
}

async function articleUrls(repo: NewsRepository, origin: string): Promise<string[]> {
	const urls: string[] = [];
	const pageSize = 1000;
	let offset = 0;
	for (;;) {
		const rows = await repo.listSitemap(pageSize, offset);
		for (const row of rows) urls.push(`${origin}/ai-news/article/${row.slug}`);
		if (rows.length < pageSize) break;
		offset += rows.length;
	}
	return urls;
}

export async function handleIndexNowSubmit(request: Request, env: NewsEnv, deps: IndexNowSubmitDeps): Promise<Response> {
	const secret = env.AI_NEWS_INGEST_TOKEN?.trim() ?? "";
	if (!secret) return json({ error: "not_found" }, 404);
	const matches = await tokensMatch(bearerToken(request.headers.get("authorization")), secret);
	if (!matches) return json({ error: "not_found" }, 404);
	if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
	if (!deps.repo) return json({ error: "unavailable" }, 503);

	const now = deps.now ?? new Date();
	const until = new Date(now.getTime() + INDEXNOW_SUBMIT_WINDOW_MS).toISOString();
	let claim: { allowed: boolean; retryAfterSeconds: number };
	try {
		claim = await deps.repo.claimIndexNowSubmit(now.toISOString(), until);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news indexnow claim failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		return json({ error: "unavailable" }, 503);
	}
	if (!claim.allowed) {
		return json(
			{ error: "rate_limited", retryAfterSeconds: claim.retryAfterSeconds },
			429,
			{ "retry-after": String(claim.retryAfterSeconds) },
		);
	}

	const origin = siteOrigin(env, request);
	let urls: string[];
	try {
		const articles = await articleUrls(deps.repo, origin);
		urls = [...new Set([...articles, ...indexNowCatalogUrls(origin)])];
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news indexnow list failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		return json({ error: "unavailable" }, 503);
	}

	const batches = await submitIndexNow(env, urls, deps.fetchImpl ?? fetch);
	return json({ batches }, 200);
}
