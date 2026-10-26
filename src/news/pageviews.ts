import { createHmac } from "node:crypto";

export type SourceClass = "search" | "social" | "direct" | "internal" | "other";
export type DeviceClass = "desktop" | "mobile" | "tablet" | "other";
export type EventKind = "view" | "engage" | "click" | "404" | "feed";
export type ScreenBucket = "" | "xs" | "sm" | "md" | "lg";
export type ClickKind = "" | "outbound" | "source";

/** Fields written to D1. There is no IP, user agent, cookie, or client id. */
export interface PageViewEvent {
	viewedAt: string;
	slug: string;
	page: string;
	referrerHost: string;
	referrerPath: string;
	sourceClass: SourceClass;
	searchEngine: string;
	searchQuery: string;
	utmSource: string;
	utmMedium: string;
	utmCampaign: string;
	utmTerm: string;
	country: string;
	deviceClass: DeviceClass;
	bot: 0 | 1;
	region?: string;
	city?: string;
	continent?: string;
	browser?: string;
	os?: string;
	screen?: ScreenBucket;
	lang?: string;
	botName?: string;
	visitorHash?: string;
	hourUtc?: number;
	hourKarachi?: number;
	eventKind?: EventKind;
	engagedMs?: number;
	scrollPct?: number;
	returning?: -1 | 0 | 1;
	clickHost?: string;
	clickPath?: string;
	clickKind?: ClickKind;
}

export interface TrackedPage {
	slug: string;
	page: string;
}

export interface ArticleViewStat {
	slug: string;
	title: string;
	views: number;
	last24h: number;
	last7d: number;
	uniques: number;
	avgEngagedMs: number;
	avgScrollPct: number;
}

export interface CountRow {
	views: number;
}

export interface ReferrerStat extends CountRow {
	host: string;
	path: string;
}

export interface SourceStat extends CountRow {
	source: SourceClass;
}

export interface QueryStat extends CountRow {
	engine: string;
	query: string;
}

export interface CountryStat extends CountRow {
	country: string;
}

export interface DeviceStat extends CountRow {
	device: DeviceClass;
}

export interface CampaignStat extends CountRow {
	source: string;
	medium: string;
	campaign: string;
	term: string;
}

export interface NamedCount extends CountRow {
	name: string;
}

export interface PageCount extends CountRow {
	page: string;
	slug: string;
	label: string;
}

export interface SeriesPoint {
	label: string;
	views: number;
	uniques: number;
}

export interface AudienceStats {
	uniques: number;
	sessions: number;
	bounces: number;
	bounceRate: number | null;
	avgEngagedMs: number;
	avgScrollPct: number;
	newVisitors: number;
	returningVisitors: number;
}

export interface PeriodSlice {
	from: string;
	to: string;
	views: number;
	uniques: number;
	bots: number;
	avgEngagedMs: number;
	avgScrollPct: number;
	bounceRate: number | null;
}

export interface ArticleCatalogEntry {
	slug: string;
	title: string;
	category: string;
	tags: string[];
	authorId: string;
	authorName: string;
	publishedAt: string;
	words: number;
}

export interface PublishLogRow {
	slug: string;
	title: string;
	publishedAt: string;
	words: number;
	category: string;
	author: string;
	tags: string;
}

export interface StatsQuery {
	from: string | null;
	to: string | null;
	slug: string | null;
}

export interface NewsStatsReport {
	ready: boolean;
	generatedAt: string;
	since: string | null;
	range: { from: string | null; to: string | null };
	truncated: boolean;
	totals: { views: number; last24h: number; last7d: number; botHitsExcluded: number };
	audience: AudienceStats;
	comparison: { current: PeriodSlice; previous: PeriodSlice };
	series: { hour: SeriesPoint[]; day: SeriesPoint[]; week: SeriesPoint[]; month: SeriesPoint[] };
	heatmap: { utc: number[]; karachi: number[] };
	realtime: { views: number; pages: PageCount[] };
	articles: ArticleViewStat[];
	pages: PageCount[];
	topByDay: Array<{ day: string; slug: string; title: string; views: number }>;
	referrers: ReferrerStat[];
	referrerGroups: NamedCount[];
	sources: SourceStat[];
	queries: QueryStat[];
	countries: CountryStat[];
	cities: NamedCount[];
	regions: NamedCount[];
	continents: NamedCount[];
	devices: DeviceStat[];
	browsers: NamedCount[];
	operatingSystems: NamedCount[];
	screens: NamedCount[];
	languages: NamedCount[];
	campaigns: CampaignStat[];
	landing: NamedCount[];
	exit: NamedCount[];
	outbound: ReferrerStat[];
	sourceClicks: ReferrerStat[];
	categories: NamedCount[];
	tags: NamedCount[];
	authors: NamedCount[];
	bots: NamedCount[];
	notFound: NamedCount[];
	feeds: NamedCount[];
	publishLog: PublishLogRow[];
	note: string;
}

export const RAW_RETENTION_DAYS = 90;
export const STATS_NOTE = "Unique visitors are an HMAC-SHA256 of a random per-UTC-day salt, the address, and the user agent. The salt is stored before the hash and is not derived from a token. The cron deletes that salt after the UTC day. Raw events go to Workers Analytics Engine. D1 keeps hourly article rollups. The daily cap counts D1 rows_written, including index rows and prune deletes, and stops at 25,000. Daily tables are kept 400 days. This D1 desk does not compute bounce, so that card stays n/a. An in-memory report still treats a bounce as one human page view inside a 30-minute session.";

