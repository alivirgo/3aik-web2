import type { Env } from "../types";
import { siteOrigin } from "./config";
import {
	renderAbout,
	renderArticle,
	renderAuthor,
	renderCategory,
	renderDisclaimer,
	renderIndex,
	renderNotFound,
} from "./html";
import { runPublishCycle } from "./pipeline";
import { D1NewsRepository, R2ImageStore, type ImageStore, type NewsRepository } from "./repository";
import { renderAtom, renderLlmsTxt, renderNewsSitemap, renderRss, renderSitemap } from "./syndication";
import { isCategory } from "./text";

export interface NewsRequestDeps {
	repo?: NewsRepository | null;
	images?: ImageStore | null;
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

function securityHeaders(contentType: string, cache: string): Headers {
	const headers = new Headers();
	headers.set("content-type", contentType);
	headers.set("cache-control", cache);
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	headers.set("referrer-policy", "strict-origin-when-cross-origin");
	headers.set("strict-transport-security", "max-age=31536000");
	headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
	headers.set(
		"content-security-policy",
		"default-src 'self'; base-uri 'self'; connect-src 'none'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'none'; style-src 'self'; upgrade-insecure-requests",
	);
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

async function loadRecent(repo: NewsRepository | null, limit: number) {
	if (!repo) return [];
	return repo.listRecent(limit);
}

export async function handleNewsRequest(request: Request, env: Env, override: NewsRequestDeps = {}): Promise<Response> {
	const url = new URL(request.url);
	const origin = siteOrigin(env, request);
	const path = normalizePath(url.pathname);
	const repo = "repo" in override ? (override.repo ?? null) : (env.AI_NEWS_DB ? new D1NewsRepository(env.AI_NEWS_DB) : null);
	const images = "images" in override ? (override.images ?? null) : (env.AI_NEWS_IMAGES ? new R2ImageStore(env.AI_NEWS_IMAGES) : null);

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
			const articles = await loadRecent(repo, 1000);
			return xmlResponse(request, renderSitemap(origin, articles), "application/xml; charset=utf-8");
		}
		if (path === "/ai-news/news-sitemap.xml") {
			const articles = await loadRecent(repo, 200);
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

		const imageMatch = /^\/ai-news\/image\/([0-9a-f-]{16,80})$/i.exec(path);
		if (imageMatch) {
			const id = imageMatch[1];
			if (!repo || !images || !id) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			const article = await repo.getById(id);
			if (!article) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			const stored = await images.get(article.imageKey);
			if (!stored) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			const headers = securityHeaders(stored.contentType || article.imageType, "public, max-age=86400");
			if (request.method === "HEAD") return new Response(null, { status: 200, headers });
			const body = stored.bytes.slice().buffer as ArrayBuffer;
			return new Response(body, { status: 200, headers });
		}

		const feedMatch = /^\/ai-news\/(ai|technology|fashion|showbiz)\/(feed\.xml|atom\.xml)$/.exec(path);
		const feedCategory = feedMatch?.[1] ?? "";
		if (feedMatch && isCategory(feedCategory)) {
			const articles = repo ? await repo.listRecent(40, feedCategory) : [];
			if (feedMatch[2] === "atom.xml") {
				return xmlResponse(request, renderAtom(origin, articles, feedCategory), "application/atom+xml; charset=utf-8");
			}
			return xmlResponse(request, renderRss(origin, articles, feedCategory), "application/rss+xml; charset=utf-8");
		}

		if (isCategory(path.slice("/ai-news/".length)) && path.startsWith("/ai-news/")) {
			const category = path.slice("/ai-news/".length);
			if (isCategory(category)) {
				const articles = repo ? await repo.listRecent(24, category) : [];
				return htmlResponse(request, renderCategory(origin, category, articles), 200, "public, max-age=60");
			}
		}

		const authorMatch = /^\/ai-news\/author\/([a-z0-9-]{1,80})$/.exec(path);
		if (authorMatch?.[1]) {
			const articles = repo ? await repo.listByAuthor(authorMatch[1], 24) : [];
			const page = renderAuthor(origin, authorMatch[1], articles);
			if (!page) return htmlResponse(request, renderNotFound(origin), 404, "no-store");
			return htmlResponse(request, page, 200, "public, max-age=120");
		}

		const articleMatch = /^\/ai-news\/article\/([a-z0-9-]{1,120})$/.exec(path);
		if (articleMatch?.[1]) {
			const article = repo ? await repo.getBySlug(articleMatch[1]) : null;
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
	if (!env.AI_NEWS_DB || !env.AI_NEWS_IMAGES) {
		console.error(JSON.stringify({ message: "ai-news bindings missing" }));
		return;
	}
	await runPublishCycle({
		env,
		repo: new D1NewsRepository(env.AI_NEWS_DB),
		images: new R2ImageStore(env.AI_NEWS_IMAGES),
		now: new Date(controller.scheduledTime || Date.now()),
	});
}
