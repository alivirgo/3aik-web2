import type { Env } from "../types";
import { publishingEnabled, siteOrigin } from "./config";
import {
	renderAbout,
	renderArticle,
	renderAuthor,
	renderCategory,
	renderDisclaimer,
	renderIndex,
	renderNotFound,
} from "./html";
import { loadPublicImage, parseMediaRequest } from "./github-images";
import { runPublishCycle } from "./pipeline";
import { D1NewsRepository, type NewsRepository } from "./repository";
import { renderAtom, renderLlmsTxt, renderNewsSitemap, renderRss, renderSitemap } from "./syndication";
import type { SitemapEntry, StoredArticle } from "./types";
import { isCategory } from "./text";

export interface NewsRequestDeps {
	repo?: NewsRepository | null;
	fetchImpl?: typeof fetch;
}

export function isNewsRequestPath(pathname: string, indexNowKey?: string): boolean {
	if (pathname === "/llms.txt") return true;
	if (pathname === "/ai-news" || pathname.startsWith("/ai-news/")) return true;
	const key = indexNowKey?.trim();
	if (key && /^[A-Za-z0-9-]{8,128}$/.test(key) && pathname === `/${key}.txt`) return true;
	return false;
}

function normalizePath(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
	return pathname;
}

/**
 * Pages keep img-src 'self'. Illustrations are proxied from jsDelivr onto
 * /ai-news/media/..., so the policy does not allow cdn.jsdelivr.net.
 * Image responses themselves cannot load anything.
 */
const PAGE_CSP = "default-src 'self'; base-uri 'self'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'none'; style-src 'self'; upgrade-insecure-requests";
const IMAGE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'none'";

function securityHeaders(contentType: string, cache: string, csp = PAGE_CSP): Headers {
	const headers = new Headers();
	headers.set("content-type", contentType);
	headers.set("cache-control", cache);
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	headers.set("referrer-policy", "strict-origin-when-cross-origin");
	headers.set("strict-transport-security", "max-age=31536000");
	headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
	headers.set("content-security-policy", csp);
	return headers;
}

function htmlResponse(request: Request, body: string, status: number, cache: string): Response {
	const headers = securityHeaders("text/html; charset=utf-8", cache);
	if (request.method === "HEAD") return new Response(null, { status, headers });
	return new Response(body, { status, headers });
}

function xmlResponse(request: Request, body: string, contentType: string): Response {
	const headers = securityHeaders(contentType, "public, max-age=120");
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(body, { status: 200, headers });
}

function textResponse(request: Request, body: string, cache: string): Response {
	const headers = securityHeaders("text/plain; charset=utf-8", cache);
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(body, { status: 200, headers });
}

function edgeCache(): Cache | null {
	const store = (globalThis as { caches?: { default?: Cache } }).caches;
	return store?.default ?? null;
}

/** Query strings must not split the cache. Tracking params would otherwise store a copy per click. */
export function newsCacheRequest(request: Request): Request {
	const url = new URL(request.url);
	url.search = "";
	url.hash = "";
	return new Request(url.toString(), { method: "GET" });
}

async function matchEdge(request: Request): Promise<Response | null> {
	if (request.method !== "GET") return null;
	const cache = edgeCache();
	if (!cache) return null;
	try {
		const hit = await cache.match(newsCacheRequest(request));
		return hit ?? null;
	} catch {
		return null;
	}
}

async function putEdge(request: Request, response: Response, ctx?: ExecutionContext): Promise<void> {
	if (request.method !== "GET" || (response.status !== 200 && response.status !== 404)) return;
	const control = response.headers.get("cache-control") ?? "";
	if (!control.includes("public") || control.includes("no-store")) return;
	const cache = edgeCache();
	if (!cache) return;
	const put = cache.put(newsCacheRequest(request), response.clone()).catch(() => undefined);
	if (ctx) ctx.waitUntil(put);
	else await put;
}

function logReadError(path: string, error: unknown): void {
	console.error(JSON.stringify({
		message: "ai-news read failed",
		path,
		error: error instanceof Error ? error.message : String(error),
	}));
}

async function loadRecent(repo: NewsRepository | null, limit: number, category?: Parameters<NewsRepository["listRecent"]>[1]): Promise<StoredArticle[]> {
	if (!repo) return [];
	try {
		return await repo.listRecent(limit, category);
	} catch (error) {
		logReadError("list", error);
		return [];
	}
}

async function loadSitemap(repo: NewsRepository | null, limit: number): Promise<SitemapEntry[]> {
	if (!repo) return [];
	try {
		return await repo.listSitemap(limit);
	} catch (error) {
		logReadError("sitemap", error);
		return [];
	}
}

export async function handleNewsRequest(request: Request, env: Env, override: NewsRequestDeps = {}, ctx?: ExecutionContext): Promise<Response> {
	const hit = await matchEdge(request);
	if (hit) return hit;
	const response = await buildNewsResponse(request, env, override);
	await putEdge(request, response, ctx);
	return response;
}