const SEARCH_ENGINES: Array<{ name: string; hosts: string[]; keys: string[] }> = [
	{ name: "Google", hosts: ["google.com"], keys: ["q"] },
	{ name: "Bing", hosts: ["bing.com"], keys: ["q"] },
	{ name: "DuckDuckGo", hosts: ["duckduckgo.com"], keys: ["q"] },
	{ name: "Yahoo", hosts: ["yahoo.com", "search.yahoo.com"], keys: ["p"] },
	{ name: "Ecosia", hosts: ["ecosia.org"], keys: ["q"] },
	{ name: "Brave", hosts: ["search.brave.com"], keys: ["q"] },
	{ name: "Startpage", hosts: ["startpage.com"], keys: ["q"] },
	{ name: "Baidu", hosts: ["baidu.com"], keys: ["wd"] },
	{ name: "Yandex", hosts: ["yandex.com", "yandex.ru", "ya.ru"], keys: ["text"] },
	{ name: "Qwant", hosts: ["qwant.com"], keys: ["q"] },
	{ name: "Kagi", hosts: ["kagi.com"], keys: ["q"] },
];

const SOCIAL_HOSTS = [
	"t.co",
	"twitter.com",
	"x.com",
	"facebook.com",
	"fb.com",
	"instagram.com",
	"linkedin.com",
	"lnkd.in",
	"reddit.com",
	"youtube.com",
	"youtu.be",
	"tiktok.com",
	"threads.net",
	"news.ycombinator.com",
	"bsky.app",
	"bsky.social",
	"t.me",
	"telegram.org",
	"whatsapp.com",
	"pinterest.com",
	"snapchat.com",
];

const BOT_PATTERN = /bot|crawler|spider|slurp|mediapartners|facebookexternalhit|embedly|wget|curl\/|python-requests|go-http-client|headless|phantom|selenium|puppeteer|bytespider|gptbot|claudebot|perplexity|semrush|ahrefs|petalbot|applebot|bingpreview|duckduckbot|baiduspider|pingdom|uptimerobot|lighthouse|pagespeed/i;

const BOT_NAMES: Array<[RegExp, string]> = [
	[/googlebot/i, "Googlebot"],
	[/bingbot/i, "Bingbot"],
	[/duckduckbot/i, "DuckDuckBot"],
	[/baiduspider/i, "Baiduspider"],
	[/yandexbot/i, "YandexBot"],
	[/applebot/i, "Applebot"],
	[/gptbot/i, "GPTBot"],
	[/claudebot/i, "ClaudeBot"],
	[/bytespider/i, "Bytespider"],
	[/ahrefsbot/i, "AhrefsBot"],
	[/semrushbot/i, "SemrushBot"],
	[/petalbot/i, "PetalBot"],
	[/twitterbot/i, "Twitterbot"],
	[/facebookexternalhit/i, "Facebook"],
	[/slurp/i, "Yahoo Slurp"],
	[/pingdom/i, "Pingdom"],
	[/uptimerobot/i, "UptimeRobot"],
	[/lighthouse|pagespeed/i, "Lighthouse"],
];

const CONTINENTS: Record<string, string> = {
	AF: "Africa",
	AN: "Antarctica",
	AS: "Asia",
	EU: "Europe",
	NA: "North America",
	OC: "Oceania",
	SA: "South America",
};

const SESSION_GAP_MS = 30 * 60 * 1000;

export function rawRetentionCutoff(now: Date): string {
	return new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s.-])?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}|\+\d{8,15}/g;

/** Drop emails, phone-like strings, and digit runs longer than 6 before storage. */
export function redactContacts(value: string): string {
	return value.replace(EMAIL_RE, "[redacted]").replace(PHONE_RE, (match) => {
		const digits = match.replace(/\D/g, "");
		return digits.length >= 8 && digits.length <= 15 ? "[redacted]" : match;
	}).replace(/\d{7,}/g, "[redacted]");
}

const daySalts = new Map<string, Uint8Array>();

export function clearDaySalts(): void {
	daySalts.clear();
}

/** 32 random bytes from crypto.getRandomValues. Not derived from a token. */
export function randomDaySalt(): Uint8Array {
	const salt = new Uint8Array(32);
	crypto.getRandomValues(salt);
	return salt;
}

