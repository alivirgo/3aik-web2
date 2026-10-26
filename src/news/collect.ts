import type { NewsEnv } from "./config";
import { publicHttpsUrl } from "./net";
import {
	cachedDaySalt,
	pageViewFromRequest,
	saltToHex,
	type EventKind,
	type PageViewEvent,
	trackedPage,
	visitorHmac,
} from "./pageviews";
import { allowCollect } from "./ratelimit";
import { publicNotFoundResponse } from "./responses";
import type { NewsRepository } from "./repository";

export function isNewsCollectPath(pathname: string): boolean {
	const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	return path === "/ai-news/api/collect";
}

export function collectSameOrigin(request: Request, siteOrigin: string): boolean {
	const fetchSite = request.headers.get("sec-fetch-site");
	if (fetchSite === "cross-site") return false;
	const allowed = new Set<string>();
	try {
		allowed.add(new URL(request.url).origin);
	} catch {
		return false;
	}
	try {
		allowed.add(new URL(siteOrigin).origin);
	} catch {
		/* The page host is enough when the configured origin is unset. */
	}
	const origin = request.headers.get("origin");
	if (origin) return allowed.has(origin);
	return fetchSite === "same-origin" || fetchSite === "same-site";
}

function quietHeaders(): Headers {
	const headers = new Headers();
	headers.set("cache-control", "private, no-store");
	headers.set("cdn-cache-control", "no-store");
	headers.set("cloudflare-cdn-cache-control", "no-store");
	headers.set("x-robots-tag", "noindex, nofollow");
	headers.set("x-content-type-options", "nosniff");
	headers.set("referrer-policy", "no-referrer");
	return headers;
}

const COLLECT_MAX_BYTES = 4096;

async function readCappedText(request: Request, max: number): Promise<string | null> {
	const reader = request.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const step = await reader.read();
		if (step.done) break;
		const value = step.value;
		if (!value) continue;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel().catch(() => undefined);
			return null;
		}
		chunks.push(value);
	}
	const buffer = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		buffer.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(buffer);
}

function noContent(): Response {
	return new Response(null, { status: 204, headers: quietHeaders() });
}

function screenOf(value: unknown): PageViewEvent["screen"] {
	return value === "xs" || value === "sm" || value === "md" || value === "lg" ? value : "";
}

function returningOf(value: unknown): -1 | 0 | 1 {
	return value === 0 || value === 1 ? value : -1;
}