async function buildNewsResponse(request: Request, env: Env, override: NewsRequestDeps): Promise<Response> {
	const url = new URL(request.url);
	const origin = siteOrigin(env, request);
	const path = normalizePath(url.pathname);
	const repo = "repo" in override ? (override.repo ?? null) : (env.AI_NEWS_DB ? new D1NewsRepository(env.AI_NEWS_DB) : null);
	const fetchImpl = override.fetchImpl ?? fetch;

	try {
		const key = env.INDEXNOW_KEY?.trim();
		if (key && /^[A-Za-z0-9-]{8,128}$/.test(key) && path === `/${key}.txt`) {
			return textResponse(request, key, "public, max-age=3600");
		}
		if (path === "/llms.txt") {
			const articles = await loadRecent(repo, 20);
			return textResponse(request, renderLlmsTxt(origin, articles), "public, max-age=300");
		}

		if (path === "/ai-news") {
			const articles = await loadRecent(repo, 24);
			return htmlResponse(request, renderIndex(origin, articles), 200, "public, max-age=60");
		}
		if (path === "/ai-news/about") return htmlResponse(request, renderAbout(origin), 200, "public, max-age=3600");
		if (path === "/ai-news/disclaimer") return htmlResponse(request, renderDisclaimer(origin), 200, "public, max-age=3600");
		if (path === "/ai-news/sitemap.xml") {
			const articles = await loadSitemap(repo, 1000);
			return xmlResponse(request, renderSitemap(origin, articles), "application/xml; charset=utf-8");
		}
		if (path === "/ai-news/news-sitemap.xml") {
			const articles = await loadSitemap(repo, 200);
			return xmlResponse(request, renderNewsSitemap(origin, articles, new Date()), "application/xml; charset=utf-8");
		}
		if (path === "/ai-news/feed.xml") {
			const articles = await loadRecent(repo, 40);
			return xmlResponse(request, renderRss(origin, articles), "application/rss+xml; charset=utf-8");
		}
		if (path === "/ai-news/atom.xml") {
			const articles = await loadRecent(repo, 40);
			return xmlResponse(request, renderAtom(origin, articles), "application/atom+xml; charset=utf-8");
		}

		const media = parseMediaRequest(path);
		if (media) {
			const miss = () => {
				const headers = securityHeaders("text/plain; charset=utf-8", "public, max-age=60", IMAGE_CSP);
				return new Response(request.method === "HEAD" ? null : "Not found\n", { status: 404, headers });
			};
			let known: { contentType: string } | null = null;
			if (repo) {
				try {
					known = await repo.findImage(media.repoPath, media.commitSha);
				} catch (error) {
					logReadError(path, error);
					return htmlResponse(request, renderNotFound(origin), 404, "no-store");
				}
			}
			if (!known) return miss();
			if (request.method === "HEAD") {
				const headers = securityHeaders(known.contentType, "public, max-age=31536000, immutable", IMAGE_CSP);
				return new Response(null, { status: 200, headers });
			}
			let stored = null;
			try {
				stored = await loadPublicImage(media.repoPath, media.commitSha, fetchImpl);
			} catch (error) {
				logReadError(path, error);
				const headers = securityHeaders("text/plain; charset=utf-8", "no-store", IMAGE_CSP);
				return new Response(request.method === "HEAD" ? null : "Not found\n", { status: 404, headers });
			}
			if (!stored) {
				const headers = securityHeaders("text/plain; charset=utf-8", "no-store", IMAGE_CSP);
				return new Response("Not found\n", { status: 404, headers });
			}
			const headers = securityHeaders(stored.contentType, "public, max-age=31536000, immutable", IMAGE_CSP);
			return new Response(stored.bytes, { status: 200, headers });
		}

		const feedMatch = /^\/ai-news\/(ai|technology|fashion|showbiz)\/(feed\.xml|atom\.xml)$/.exec(path);
		const feedCategory = feedMatch?.[1] ?? "";
		if (feedMatch && isCategory(feedCategory)) {
			const articles = await loadRecent(repo, 40, feedCategory);
			if (feedMatch[2] === "atom.xml") {
				return xmlResponse(request, renderAtom(origin, articles, feedCategory), "application/atom+xml; charset=utf-8");
			}
			return xmlResponse(request, renderRss(origin, articles, feedCategory), "application/rss+xml; charset=utf-8");
		}

		if (isCategory(path.slice("/ai-news/".length)) && path.startsWith("/ai-news/")) {
			const category = path.slice("/ai-news/".length);
			if (isCategory(category)) {
				const articles = await loadRecent(repo, 24, category);
				return htmlResponse(request, renderCategory(origin, category, articles), 200, "public, max-age=60");
			}
		}

		const authorMatch = /^\/ai-news\/author\/([a-z0-9-]{1,80})$/.exec(path);
		if (authorMatch?.[1]) {
			let articles: StoredArticle[] = [];
			if (repo) {
				try {
					articles = await repo.listByAuthor(authorMatch[1], 24);
				} catch (error) {
					logReadError(path, error);
				}
			}
			const page = renderAuthor(origin, authorMatch[1], articles);
			if (!page) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			return htmlResponse(request, page, 200, "public, max-age=120");
		}

		const articleMatch = /^\/ai-news\/article\/([a-z0-9-]{1,120})$/.exec(path);
		if (articleMatch?.[1]) {
			let article = null;
			if (repo) {
				try {
					article = await repo.getBySlug(articleMatch[1]);
				} catch (error) {
					logReadError(path, error);
					return htmlResponse(request, renderNotFound(origin), 404, "no-store");
				}
			}
			if (!article) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			return htmlResponse(request, renderArticle(origin, article), 200, "public, max-age=120");
		}

		return htmlResponse(request, renderNotFound(origin), 404, "no-store");
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news request failed",
			path,
			error: error instanceof Error ? error.message : String(error),
		}));
		return htmlResponse(request, renderNotFound(origin), 500, "no-store");
	}
}

export async function publishScheduled(env: Env, controller: ScheduledController): Promise<void> {
	if (!publishingEnabled(env)) {
		console.log(JSON.stringify({ message: "ai-news publishing paused" }));
		return;
	}
	if (!env.AI_NEWS_DB) {
		console.error(JSON.stringify({ message: "ai-news bindings missing" }));
		return;
	}
	await runPublishCycle({
		env,
		repo: new D1NewsRepository(env.AI_NEWS_DB),
		now: new Date(controller.scheduledTime || Date.now()),
	});
}
