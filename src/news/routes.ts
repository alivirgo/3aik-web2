import type { Env } from "../types";
import { AUTHORS } from "./authors";
import { contactEmail, publishingEnabled, siteOrigin } from "./config";
import {
	renderAbout,
	renderArchive,
	renderArticle,
	renderAuthor,
	renderCategory,
	renderContact,
	renderCorrections,
	renderDisclaimer,
	renderEditorialPolicy,
	renderIndex,
	renderNotFound,
} from "./html";
import { loadPublicImage, parseMediaRequest } from "./github-images";
import { handleIngestRequest, ingestApiPath } from "./ingest";
import { beaconSource, handleCollectRequest, isNewsCollectPath } from "./collect";
import { statsBudgetCharge, statsBudgetOpen } from "./budget";
import { isFeedPath, isTrackedMiss, pageViewFromRequest, trackedPage, type PageViewEvent } from "./pageviews";
import { allowStatsLane } from "./ratelimit";
import { htmlCsp, publicNotFoundResponse, scriptSourceHashes, securityHeaders } from "./responses";
import type { NewsHtml } from "./html";
import { LIST_PAGE_SIZE, pageCount, pageHref, parsePageParam } from "./paging";
import { D1NewsRepository, type NewsRepository, type NewsStatsOptions } from "./repository";
import { handleNewsStatsRequest, isNewsStatsPath } from "./stats";
import { runPublishCycle } from "./pipeline";
import { renderAtom, renderLlmsTxt, renderNewsSitemap, renderRss, renderSitemap, renderSitemapIndex } from "./syndication";
import type { Category, SitemapEntry, StoredArticle } from "./types";
import { CATEGORIES } from "./types";
import { isCategory } from "./text";