export function saltToHex(salt: Uint8Array): string {
	return [...salt].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToSalt(hex: string): Uint8Array | null {
	if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
	const bytes = new Uint8Array(32);
	for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	return bytes;
}

/** Salt already confirmed by persistDaySalt. Does not invent one. */
export function knownDaySalt(day: string): Uint8Array | null {
	return daySalts.get(day) ?? null;
}

/** First path segment only, so a referrer cannot store a long unique path. */
export function firstReferrerSegment(pathname: string): string {
	const segment = pathname.split("?")[0]?.split("/").filter(Boolean)[0] ?? "";
	if (!segment) return "/";
	return `/${segment.replace(/[^\w.~-]/g, "").slice(0, 78)}`;
}

export function rememberDaySalt(day: string, salt: Uint8Array): void {
	if (salt.byteLength === 32) daySalts.set(day, salt);
}

/** HMAC-SHA256(salt, address|userAgent). Empty when the address or salt is missing. */
export function visitorHmac(salt: Uint8Array, address: string, userAgent: string): string {
	if (!address || salt.byteLength === 0) return "";
	return createHmac("sha256", salt).update(`${address}|${userAgent}`).digest("hex");
}

function emptyAudience(): AudienceStats {
	return {
		uniques: 0,
		sessions: 0,
		bounces: 0,
		bounceRate: 0,
		avgEngagedMs: 0,
		avgScrollPct: 0,
		newVisitors: 0,
		returningVisitors: 0,
	};
}

export function emptyStatsReport(now: Date): NewsStatsReport {
	const day = now.toISOString().slice(0, 10);
	const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const prevEnd = new Date(Date.parse(`${weekAgo}T00:00:00.000Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const prevStart = new Date(Date.parse(`${weekAgo}T00:00:00.000Z`) - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	return {
		ready: false,
		generatedAt: now.toISOString(),
		since: null,
		range: { from: null, to: null },
		truncated: false,
		totals: { views: 0, last24h: 0, last7d: 0, botHitsExcluded: 0 },
		audience: emptyAudience(),
		comparison: {
			current: { from: weekAgo, to: day, views: 0, uniques: 0, bots: 0, avgEngagedMs: 0, avgScrollPct: 0, bounceRate: 0 },
			previous: { from: prevStart, to: prevEnd, views: 0, uniques: 0, bots: 0, avgEngagedMs: 0, avgScrollPct: 0, bounceRate: 0 },
		},
		series: { hour: [], day: [], week: [], month: [] },
		heatmap: { utc: Array(24).fill(0), karachi: Array(24).fill(0) },
		realtime: { views: 0, pages: [] },
		articles: [],
		pages: [],
		topByDay: [],
		referrers: [],
		referrerGroups: [],
		sources: [],
		queries: [],
		countries: [],
		cities: [],
		regions: [],
		continents: [],
		devices: [],
		browsers: [],
		operatingSystems: [],
		screens: [],
		languages: [],
		campaigns: [],
		landing: [],
		exit: [],
		outbound: [],
		sourceClicks: [],
		categories: [],
		tags: [],
		authors: [],
		bots: [],
		notFound: [],
		feeds: [],
		publishLog: [],
		note: STATS_NOTE,
	};
}

export function trackedPage(pathname: string): TrackedPage | null {
	if (pathname === "/ai-news") return { slug: "", page: "index" };
	if (pathname === "/ai-news/about") return { slug: "", page: "about" };
	if (pathname === "/ai-news/disclaimer") return { slug: "", page: "disclaimer" };
	const article = /^\/ai-news\/article\/([a-z0-9-]{1,120})$/.exec(pathname);
	if (article?.[1]) return { slug: article[1], page: "article" };
	const section = /^\/ai-news\/(ai|technology|fashion|showbiz)$/.exec(pathname);
	if (section?.[1]) return { slug: "", page: `section:${section[1]}` };
	const author = /^\/ai-news\/author\/([a-z0-9-]{1,80})$/.exec(pathname);
	if (author?.[1]) return { slug: "", page: `author:${author[1]}` };
	return null;
}

export function isFeedPath(pathname: string): boolean {
	return pathname === "/ai-news/feed.xml"
		|| pathname === "/ai-news/atom.xml"
		|| pathname === "/ai-news/sitemap.xml"
		|| pathname === "/ai-news/news-sitemap.xml"
		|| /^\/ai-news\/(ai|technology|fashion|showbiz)\/(feed|atom)\.xml$/.test(pathname);
}

/** Article-shaped misses only. Other unknown paths are not counted. */
export function isTrackedMiss(pathname: string): boolean {
	return /^\/ai-news\/article\/[a-z0-9-]{1,120}$/.test(pathname);
}

function clip(value: string, max: number): string {
	const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
	return cleaned.slice(0, max);
}

function bareHost(hostname: string): string {
	return hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

function hostMatches(host: string, domain: string): boolean {
	const left = bareHost(host);
	const right = bareHost(domain);
	return left === right || left.endsWith(`.${right}`);
}

function googleHost(host: string): boolean {
	const bare = bareHost(host);
	return bare === "google.com"
		|| bare.endsWith(".google.com")
		|| /^google\.[a-z]{2}$/.test(bare)
		|| /^google\.co\.[a-z]{2}$/.test(bare);
}

function searchEngine(host: string): { name: string; keys: string[] } | null {
	if (!host) return null;
	if (googleHost(host)) return { name: "Google", keys: ["q"] };
	const engine = SEARCH_ENGINES.find((entry) => entry.name !== "Google" && entry.hosts.some((domain) => hostMatches(host, domain)));
	return engine ?? null;
}

function socialHost(host: string): boolean {
	return SOCIAL_HOSTS.some((domain) => hostMatches(host, domain));
}

function internalHost(host: string, siteHosts: string[]): boolean {
	return siteHosts.some((candidate) => candidate && hostMatches(host, candidate));
}

function searchMedium(medium: string): boolean {
	return /^(organic|cpc|ppc|paidsearch|search)$/i.test(medium);
}

function socialMedium(medium: string): boolean {
	return /^(social|sm)$/i.test(medium);
}

function engineFromUtm(source: string): string {
	const value = source.toLowerCase();
	if (value.includes("google")) return "Google";
	if (value.includes("bing")) return "Bing";
	if (value.includes("duckduck")) return "DuckDuckGo";
	if (value.includes("yahoo")) return "Yahoo";
	if (value.includes("ecosia")) return "Ecosia";
	if (value.includes("brave")) return "Brave";
	if (value.includes("baidu")) return "Baidu";
	if (value.includes("yandex")) return "Yandex";
	return "";
}

function socialSource(source: string): boolean {
	return /twitter|facebook|instagram|linkedin|reddit|tiktok|youtube|threads|bsky|bluesky|telegram|whatsapp|pinterest|hackernews/i.test(source);
}

function firstParam(url: URL, keys: string[]): string {
	for (const key of keys) {
		const value = url.searchParams.get(key);
		if (value && value.trim()) return clip(value, 120);
	}
	return "";
}

function deviceClass(ua: string): DeviceClass {
	if (/ipad|tablet|playbook|silk|kindle/i.test(ua)) return "tablet";
	if (/mobile|iphone|ipod|windows phone|opera mini|android.+mobile/i.test(ua)) return "mobile";
	if (/android/i.test(ua)) return "tablet";
	if (/windows|macintosh|linux|cros/i.test(ua)) return "desktop";
	return "other";
}

function browserName(ua: string): string {
	if (/edg\//i.test(ua)) return "Edge";
	if (/opr\/|opera/i.test(ua)) return "Opera";
	if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
	if (/firefox|fxios/i.test(ua)) return "Firefox";
	if (/chrome|crios/i.test(ua)) return "Chrome";
	if (/safari|iphone|ipad/i.test(ua)) return "Safari";
	return "Other";
}

function osName(ua: string): string {
	if (/windows/i.test(ua)) return "Windows";
	if (/iphone|ipad|ios/i.test(ua)) return "iOS";
	if (/android/i.test(ua)) return "Android";
	if (/mac os x|macintosh/i.test(ua)) return "macOS";
	if (/cros/i.test(ua)) return "ChromeOS";
	if (/linux/i.test(ua)) return "Linux";
	return "Other";
}

function botNameOf(ua: string, bot: 0 | 1): string {
	if (!bot) return "";
	for (const [pattern, name] of BOT_NAMES) {
		if (pattern.test(ua)) return name;
	}
	return "Other bot";
}

interface CfLocation {
	country?: unknown;
	city?: unknown;
	region?: unknown;
	continent?: unknown;
}

function cfOf(request: Request): CfLocation {
	return (request as Request & { cf?: CfLocation }).cf ?? {};
}

function placeName(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	const cleaned = clip(value, max);
	if (!cleaned || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(cleaned)) return "";
	if (/^[0-9a-f:]+$/i.test(cleaned) && cleaned.includes(":")) return "";
	return cleaned;
}

function textOf(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function countryOf(request: Request): string {
	const value = textOf(cfOf(request).country).toUpperCase();
	if (value === "T1") return value;
	return /^[A-Z]{2}$/.test(value) ? value : "";
}

function languageOf(header: string | null): string {
	const tag = header?.split(",")[0]?.split(";")[0]?.trim() ?? "";
	if (!/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,2}$/.test(tag)) return "";
	return tag.slice(0, 16);
}

function hoursOf(now: Date): { hourUtc: number; hourKarachi: number } {
	const hourUtc = now.getUTCHours();
	return { hourUtc, hourKarachi: (hourUtc + 5) % 24 };
}

function blankVisit(now: Date, tracked: TrackedPage): PageViewEvent {
	const hours = hoursOf(now);
	return {
		viewedAt: now.toISOString(),
		slug: tracked.slug,
		page: tracked.page,
		referrerHost: "",
		referrerPath: "",
		sourceClass: "direct",
		searchEngine: "",
		searchQuery: "",
		utmSource: "",
		utmMedium: "",
		utmCampaign: "",
		utmTerm: "",
		country: "",
		region: "",
		city: "",
		continent: "",
		deviceClass: "other",
		browser: "Other",
		os: "Other",
		screen: "",
		lang: "",
		bot: 0,
		botName: "",
		visitorHash: "",
		hourUtc: hours.hourUtc,
		hourKarachi: hours.hourKarachi,
		eventKind: "view",
		engagedMs: 0,
		scrollPct: 0,
		returning: -1,
		clickHost: "",
		clickPath: "",
		clickKind: "",
	};
}

export function pageViewFromRequest(request: Request, tracked: TrackedPage, now: Date, siteHost: string): PageViewEvent {
	const ua = request.headers.get("user-agent") ?? "";
	const bot: 0 | 1 = BOT_PATTERN.test(ua) ? 1 : 0;
	const device = deviceClass(ua);
	const pageUrl = new URL(request.url);
	const utmSource = clip(redactContacts(pageUrl.searchParams.get("utm_source") ?? ""), 80);
	const utmMedium = clip(redactContacts(pageUrl.searchParams.get("utm_medium") ?? ""), 80);
	const utmCampaign = clip(redactContacts(pageUrl.searchParams.get("utm_campaign") ?? ""), 80);
	const utmTerm = clip(redactContacts(pageUrl.searchParams.get("utm_term") ?? ""), 80);
	const siteHosts = [siteHost, pageUrl.hostname, "3aik.com"];
	const cf = cfOf(request);

	let referrerHost = "";
	let referrerPath = "";
	let engineName = "";
	let referrerQuery = "";
	const referrer = request.headers.get("referer") ?? request.headers.get("referrer") ?? "";
	if (referrer) {
		try {
			const parsed = new URL(referrer);
			if (parsed.protocol === "http:" || parsed.protocol === "https:") {
				referrerHost = clip(parsed.hostname.toLowerCase(), 253);
				referrerPath = firstReferrerSegment(parsed.pathname || "/");
				const engine = searchEngine(referrerHost);
				if (engine) {
					engineName = engine.name;
					referrerQuery = firstParam(parsed, engine.keys);
				}
			}
		} catch {
			referrerHost = "";
			referrerPath = "";
		}
	}

	let sourceClass: SourceClass = "direct";
	if (referrerHost && internalHost(referrerHost, siteHosts)) sourceClass = "internal";
	else if (engineName) sourceClass = "search";
	else if (referrerHost && socialHost(referrerHost)) sourceClass = "social";
	else if (!referrerHost && (searchMedium(utmMedium) || engineFromUtm(utmSource))) sourceClass = "search";
	else if (!referrerHost && (socialMedium(utmMedium) || socialSource(utmSource))) sourceClass = "social";
	else if (referrerHost) sourceClass = "other";
	else if (utmSource || utmMedium || utmCampaign) sourceClass = "other";

	if (!engineName && sourceClass === "search") engineName = engineFromUtm(utmSource);
	let searchQuery = clip(redactContacts(referrerQuery), 80);
	if (!searchQuery && utmTerm && (sourceClass === "search" || searchMedium(utmMedium))) searchQuery = clip(utmTerm, 80);

	const continentCode = textOf(cf.continent).toUpperCase();
	return {
		...blankVisit(now, tracked),
		referrerHost,
		referrerPath,
		sourceClass,
		searchEngine: engineName,
		searchQuery,
		utmSource,
		utmMedium,
		utmCampaign,
		utmTerm,
		country: countryOf(request),
		region: placeName(cf.region, 80),
		city: placeName(cf.city, 80),
		continent: /^[A-Z]{2}$/.test(continentCode) ? continentCode : "",
		deviceClass: device,
		browser: browserName(ua),
		os: osName(ua),
		lang: languageOf(request.headers.get("accept-language")),
		bot,
		botName: botNameOf(ua, bot),
	};
}

export function normalizeEvent(event: PageViewEvent): Required<PageViewEvent> {
	const hours = hoursOf(new Date(event.viewedAt));
	const screen = event.screen === "xs" || event.screen === "sm" || event.screen === "md" || event.screen === "lg" ? event.screen : "";
	const kind = event.eventKind ?? "view";
	const returning = event.returning === 0 || event.returning === 1 ? event.returning : -1;
	const clickKind = event.clickKind === "outbound" || event.clickKind === "source" ? event.clickKind : "";
	return {
		viewedAt: event.viewedAt,
		slug: clip(event.slug, 120),
		page: clip(event.page, 180),
		referrerHost: clip(event.referrerHost, 253),
		referrerPath: event.referrerHost ? firstReferrerSegment(event.referrerPath || "/") : "",
		sourceClass: event.sourceClass,
		searchEngine: clip(event.searchEngine, 40),
		searchQuery: clip(redactContacts(event.searchQuery), 80),
		utmSource: clip(redactContacts(event.utmSource), 80),
		utmMedium: clip(redactContacts(event.utmMedium), 80),
		utmCampaign: clip(redactContacts(event.utmCampaign), 80),
		utmTerm: clip(redactContacts(event.utmTerm), 80),
		country: clip(event.country, 8),
		region: clip(event.region ?? "", 80),
		city: clip(event.city ?? "", 80),
		continent: clip(event.continent ?? "", 8),
		deviceClass: event.deviceClass,
		browser: clip(event.browser ?? "", 40),
		os: clip(event.os ?? "", 40),
		screen,
		lang: clip(event.lang ?? "", 16),
		bot: event.bot === 1 ? 1 : 0,
		botName: clip(event.botName ?? "", 40),
		visitorHash: /^[0-9a-f]{64}$/.test(event.visitorHash ?? "") ? event.visitorHash ?? "" : "",
		hourUtc: Number.isInteger(event.hourUtc) ? (event.hourUtc as number) % 24 : hours.hourUtc,
		hourKarachi: Number.isInteger(event.hourKarachi) ? (event.hourKarachi as number) % 24 : hours.hourKarachi,
		eventKind: kind,
		engagedMs: Math.max(0, Math.min(1_800_000, Math.round(event.engagedMs ?? 0))),
		scrollPct: Math.max(0, Math.min(100, Math.round(event.scrollPct ?? 0))),
		returning,
		clickHost: clip(event.clickHost ?? "", 253),
		clickPath: clickKind ? firstReferrerSegment(event.clickPath || "/") : "",
		clickKind,
	};
}

function kindOf(event: PageViewEvent): EventKind {
	return event.eventKind ?? "view";
}

function inDayRange(iso: string, from: string | null, to: string | null): boolean {
	const day = iso.slice(0, 10);
	if (from && day < from) return false;
	if (to && day > to) return false;
	return true;
}

function matchesSlug(event: PageViewEvent, slug: string | null): boolean {
	if (!slug) return true;
	return event.slug === slug;
}

function pageLabel(page: string, slug: string): string {
	if (page === "article" && slug) return `/ai-news/article/${slug}`;
	if (page === "index") return "/ai-news";
	if (page === "about" || page === "disclaimer") return `/ai-news/${page}`;
	if (page.startsWith("section:")) return `/ai-news/${page.slice("section:".length)}`;
	if (page.startsWith("author:")) return `/ai-news/author/${page.slice("author:".length)}`;
	return page || "/ai-news";
}

function continentLabel(code: string): string {
	return CONTINENTS[code] ? `${CONTINENTS[code]} (${code})` : code;
}

function weekStart(day: string): string {
	const date = new Date(`${day}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime())) return day;
	const weekday = date.getUTCDay();
	const delta = weekday === 0 ? 6 : weekday - 1;
	date.setUTCDate(date.getUTCDate() - delta);
	return date.toISOString().slice(0, 10);
}

function bump(map: Map<string, number>, key: string, amount = 1): void {
	if (!key) return;
	map.set(key, (map.get(key) ?? 0) + amount);
}

function named(map: Map<string, number>, limit = 30): NamedCount[] {
	return [...map.entries()]
		.map(([name, views]) => ({ name, views }))
		.sort((left, right) => right.views - left.views || left.name.localeCompare(right.name))
		.slice(0, limit);
}

function byViews<T extends CountRow>(rows: T[]): T[] {
	return rows.sort((left, right) => right.views - left.views);
}

interface HashHit {
	t: number;
	hash: string;
	day: string;
	label: string;
}

function sessionize(hits: HashHit[]): HashHit[][] {
	const sessions: HashHit[][] = [];
	let openSession: HashHit[] = [];
	const ordered = hits.slice().sort((left, right) => left.hash.localeCompare(right.hash) || left.t - right.t);
	for (const hit of ordered) {
		const prev = openSession[openSession.length - 1];
		const split = !prev || !hit.hash || hit.hash !== prev.hash || hit.t - prev.t > SESSION_GAP_MS;
		if (split) {
			if (openSession.length) sessions.push(openSession);
			openSession = [hit];
		} else openSession.push(hit);
	}
	if (openSession.length) sessions.push(openSession);
	return sessions;
}

function windowMetrics(events: PageViewEvent[], startMs: number, endMs: number, slug: string | null): Omit<PeriodSlice, "from" | "to"> {
	const hashes = new Set<string>();
	const hits: HashHit[] = [];
	let views = 0;
	let bots = 0;
	let engaged = 0;
	let engageN = 0;
	let scroll = 0;
	let scrollN = 0;
	for (const event of events) {
		if (!matchesSlug(event, slug)) continue;
		const at = Date.parse(event.viewedAt);
		if (!Number.isFinite(at) || at < startMs || at >= endMs) continue;
		if (event.bot === 1) {
			bots += 1;
			continue;
		}
		const kind = kindOf(event);
		if (kind === "view") {
			views += 1;
			if (event.visitorHash) hashes.add(`${event.viewedAt.slice(0, 10)}|${event.visitorHash}`);
			hits.push({ t: at, hash: event.visitorHash ?? "", day: event.viewedAt.slice(0, 10), label: pageLabel(event.page, event.slug) });
		} else if (kind === "engage") {
			engaged += event.engagedMs ?? 0;
			engageN += 1;
			scroll += event.scrollPct ?? 0;
			scrollN += 1;
		}
	}
	const sessions = sessionize(hits);
	const bounces = sessions.filter((session) => session.length === 1).length;
	return {
		views,
		uniques: hashes.size,
		bots,
		avgEngagedMs: engageN ? Math.round(engaged / engageN) : 0,
		avgScrollPct: scrollN ? Math.round(scroll / scrollN) : 0,
		bounceRate: sessions.length ? Math.round((1000 * bounces) / sessions.length) / 1000 : 0,
	};
}

export function summarizePageViews(
	events: PageViewEvent[],
	now: Date,
	catalog: Map<string, ArticleCatalogEntry> = new Map(),
	query: StatsQuery = { from: null, to: null, slug: null },
): NewsStatsReport {
	const report = emptyStatsReport(now);
	report.ready = true;
	report.range = { from: query.from, to: query.to };
	const dayCut = now.getTime() - 24 * 60 * 60 * 1000;
	const weekCut = now.getTime() - 7 * 24 * 60 * 60 * 1000;
	const liveCut = now.getTime() - 30 * 60 * 1000;
	const articles = new Map<string, ArticleViewStat>();
	const articleHashes = new Map<string, Set<string>>();
	const articleEngage = new Map<string, { ms: number; n: number; scroll: number; scrollN: number }>();
	const referrers = new Map<string, ReferrerStat>();
	const sources = new Map<string, SourceStat>();
	const queries = new Map<string, QueryStat>();
	const countries = new Map<string, CountryStat>();
	const devices = new Map<string, DeviceStat>();
	const campaigns = new Map<string, CampaignStat>();
	const pages = new Map<string, PageCount>();
	const cities = new Map<string, number>();
	const regions = new Map<string, number>();
	const continents = new Map<string, number>();
	const browsers = new Map<string, number>();
	const systems = new Map<string, number>();
	const screens = new Map<string, number>();
	const languages = new Map<string, number>();
	const categories = new Map<string, number>();
	const tags = new Map<string, number>();
	const authors = new Map<string, number>();
	const bots = new Map<string, number>();
	const notFound = new Map<string, number>();
	const feeds = new Map<string, number>();
	const outbound = new Map<string, ReferrerStat>();
	const sourceClicks = new Map<string, ReferrerStat>();
	const dayArticle = new Map<string, Map<string, number>>();
	const groups = new Map<string, number>();
	const daySeries = new Map<string, { views: number; hashes: Set<string> }>();
	const weekSeries = new Map<string, { views: number; hashes: Set<string> }>();
	const monthSeries = new Map<string, { views: number; hashes: Set<string> }>();
	const hourSeries = new Map<string, { views: number; hashes: Set<string> }>();
	const realtime = new Map<string, PageCount>();
	const humanViews: HashHit[] = [];
	const displayHashes = new Set<string>();
	let since: string | null = null;
	let engagedMs = 0;
	let engageN = 0;
	let scrollSum = 0;
	let scrollN = 0;

	const endDay = query.to ?? now.toISOString().slice(0, 10);
	const hourSpanStart = Date.parse(`${endDay}T00:00:00.000Z`) + 24 * 60 * 60 * 1000 - 48 * 60 * 60 * 1000;

	for (const event of events) {
		const kind = kindOf(event);
		const at = Date.parse(event.viewedAt);
		const day = event.viewedAt.slice(0, 10);
		const visible = inDayRange(event.viewedAt, query.from, query.to) && matchesSlug(event, query.slug);
		if (event.bot === 1) {
			if (visible) {
				report.totals.botHitsExcluded += 1;
				bump(bots, event.botName || "Other bot");
			}
			if (visible && kind === "404") bump(notFound, event.page || "/ai-news");
			if (visible && kind === "feed") bump(feeds, event.page);
			continue;
		}
		if (!visible) continue;
		if (kind === "404") {
			bump(notFound, event.page || "/ai-news");
			continue;
		}
		if (kind === "feed") {
			bump(feeds, event.page);
			continue;
		}
		if (kind === "engage") {
			engagedMs += event.engagedMs ?? 0;
			engageN += 1;
			scrollSum += event.scrollPct ?? 0;
			scrollN += 1;
			if (event.returning === 0) report.audience.newVisitors += 1;
			if (event.returning === 1) report.audience.returningVisitors += 1;
			if (event.screen) bump(screens, event.screen);
			if (event.page === "article" && event.slug) {
				const bucket = articleEngage.get(event.slug) ?? { ms: 0, n: 0, scroll: 0, scrollN: 0 };
				bucket.ms += event.engagedMs ?? 0;
				bucket.n += 1;
				bucket.scroll += event.scrollPct ?? 0;
				bucket.scrollN += 1;
				articleEngage.set(event.slug, bucket);
			}
			continue;
		}
		if (kind === "click") {
			if (event.returning === 0) report.audience.newVisitors += 1;
			if (event.returning === 1) report.audience.returningVisitors += 1;
			const host = event.clickHost ?? "";
			const path = event.clickPath ?? "";
			if (!host) continue;
			const key = `${host}\n${path}`;
			const target = event.clickKind === "source" ? sourceClicks : outbound;
			const row = target.get(key) ?? { host, path, views: 0 };
			row.views += 1;
			target.set(key, row);
			continue;
		}

		const recent = { day: Number.isFinite(at) && at >= dayCut, week: Number.isFinite(at) && at >= weekCut };
		report.totals.views += 1;
		if (recent.day) report.totals.last24h += 1;
		if (recent.week) report.totals.last7d += 1;
		if (!since || event.viewedAt < since) since = event.viewedAt;
		if (event.visitorHash) displayHashes.add(`${day}|${event.visitorHash}`);
		humanViews.push({
			t: Number.isFinite(at) ? at : 0,
			hash: event.visitorHash ?? "",
			day,
			label: pageLabel(event.page, event.slug),
		});

		const addSeries = (map: Map<string, { views: number; hashes: Set<string> }>, key: string) => {
			const row = map.get(key) ?? { views: 0, hashes: new Set<string>() };
			row.views += 1;
			if (event.visitorHash) row.hashes.add(`${day}|${event.visitorHash}`);
			map.set(key, row);
		};
		addSeries(daySeries, day);
		addSeries(weekSeries, weekStart(day));
		addSeries(monthSeries, day.slice(0, 7));
		if (Number.isFinite(at) && at >= hourSpanStart) addSeries(hourSeries, event.viewedAt.slice(0, 13));
		const hourUtc = event.hourUtc ?? new Date(event.viewedAt).getUTCHours();
		const hourKarachi = event.hourKarachi ?? (hourUtc + 5) % 24;
		const utcSlot = report.heatmap.utc[hourUtc];
		const karachiSlot = report.heatmap.karachi[hourKarachi];
		if (utcSlot !== undefined) report.heatmap.utc[hourUtc] = utcSlot + 1;
		if (karachiSlot !== undefined) report.heatmap.karachi[hourKarachi] = karachiSlot + 1;

		const label = pageLabel(event.page, event.slug);
		const pageKey = `${event.page}\n${event.slug}`;
		const pageRow = pages.get(pageKey) ?? { page: event.page, slug: event.slug, label, views: 0 };
		pageRow.views += 1;
		pages.set(pageKey, pageRow);
		if (Number.isFinite(at) && at >= liveCut) {
			const live = realtime.get(pageKey) ?? { page: event.page, slug: event.slug, label, views: 0 };
			live.views += 1;
			realtime.set(pageKey, live);
			report.realtime.views += 1;
		}

		if (event.page === "article" && event.slug) {
			const article = articles.get(event.slug) ?? {
				slug: event.slug,
				title: catalog.get(event.slug)?.title ?? "",
				views: 0,
				last24h: 0,
				last7d: 0,
				uniques: 0,
				avgEngagedMs: 0,
				avgScrollPct: 0,
			};
			article.views += 1;
			if (recent.day) article.last24h += 1;
			if (recent.week) article.last7d += 1;
			articles.set(event.slug, article);
			if (event.visitorHash) {
				const hashes = articleHashes.get(event.slug) ?? new Set<string>();
				hashes.add(`${day}|${event.visitorHash}`);
				articleHashes.set(event.slug, hashes);
			}
			const perDay = dayArticle.get(day) ?? new Map<string, number>();
			perDay.set(event.slug, (perDay.get(event.slug) ?? 0) + 1);
			dayArticle.set(day, perDay);
			const meta = catalog.get(event.slug);
			if (meta) {
				bump(categories, meta.category);
				bump(authors, meta.authorName || meta.authorId);
				for (const tag of meta.tags) bump(tags, tag);
			}
		}
		if (event.page.startsWith("section:")) bump(categories, event.page.slice("section:".length));
		if (event.page.startsWith("author:")) {
			const id = event.page.slice("author:".length);
			const namedAuthor = [...catalog.values()].find((entry) => entry.authorId === id);
			bump(authors, namedAuthor?.authorName || id);
		}
		if (event.referrerHost) {
			const key = `${event.referrerHost}\n${event.referrerPath}`;
			const row = referrers.get(key) ?? { host: event.referrerHost, path: event.referrerPath, views: 0 };
			row.views += 1;
			referrers.set(key, row);
		}
		const group = event.sourceClass === "internal" ? "direct" : event.sourceClass === "other" ? "other sites" : event.sourceClass;
		if (group === "search" || group === "social" || group === "other sites" || group === "direct") bump(groups, group);
		const source = sources.get(event.sourceClass) ?? { source: event.sourceClass, views: 0 };
		source.views += 1;
		sources.set(event.sourceClass, source);
		if (event.searchQuery) {
			const key = `${event.searchEngine}\n${event.searchQuery}`;
			const row = queries.get(key) ?? { engine: event.searchEngine, query: event.searchQuery, views: 0 };
			row.views += 1;
			queries.set(key, row);
		}
		if (event.country) {
			const row = countries.get(event.country) ?? { country: event.country, views: 0 };
			row.views += 1;
			countries.set(event.country, row);
		}
		bump(cities, event.city ?? "");
		bump(regions, event.region ?? "");
		bump(continents, event.continent ? continentLabel(event.continent) : "");
		bump(browsers, event.browser ?? "");
		bump(systems, event.os ?? "");
		bump(languages, event.lang ?? "");
		const device = devices.get(event.deviceClass) ?? { device: event.deviceClass, views: 0 };
		device.views += 1;
		devices.set(event.deviceClass, device);
		if (event.utmSource || event.utmMedium || event.utmCampaign || event.utmTerm) {
			const key = `${event.utmSource}\n${event.utmMedium}\n${event.utmCampaign}\n${event.utmTerm}`;
			const row = campaigns.get(key) ?? {
				source: event.utmSource,
				medium: event.utmMedium,
				campaign: event.utmCampaign,
				term: event.utmTerm,
				views: 0,
			};
			row.views += 1;
			campaigns.set(key, row);
		}
	}

	const sessions = sessionize(humanViews);
	const landing = new Map<string, number>();
	const exit = new Map<string, number>();
	let bounces = 0;
	for (const session of sessions) {
		if (session.length === 1) bounces += 1;
		const first = session[0];
		const last = session[session.length - 1];
		if (first) bump(landing, first.label);
		if (last) bump(exit, last.label);
	}

	for (const [slug, article] of articles) {
		article.uniques = articleHashes.get(slug)?.size ?? 0;
		const engage = articleEngage.get(slug);
		article.avgEngagedMs = engage && engage.n ? Math.round(engage.ms / engage.n) : 0;
		article.avgScrollPct = engage && engage.scrollN ? Math.round(engage.scroll / engage.scrollN) : 0;
	}

	const seriesOf = (map: Map<string, { views: number; hashes: Set<string> }>, limit: number): SeriesPoint[] =>
		[...map.entries()]
			.sort((left, right) => left[0].localeCompare(right[0]))
			.slice(-limit)
			.map(([label, row]) => ({ label, views: row.views, uniques: row.hashes.size }));

	const endMs = Date.parse(`${endDay}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
	const startDay = query.from ?? new Date(endMs - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const startMs = Date.parse(`${startDay}T00:00:00.000Z`);
	const length = Math.max(24 * 60 * 60 * 1000, endMs - startMs);
	const current = windowMetrics(events, startMs, endMs, query.slug);
	const previous = windowMetrics(events, startMs - length, startMs, query.slug);

	report.since = since;
	report.audience.uniques = displayHashes.size;
	report.audience.sessions = sessions.length;
	report.audience.bounces = bounces;
	report.audience.bounceRate = sessions.length ? Math.round((1000 * bounces) / sessions.length) / 1000 : 0;
	report.audience.avgEngagedMs = engageN ? Math.round(engagedMs / engageN) : 0;
	report.audience.avgScrollPct = scrollN ? Math.round(scrollSum / scrollN) : 0;
	report.comparison = {
		current: { from: startDay, to: endDay, ...current },
		previous: {
			from: new Date(startMs - length).toISOString().slice(0, 10),
			to: new Date(startMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
			...previous,
		},
	};
	report.series = {
		hour: seriesOf(hourSeries, 48),
		day: seriesOf(daySeries, 120),
		week: seriesOf(weekSeries, 104),
		month: seriesOf(monthSeries, 36),
	};
	report.realtime.pages = byViews([...realtime.values()]).slice(0, 20);
	report.articles = byViews([...articles.values()]).slice(0, 100);
	report.pages = byViews([...pages.values()]).slice(0, 50);
	report.topByDay = [...dayArticle.entries()]
		.sort((left, right) => right[0].localeCompare(left[0]))
		.slice(0, 45)
		.flatMap(([day, counts]) => {
			const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
			if (!top) return [];
			return [{ day, slug: top[0], title: catalog.get(top[0])?.title ?? "", views: top[1] }];
		});
	report.referrers = byViews([...referrers.values()]).slice(0, 40);
	report.referrerGroups = named(groups, 4);
	report.sources = byViews([...sources.values()]);
	report.queries = byViews([...queries.values()]).slice(0, 40);
	report.countries = byViews([...countries.values()]).slice(0, 40);
	report.cities = named(cities);
	report.regions = named(regions);
	report.continents = named(continents);
	report.devices = byViews([...devices.values()]);
	report.browsers = named(browsers);
	report.operatingSystems = named(systems);
	report.screens = named(screens);
	report.languages = named(languages);
	report.campaigns = byViews([...campaigns.values()]).slice(0, 30);
	report.landing = named(landing);
	report.exit = named(exit);
	report.outbound = byViews([...outbound.values()]).slice(0, 30);
	report.sourceClicks = byViews([...sourceClicks.values()]).slice(0, 30);
	report.categories = named(categories);
	report.tags = named(tags);
	report.authors = named(authors);
	report.bots = named(bots);
	report.notFound = named(notFound);
	report.feeds = named(feeds);
	const published = [...catalog.values()]
		.filter((entry) => !query.slug || entry.slug === query.slug)
		.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
		.slice(0, 100);
	report.publishLog = published.map((entry) => ({
		slug: entry.slug,
		title: entry.title,
		publishedAt: entry.publishedAt,
		words: entry.words,
		category: entry.category,
		author: entry.authorName || entry.authorId,
		tags: entry.tags.join(" "),
	}));
	return report;
}