/** Beacon body. Unknown fields, including any client id, are ignored. */
export function beaconToEvent(body: unknown, request: Request, now: Date, siteHost: string): PageViewEvent | null {
	if (!body || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;
	const kind = record.kind === "engage" || record.kind === "click" ? record.kind : "";
	if (!kind) return null;
	const page = typeof record.page === "string" ? record.page : "";
	const slug = typeof record.slug === "string" ? record.slug : "";
	const tracked = trackedPage(page === "index" ? "/ai-news" : page === "article" ? `/ai-news/article/${slug}` : page.startsWith("section:") ? `/ai-news/${page.slice(8)}` : page.startsWith("author:") ? `/ai-news/author/${page.slice(7)}` : page === "about" || page === "disclaimer" ? `/ai-news/${page}` : "");
	if (!tracked || tracked.page !== page || tracked.slug !== slug) return null;
	const event = pageViewFromRequest(request, tracked, now, siteHost);
	event.eventKind = kind as EventKind;
	event.returning = returningOf(record.returning);
	event.screen = screenOf(record.screen);
	event.engagedMs = kind === "engage" && typeof record.engagedMs === "number" ? record.engagedMs : 0;
	event.scrollPct = kind === "engage" && typeof record.scroll === "number" ? record.scroll : 0;
	if (kind === "click") {
		const href = typeof record.href === "string" ? record.href : "";
		const parsed = publicHttpsUrl(href);
		if (!parsed) return null;
		const url = new URL(parsed);
		event.clickHost = url.hostname.toLowerCase();
		event.clickPath = url.pathname.slice(0, 180);
		event.clickKind = record.clickKind === "source" ? "source" : "outbound";
	}
	return event;
}

export function beaconScript(nonce: string, page: string, slug: string): string {
	const meta = JSON.stringify({ page, slug }).replace(/</g, "\\u003c");
	return `<script nonce="${nonce}">(function(){var meta=${meta};var key="3aik-news-seen";var returning=0;try{returning=localStorage.getItem(key)==="1"?1:0;if(!returning)localStorage.setItem(key,"1");}catch(e){}var start=Date.now();var maxScroll=0;function depth(){var el=document.documentElement;var h=el.scrollHeight-el.clientHeight;if(h<=0)return 100;return Math.max(0,Math.min(100,Math.round(100*(window.scrollY||el.scrollTop)/h)));}addEventListener("scroll",function(){maxScroll=Math.max(maxScroll,depth());},{passive:true});function send(payload){var body=JSON.stringify(payload);if(navigator.sendBeacon){navigator.sendBeacon("/ai-news/api/collect",new Blob([body],{type:"application/json"}));return;}fetch("/ai-news/api/collect",{method:"POST",body:body,headers:{"content-type":"application/json"},keepalive:true,credentials:"omit"}).catch(function(){});}document.addEventListener("click",function(ev){var node=ev.target;var link=node&&node.closest?node.closest("a"):null;if(!link||!link.href)return;var url;try{url=new URL(link.href);}catch(err){return;}var clickKind="";if(link.closest&&link.closest(".source-line"))clickKind="source";else if(url.origin!==location.origin)clickKind="outbound";else return;send({kind:"click",page:meta.page,slug:meta.slug,href:url.origin+url.pathname,clickKind:clickKind,returning:returning});},true);var sent=false;document.addEventListener("visibilitychange",function(){if(document.visibilityState!=="hidden"||sent)return;sent=true;var w=(screen&&screen.width)||0;var bucket=w<480?"xs":w<768?"sm":w<1200?"md":"lg";send({kind:"engage",page:meta.page,slug:meta.slug,engagedMs:Date.now()-start,scroll:Math.max(maxScroll,depth()),screen:bucket,returning:returning});});})();</script>`;
}

export async function handleCollectRequest(
	request: Request,
	_env: NewsEnv,
	repo: NewsRepository | null,
	origin: string,
	ctx?: ExecutionContext,
	now = new Date(),
): Promise<Response> {
	if (request.method !== "POST" || !collectSameOrigin(request, origin)) return publicNotFoundResponse(request, origin);
	const declared = request.headers.get("content-length");
	if (declared !== null) {
		const size = Number(declared);
		if (!Number.isFinite(size) || size < 0 || size > COLLECT_MAX_BYTES) {
			await request.body?.cancel().catch(() => undefined);
			return noContent();
		}
	}
	if (!allowCollect(request.headers.get("cf-connecting-ip") ?? "anon")) {
		await request.body?.cancel().catch(() => undefined);
		return noContent();
	}
	let text: string | null = "";
	try {
		text = await readCappedText(request, COLLECT_MAX_BYTES);
	} catch {
		return noContent();
	}
	if (text == null) return noContent();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return noContent();
	}
	let siteHost = "3aik.com";
	try {
		siteHost = new URL(origin).hostname;
	} catch {
		siteHost = "3aik.com";
	}
	const event = beaconToEvent(parsed, request, now, siteHost);
	if (!event || !repo) return noContent();
	const address = request.headers.get("cf-connecting-ip") ?? "";
	const userAgent = request.headers.get("user-agent") ?? "";
	const day = event.viewedAt.slice(0, 10);
	const salt = cachedDaySalt(day);
	event.visitorHash = visitorHmac(salt, address, userAgent);
	const work = Promise.all([
		repo.persistDaySalt(day, saltToHex(salt)),
		repo.recordPageView(event),
	]).catch((error: unknown) => {
		console.error(JSON.stringify({
			message: "ai-news collect failed",
			error: error instanceof Error ? error.message : "collect",
		}));
	});
	if (ctx) ctx.waitUntil(work);
	else await work;
	return noContent();
}