export interface NewsRequestDeps {
	repo?: NewsRepository | null;
	fetchImpl?: typeof fetch;
	now?: Date;
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
/** One sitemap file stays small enough for a Free worker to render. */
export const SITEMAP_PAGE_SIZE = 1000;
const FEED_ARTICLE_LIMIT = 100;
const IMAGE_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'none'";

async function htmlResponse(request: Request, page: NewsHtml, status: number, cache: string): Promise<Response> {
	const path = normalizePath(new URL(request.url).pathname);
	const tracked = status === 200 ? trackedPage(path) : null;
	const beacon = tracked?.slug ? beaconSource(tracked.page, tracked.slug) : "";
	const scripts = beacon ? [...page.scripts, beacon] : page.scripts;
	const html = beacon ? page.html.replace("</body>", `<script>${beacon}</script></body>`) : page.html;
	const headers = securityHeaders("text/html; charset=utf-8", cache, htmlCsp(await scriptSourceHashes(scripts)));
	if (request.method === "HEAD") return new Response(null, { status, headers });
	return new Response(html, { status, headers });
}

function xmlResponse(request: Request, body: string, contentType: string): Response {
	const headers = securityHeaders(contentType, "public, max-age=120", PAGE_CSP);
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(body, { status: 200, headers });
}

function textResponse(request: Request, body: string, cache: string): Response {
	const headers = securityHeaders("text/plain; charset=utf-8", cache, PAGE_CSP);
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(body, { status: 200, headers });
}

function edgeCache(): Cache | null {
	const store = (globalThis as { caches?: { default?: Cache } }).caches;
	return store?.default ?? null;
}

/**
 * Tracking params must not split the cache. A page query stays in the key so
 * page 2 is not stored as page 1. `?page=1` collapses onto the clean URL.
 * Invalid page values stay distinct so a 404 cannot overwrite the index.
 */
export function newsCacheRequest(request: Request): Request {
	const url = new URL(request.url);
	const page = url.searchParams.get("page");
	url.search = "";
	url.hash = "";
	if (page !== null && page !== "1") url.searchParams.set("page", page.slice(0, 16));
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
	if (!control.includes("public") || control.includes("no-store") || control.includes("private")) return;
	const policy = response.headers.get("content-security-policy") ?? "";
	if (policy.includes("'nonce-")) return;
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

async function loadRecent(repo: NewsRepository | null, limit: number, category?: Category, offset = 0): Promise<StoredArticle[]> {
	if (!repo) return [];
	try {
		return await repo.listRecent(limit, category, offset);
	} catch (error) {
		logReadError("list", error);
		return [];
	}
}

async function loadByAuthor(repo: NewsRepository | null, authorId: string, limit: number, offset: number): Promise<StoredArticle[]> {
	if (!repo) return [];
	try {
		return await repo.listByAuthor(authorId, limit, offset);
	} catch (error) {
		logReadError("author", error);
		return [];
	}
}

async function loadSitemap(repo: NewsRepository | null, limit: number, offset = 0): Promise<SitemapEntry[]> {
	if (!repo) return [];
	try {
		return await repo.listSitemap(limit, offset);
	} catch (error) {
		logReadError("sitemap", error);
		return [];
	}
}

async function countArticles(repo: NewsRepository | null, category?: Category): Promise<number> {
	if (!repo) return 0;
	try {
		return await repo.countArticles(category);
	} catch (error) {
		logReadError("count", error);
		return 0;
	}
}

async function countAuthor(repo: NewsRepository | null, authorId: string): Promise<number> {
	if (!repo) return 0;
	try {
		return await repo.countByAuthor(authorId);
	} catch (error) {
		logReadError("count-author", error);
		return 0;
	}
}

function listingFromQuery(raw: string | null, total: number): { page: number; pages: number; offset: number } | null {
	const parsed = parsePageParam(raw);
	if (parsed === "invalid") return null;
	const page = parsed === "missing" ? 1 : parsed;
	const pages = pageCount(total);
	if (page > pages) return null;
	return { page, pages, offset: (page - 1) * LIST_PAGE_SIZE };
}

function redirectResponse(location: string): Response {
	const headers = securityHeaders("text/plain; charset=utf-8", "public, max-age=3600", PAGE_CSP);
	headers.set("location", location);
	return new Response(null, { status: 301, headers });
}

function pagedLocs(base: string, total: number): string[] {
	const pages = pageCount(total);
	const urls: string[] = [];
	for (let page = 2; page <= pages; page += 1) urls.push(pageHref(base, page));
	return urls;
}

function statsOptions(env: Env): NewsStatsOptions {
	return {
		budget: env.NEWS_STATS_BUDGET
			? {
				open: (day) => statsBudgetOpen(env.NEWS_STATS_BUDGET as DurableObjectNamespace, day),
				charge: (rows, day) => statsBudgetCharge(env.NEWS_STATS_BUDGET as DurableObjectNamespace, rows, day),
			}
			: undefined,
		analytics: env.AI_NEWS_EVENTS,
	};
}

function resolveRepo(env: Env, override: NewsRequestDeps): NewsRepository | null {
	if ("repo" in override) return override.repo ?? null;
	return env.AI_NEWS_DB ? new D1NewsRepository(env.AI_NEWS_DB, statsOptions(env)) : null;
}

function scheduleAnalytics(ctx: ExecutionContext | undefined, request: Request, env: Env, override: NewsRequestDeps, path: string, status: number): void {
	if (!ctx || request.method !== "GET") return;
	const repo = resolveRepo(env, override);
	if (!repo) return;
	let siteHost = "3aik.com";
	try {
		siteHost = new URL(siteOrigin(env, request)).hostname;
	} catch {
		siteHost = "3aik.com";
	}
	const now = override.now ?? new Date();
	let event: PageViewEvent | null = null;
	if (status === 200) {
		if (isFeedPath(path)) {
			event = pageViewFromRequest(request, { slug: "", page: path }, now, siteHost);
			event.eventKind = "feed";
		} else {
			const tracked = trackedPage(path);
			if (!tracked) return;
			const draft = pageViewFromRequest(request, tracked, now, siteHost);
			if (draft.bot !== 1) return;
			event = draft;
		}
	} else if (status === 404 && isTrackedMiss(path)) {
		event = pageViewFromRequest(request, { slug: "", page: path }, now, siteHost);
		event.eventKind = "404";
	}
	if (!event) return;
	const recorded = event;
	const address = request.headers.get("cf-connecting-ip") ?? "";
	const lane = recorded.bot === 1 || recorded.eventKind === "404" || recorded.eventKind === "feed" ? "counter" : "view";
	const work = allowStatsLane(env.NEWS_STATS_RATE_LIMITER, address, lane).then((allowed) => {
		if (!allowed) return;
		return repo.recordPageView(recorded);
	}).catch((error: unknown) => {
		console.error(JSON.stringify({
			message: "ai-news pageview failed",
			error: error instanceof Error ? error.message : "pageview",
		}));
	});
	ctx.waitUntil(work);
}

export async function handleNewsRequest(request: Request, env: Env, override: NewsRequestDeps = {}, ctx?: ExecutionContext): Promise<Response> {
	const requestUrl = new URL(request.url);
	const rawPath = requestUrl.pathname;
	if (
		(request.method === "GET" || request.method === "HEAD")
		&& rawPath.startsWith("/ai-news/")
		&& rawPath.length > 1
		&& rawPath.endsWith("/")
	) {
		const stripped = rawPath.replace(/\/+$/, "") || "/ai-news";
		return redirectResponse(`${siteOrigin(env, request)}${stripped}${requestUrl.search}`);
	}
	const earlyPath = normalizePath(rawPath);
	if (ingestApiPath(earlyPath)) {
		return handleIngestRequest(request, env, {
			repo: resolveRepo(env, override),
			fetchImpl: override.fetchImpl ?? fetch,
			now: override.now,
		});
	}
	if (isNewsStatsPath(earlyPath)) {
		return handleNewsStatsRequest(request, env, resolveRepo(env, override), siteOrigin(env, request), override.now);
	}
	if (isNewsCollectPath(earlyPath)) {
		return handleCollectRequest(request, env, resolveRepo(env, override), siteOrigin(env, request), ctx, override.now);
	}
	const hit = await matchEdge(request);
	if (hit) {
		scheduleAnalytics(ctx, request, env, override, earlyPath, hit.status);
		return hit;
	}
	const response = await buildNewsResponse(request, env, override);
	scheduleAnalytics(ctx, request, env, override, earlyPath, response.status);
	await putEdge(request, response, ctx);
	return response;
}

export { isNewsStatsPath };

async function buildNewsResponse(request: Request, env: Env, override: NewsRequestDeps): Promise<Response> {
	const url = new URL(request.url);
	const origin = siteOrigin(env, request);
	const path = normalizePath(url.pathname);
	const repo = resolveRepo(env, override);
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
			const total = await countArticles(repo);
			const listing = listingFromQuery(url.searchParams.get("page"), total);
			if (!listing) return await publicNotFoundResponse(request, origin);
			const articles = await loadRecent(repo, LIST_PAGE_SIZE, undefined, listing.offset);
			return await htmlResponse(request, renderIndex(origin, articles, listing), 200, "public, max-age=60");
		}
		if (path === "/ai-news/about") return await htmlResponse(request, renderAbout(origin), 200, "public, max-age=3600");
		if (path === "/ai-news/disclaimer") return await htmlResponse(request, renderDisclaimer(origin), 200, "public, max-age=3600");
		if (path === "/ai-news/editorial-policy") return await htmlResponse(request, renderEditorialPolicy(origin), 200, "public, max-age=3600");
		if (path === "/ai-news/corrections") return await htmlResponse(request, renderCorrections(origin, contactEmail(env)), 200, "public, max-age=3600");
		if (path === "/ai-news/contact") return await htmlResponse(request, renderContact(origin, contactEmail(env)), 200, "public, max-age=3600");
		const pagePath = /^\/ai-news(?:\/(ai|technology|fashion|showbiz|archive|author\/[a-z0-9-]{1,80}))?\/page\/([1-9]\d{0,4})$/.exec(path);
		if (pagePath) {
			const section = pagePath[1] ?? "";
			const page = Number(pagePath[2]);
			const base = section ? `${origin}/ai-news/${section}` : `${origin}/ai-news`;
			return redirectResponse(pageHref(base, page));
		}
		const sitemapPage = /^\/ai-news\/sitemap\/([1-9]\d{0,2})\.xml$/.exec(path);
		if (path === "/ai-news/sitemap.xml" || sitemapPage) {
			const count = await countArticles(repo);
			const pages = Math.max(1, Math.ceil(count / SITEMAP_PAGE_SIZE));
			const requested = sitemapPage ? Number(sitemapPage[1]) : 0;
			if (!sitemapPage) {
				return xmlResponse(request, renderSitemapIndex(origin, pages), "application/xml; charset=utf-8");
			}
			const index = requested === 0 ? 1 : requested;
			const articles = index > pages ? [] : await loadSitemap(repo, SITEMAP_PAGE_SIZE, (index - 1) * SITEMAP_PAGE_SIZE);
			const extras: string[] = [];
			if (index === 1) {
				extras.push(...pagedLocs(`${origin}/ai-news`, count));
				extras.push(...pagedLocs(`${origin}/ai-news/archive`, count));
				for (const category of CATEGORIES) {
					extras.push(...pagedLocs(`${origin}/ai-news/${category}`, await countArticles(repo, category)));
				}
				for (const author of AUTHORS) {
					extras.push(...pagedLocs(`${origin}/ai-news/author/${author.id}`, await countAuthor(repo, author.id)));
				}
			}
			return xmlResponse(request, renderSitemap(origin, articles, extras), "application/xml; charset=utf-8");
		}
		if (path === "/ai-news/news-sitemap.xml") {
			// Google News rejects stories older than two days. Scan past the feed cap so that window is complete.
			const articles = await loadSitemap(repo, SITEMAP_PAGE_SIZE);
			return xmlResponse(request, renderNewsSitemap(origin, articles, new Date()), "application/xml; charset=utf-8");
		}
		if (path === "/ai-news/feed.xml") {
			const articles = await loadRecent(repo, FEED_ARTICLE_LIMIT);
			return xmlResponse(request, renderRss(origin, articles), "application/rss+xml; charset=utf-8");
		}
		if (path === "/ai-news/atom.xml") {
			const articles = await loadRecent(repo, FEED_ARTICLE_LIMIT);
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
					return await publicNotFoundResponse(request, origin);
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
			const articles = await loadRecent(repo, FEED_ARTICLE_LIMIT, feedCategory);
			if (feedMatch[2] === "atom.xml") {
				return xmlResponse(request, renderAtom(origin, articles, feedCategory), "application/atom+xml; charset=utf-8");
			}
			return xmlResponse(request, renderRss(origin, articles, feedCategory), "application/rss+xml; charset=utf-8");
		}

		if (isCategory(path.slice("/ai-news/".length)) && path.startsWith("/ai-news/")) {
			const category = path.slice("/ai-news/".length);
			if (isCategory(category)) {
				const total = await countArticles(repo, category);
				const listing = listingFromQuery(url.searchParams.get("page"), total);
				if (!listing) return await publicNotFoundResponse(request, origin);
				const articles = await loadRecent(repo, LIST_PAGE_SIZE, category, listing.offset);
				return await htmlResponse(request, renderCategory(origin, category, articles, listing), 200, "public, max-age=60");
			}
		}

		if (path === "/ai-news/archive") {
			const total = await countArticles(repo);
			const listing = listingFromQuery(url.searchParams.get("page"), total);
			if (!listing) return await publicNotFoundResponse(request, origin);
			const articles = await loadRecent(repo, LIST_PAGE_SIZE, undefined, listing.offset);
			return await htmlResponse(request, renderArchive(origin, articles, listing), 200, "public, max-age=60");
		}

		const authorMatch = /^\/ai-news\/author\/([a-z0-9-]{1,80})$/.exec(path);
		if (authorMatch?.[1]) {
			const authorId = authorMatch[1];
			const total = await countAuthor(repo, authorId);
			const listing = listingFromQuery(url.searchParams.get("page"), total);
			if (!listing) return await publicNotFoundResponse(request, origin);
			const articles = await loadByAuthor(repo, authorId, LIST_PAGE_SIZE, listing.offset);
			const page = renderAuthor(origin, authorId, articles, listing);
			if (!page) return await publicNotFoundResponse(request, origin);
			return await htmlResponse(request, page, 200, "public, max-age=120");
		}

		const articleMatch = /^\/ai-news\/article\/([a-z0-9-]{1,120})$/.exec(path);
		if (articleMatch?.[1]) {
			let article = null;
			if (repo) {
				try {
					article = await repo.getBySlug(articleMatch[1]);
				} catch (error) {
					logReadError(path, error);
					return await publicNotFoundResponse(request, origin);
				}
			}
			if (!article) return await publicNotFoundResponse(request, origin);
			const latest = await loadRecent(repo, 8);
			return await htmlResponse(request, renderArticle(origin, article, latest), 200, "public, max-age=120");
		}

		return await publicNotFoundResponse(request, origin);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news request failed",
			path,
			error: error instanceof Error ? error.message : String(error),
		}));
		return await htmlResponse(request, renderNotFound(origin), 500, "no-store");
	}
}

export async function publishScheduled(env: Env, controller: ScheduledController): Promise<void> {
	const now = new Date(controller.scheduledTime || Date.now());
	if (env.AI_NEWS_DB) {
		const repo = new D1NewsRepository(env.AI_NEWS_DB, statsOptions(env));
		try {
			await repo.pruneStatsRetention(now);
		} catch (error) {
			console.error(JSON.stringify({
				message: "ai-news stats prune failed",
				error: error instanceof Error ? error.message : "prune",
			}));
		}
		if (!publishingEnabled(env)) {
			console.log(JSON.stringify({ message: "ai-news publishing paused" }));
			return;
		}
		await runPublishCycle({ env, repo, now });
		return;
	}
	if (!publishingEnabled(env)) {
		console.log(JSON.stringify({ message: "ai-news publishing paused" }));
		return;
	}
	console.error(JSON.stringify({ message: "ai-news bindings missing" }));
}
