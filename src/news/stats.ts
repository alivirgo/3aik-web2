import type { NewsEnv } from "./config";
import { tokensMatch } from "./ingest";
import { renderNotFound } from "./html";
import type { NamedCount, NewsStatsReport, PageCount, SeriesPoint, StatsQuery } from "./pageviews";
import { emptyStatsReport } from "./pageviews";
import type { NewsRepository } from "./repository";
import { escapeHtml } from "./text";

const CREDENTIAL_KEYS = new Set(["token", "access_token", "auth", "key", "secret", "bearer", "password", "apikey", "api_key"]);

export function isNewsStatsPath(pathname: string): boolean {
	const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
	return path === "/ai-news/api/stats"
		|| path === "/ai-news/api/stats.csv"
		|| path === "/ai-news/api/stats/dashboard"
		|| /^\/ai-news\/api\/stats\/article\/[a-z0-9-]{1,120}$/.test(path);
}

function bearerToken(header: string | null): string {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
	return match?.[1] ?? "";
}

/**
 * Header bearer only. Credential query keys and the token value are rejected
 * even when the header is correct. Date filters `from` and `to` are allowed.
 * Cookies are never read.
 */
export async function statsAuthorized(request: Request, secret: string | undefined): Promise<boolean> {
	const url = new URL(request.url);
	const provided = bearerToken(request.headers.get("authorization"));
	const expected = secret?.trim() || "\u0000";
	const matches = await tokensMatch(provided, expected);
	if (!secret?.trim() || !matches) return false;
	const token = secret.trim();
	for (const [key, value] of url.searchParams) {
		if (CREDENTIAL_KEYS.has(key.toLowerCase())) return false;
		if (value.includes(token)) return false;
		if (key !== "from" && key !== "to") return false;
	}
	return true;
}

export function statsQueryFromUrl(url: URL, slug: string | null = null): StatsQuery {
	const date = /^\d{4}-\d{2}-\d{2}$/;
	const from = url.searchParams.get("from");
	const to = url.searchParams.get("to");
	return {
		from: from && date.test(from) ? from : null,
		to: to && date.test(to) ? to : null,
		slug,
	};
}

function statsHeaders(contentType: string): Headers {
	const headers = new Headers();
	headers.set("content-type", contentType);
	headers.set("cache-control", "private, no-store");
	headers.set("cdn-cache-control", "no-store");
	headers.set("cloudflare-cdn-cache-control", "no-store");
	headers.set("pragma", "no-cache");
	headers.set("x-robots-tag", "noindex, nofollow");
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	headers.set("referrer-policy", "no-referrer");
	headers.set("content-security-policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'");
	return headers;
}

function hiddenNotFound(request: Request, origin: string): Response {
	const headers = statsHeaders("text/html; charset=utf-8");
	if (request.method === "HEAD") return new Response(null, { status: 404, headers });
	return new Response(renderNotFound(origin), { status: 404, headers });
}

function cell(value: string | number): string {
	return `<td>${escapeHtml(String(value))}</td>`;
}

function table(headers: string[], rows: string[]): string {
	if (!rows.length) return "<p>None yet.</p>";
	const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
	return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function barChart(points: SeriesPoint[], label: string): string {
	if (!points.length) return "<p>None yet.</p>";
	const width = 720;
	const height = 168;
	const max = Math.max(1, ...points.map((point) => point.views));
	const bar = Math.max(1, (width - 16) / points.length);
	const bars = points.map((point, index) => {
		const barHeight = Math.round((point.views / max) * (height - 28));
		const x = 8 + index * bar;
		const y = height - 18 - barHeight;
		return `<rect x="${x.toFixed(1)}" y="${y}" width="${Math.max(1, bar - 2).toFixed(1)}" height="${barHeight}" fill="#143d66"><title>${escapeHtml(point.label)}: ${point.views} views, ${point.uniques} uniques</title></rect>`;
	}).join("");
	return `<svg role="img" aria-label="${escapeHtml(label)}" viewBox="0 0 ${width} ${height}" width="100%" height="168">${bars}</svg>`;
}

function heatmap(counts: number[], label: string): string {
	const max = Math.max(1, ...counts);
	const cells = counts.map((count, hour) => {
		const shade = Math.round(255 - (count / max) * 180);
		return `<div class="hour" style="background:rgb(${shade},${shade},${Math.min(255, shade + 20)})"><span>${hour}</span><strong>${count}</strong></div>`;
	}).join("");
	return `<div class="heatmap" role="img" aria-label="${escapeHtml(label)}">${cells}</div>`;
}

function namedRows(rows: NamedCount[]): string[] {
	return rows.map((row) => `<tr>${cell(row.name)}${cell(row.views)}</tr>`);
}

function pageRows(rows: PageCount[]): string[] {
	return rows.map((row) => `<tr>${cell(row.label)}${cell(row.views)}</tr>`);
}

export function renderStatsDashboard(report: NewsStatsReport, heading = "Newsroom stats"): string {
	const totals = report.totals;
	const audience = report.audience;
	const articles = report.articles.map((article) => {
		const href = `/ai-news/api/stats/article/${encodeURIComponent(article.slug)}`;
		const title = article.title || article.slug;
		return `<tr><td><a href="${href}">${escapeHtml(title)}</a></td>${cell(article.slug)}${cell(article.views)}${cell(article.uniques)}${cell(article.last24h)}${cell(article.last7d)}${cell(article.avgEngagedMs)}${cell(article.avgScrollPct)}</tr>`;
	});
	const referrers = report.referrers.map((row) => `<tr>${cell(row.host)}${cell(row.path || "/")}${cell(row.views)}</tr>`);
	const sources = report.sources.map((row) => `<tr>${cell(row.source)}${cell(row.views)}</tr>`);
	const queries = report.queries.map((row) => `<tr>${cell(row.engine || "utm")}${cell(row.query)}${cell(row.views)}</tr>`);
	const countries = report.countries.map((row) => `<tr>${cell(row.country)}${cell(row.views)}</tr>`);
	const devices = report.devices.map((row) => `<tr>${cell(row.device)}${cell(row.views)}</tr>`);
	const campaigns = report.campaigns.map((row) => `<tr>${cell(row.source)}${cell(row.medium)}${cell(row.campaign)}${cell(row.term)}${cell(row.views)}</tr>`);
	const clicks = (rows: NewsStatsReport["outbound"]) => rows.map((row) => `<tr>${cell(row.host)}${cell(row.path || "/")}${cell(row.views)}</tr>`);
	const publish = report.publishLog.map((row) => `<tr>${cell(row.publishedAt)}${cell(row.title)}${cell(row.author)}${cell(row.category)}${cell(row.words)}${cell(row.tags)}</tr>`);
	const topDay = report.topByDay.map((row) => `<tr>${cell(row.day)}${cell(row.title || row.slug)}${cell(row.views)}</tr>`);
	const since = report.since ? escapeHtml(report.since) : "no views yet";
	const notice = report.ready ? "" : `<p class="warn">Stats storage is not ready. Apply migrations 0004 and 0005, then reload.</p>`;
	const truncated = report.truncated ? `<p class="warn">This range was capped at the newest 20,000 raw events. Older detail has been rolled into daily totals.</p>` : "";
	const from = report.range.from ?? "";
	const to = report.range.to ?? "";
	const current = report.comparison.current;
	const previous = report.comparison.previous;
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(heading)}</title>
<style>
body { margin: 0; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; background: #fff; }
main { width: min(76rem, calc(100% - 2rem)); margin: 1.5rem auto 3rem; }
h1 { font-size: 1.6rem; margin: 0 0 0.4rem; }
h2 { font-size: 1rem; margin: 1.6rem 0 0.4rem; }
p, td, th { color: #1a1a1a; }
a { color: #143d66; }
.meta, .note { color: #595959; font-size: 0.85rem; }
table { width: 100%; border-collapse: collapse; margin: 0 0 0.5rem; }
th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #e4e4e4; vertical-align: top; }
th { font-size: 0.75rem; letter-spacing: 0.04em; text-transform: uppercase; color: #595959; }
.warn { background: #f7f4ef; padding: 0.6rem 0.75rem; }
form { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; margin: 0.8rem 0 0.2rem; }
label { font-size: 0.85rem; color: #595959; display: grid; gap: 0.2rem; }
input { font: inherit; color: #1a1a1a; border: 1px solid #c8c8c8; padding: 0.3rem 0.4rem; }
button { font: inherit; background: #143d66; color: #fff; border: 0; padding: 0.4rem 0.7rem; }
.charts { display: grid; gap: 1rem; }
.heatmap { display: grid; grid-template-columns: repeat(12, 1fr); gap: 0.25rem; }
.hour { min-height: 3.2rem; padding: 0.25rem; font-size: 0.75rem; }
.hour strong { display: block; font-size: 0.95rem; }
@media (max-width: 720px) { .heatmap { grid-template-columns: repeat(6, 1fr); } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading)}</h1>
<p class="meta">Generated ${escapeHtml(report.generatedAt)}. Since ${since}. Human counts leave bots out. Bot hits are listed in their own table.</p>
${notice}
${truncated}
<form method="get">
<label>From <input name="from" type="date" value="${escapeHtml(from)}"></label>
<label>To <input name="to" type="date" value="${escapeHtml(to)}"></label>
<button type="submit">Apply range</button>
</form>
<p class="note">Send the same Authorization bearer header again with this filtered URL. The token is not read from the query string. CSV: <code>/ai-news/api/stats.csv</code></p>
<h2>Totals</h2>
<table><tbody>
<tr><th>Views</th>${cell(totals.views)}</tr>
<tr><th>Unique visitors</th>${cell(audience.uniques)}</tr>
<tr><th>Last 24 hours</th>${cell(totals.last24h)}</tr>
<tr><th>Last 7 days</th>${cell(totals.last7d)}</tr>
<tr><th>Last 30 minutes</th>${cell(report.realtime.views)}</tr>
<tr><th>Sessions</th>${cell(audience.sessions)}</tr>
<tr><th>Single-page sessions</th>${cell(audience.bounces)}</tr>
<tr><th>Bounce rate</th>${cell(audience.bounceRate)}</tr>
<tr><th>Average engaged time (ms)</th>${cell(audience.avgEngagedMs)}</tr>
<tr><th>Average scroll depth (%)</th>${cell(audience.avgScrollPct)}</tr>
<tr><th>New (flagged)</th>${cell(audience.newVisitors)}</tr>
<tr><th>Returning (flagged)</th>${cell(audience.returningVisitors)}</tr>
<tr><th>Bot hits excluded</th>${cell(totals.botHitsExcluded)}</tr>
</tbody></table>
<h2>Period comparison</h2>
<table><thead><tr><th></th><th>From</th><th>To</th><th>Views</th><th>Uniques</th></tr></thead><tbody>
<tr>${cell("This period")}${cell(current.from)}${cell(current.to)}${cell(current.views)}${cell(current.uniques)}</tr>
<tr>${cell("Previous period")}${cell(previous.from)}${cell(previous.to)}${cell(previous.views)}${cell(previous.uniques)}</tr>
</tbody></table>
<h2>Views by hour</h2>
${barChart(report.series.hour, "Views by hour")}
<h2>Views by day</h2>
${barChart(report.series.day, "Views by day")}
<h2>Views by week</h2>
${barChart(report.series.week, "Views by week")}
<h2>Views by month</h2>
${barChart(report.series.month, "Views by month")}
<h2>Last 30 minutes</h2>
${table(["Page", "Views"], pageRows(report.realtime.pages))}
<h2>Hour of day, UTC</h2>
${heatmap(report.heatmap.utc, "Hour of day UTC")}
<h2>Hour of day, Asia/Karachi</h2>
${heatmap(report.heatmap.karachi, "Hour of day Asia/Karachi")}
<h2>Articles</h2>
${table(["Title", "Slug", "Views", "Uniques", "24h", "7d", "Engaged ms", "Scroll %"], articles)}
<h2>Top pages</h2>
${table(["Page", "Views"], pageRows(report.pages))}
<h2>Top article by day</h2>
${table(["Day", "Article", "Views"], topDay)}
<h2>Referrer groups</h2>
${table(["Group", "Views"], namedRows(report.referrerGroups))}
<h2>Referrers</h2>
${table(["Host", "Path", "Views"], referrers)}
<h2>Landing sources</h2>
${table(["Source", "Views"], sources)}
<h2>Search queries</h2>
${table(["Engine", "Query", "Views"], queries)}
<h2>Campaigns</h2>
${table(["Source", "Medium", "Campaign", "Term", "Views"], campaigns)}
<h2>Outbound link clicks</h2>
${table(["Host", "Path", "Clicks"], clicks(report.outbound))}
<h2>Source link clicks</h2>
${table(["Host", "Path", "Clicks"], clicks(report.sourceClicks))}
<h2>Countries</h2>
${table(["Country", "Views"], countries)}
<h2>Cities</h2>
${table(["City", "Views"], namedRows(report.cities))}
<h2>Regions</h2>
${table(["Region", "Views"], namedRows(report.regions))}
<h2>Continents</h2>
${table(["Continent", "Views"], namedRows(report.continents))}
<h2>Devices</h2>
${table(["Device", "Views"], devices)}
<h2>Browsers</h2>
${table(["Browser", "Views"], namedRows(report.browsers))}
<h2>Operating systems</h2>
${table(["OS", "Views"], namedRows(report.operatingSystems))}
<h2>Screen size</h2>
${table(["Bucket", "Samples"], namedRows(report.screens))}
<h2>Languages</h2>
${table(["Language", "Views"], namedRows(report.languages))}
<h2>Landing pages</h2>
${table(["Page", "Sessions"], namedRows(report.landing))}
<h2>Exit pages</h2>
${table(["Page", "Sessions"], namedRows(report.exit))}
<h2>Categories</h2>
${table(["Category", "Views"], namedRows(report.categories))}
<h2>Tags</h2>
${table(["Tag", "Views"], namedRows(report.tags))}
<h2>Authors</h2>
${table(["Author", "Views"], namedRows(report.authors))}
<h2>Bot traffic</h2>
${table(["Bot", "Hits"], namedRows(report.bots))}
<h2>Not found under /ai-news</h2>
${table(["Path", "Hits"], namedRows(report.notFound))}
<h2>RSS and sitemaps</h2>
${table(["Path", "Fetches"], namedRows(report.feeds))}
<h2>Publish log</h2>
${table(["Published", "Title", "Author", "Category", "Words", "Tags"], publish)}
<p class="note">${escapeHtml(report.note)}</p>
</main>
</body>
</html>`;
}

function csvCell(value: string | number): string {
	const raw = String(value);
	const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function renderStatsCsv(report: NewsStatsReport): string {
	const lines = ["section,label,detail,views,uniques"];
	const push = (section: string, label: string, detail: string, views: number, uniques: number | string = "") => {
		lines.push([section, label, detail, views, uniques].map((value) => csvCell(value)).join(","));
	};
	push("totals", "views", "", report.totals.views, report.audience.uniques);
	push("totals", "last_24h", "", report.totals.last24h);
	push("totals", "last_7d", "", report.totals.last7d);
	push("totals", "last_30m", "", report.realtime.views);
	push("totals", "sessions", "", report.audience.sessions);
	push("totals", "bounces", "", report.audience.bounces);
	push("totals", "bot_hits", "", report.totals.botHitsExcluded);
	push("comparison", "current", `${report.comparison.current.from} ${report.comparison.current.to}`, report.comparison.current.views, report.comparison.current.uniques);
	push("comparison", "previous", `${report.comparison.previous.from} ${report.comparison.previous.to}`, report.comparison.previous.views, report.comparison.previous.uniques);
	for (const row of report.articles) push("article", row.slug, row.title, row.views, row.uniques);
	for (const row of report.pages) push("page", row.label, row.page, row.views);
	for (const row of report.referrerGroups) push("referrer_group", row.name, "", row.views);
	for (const row of report.referrers) push("referrer", row.host, row.path, row.views);
	for (const row of report.sources) push("source", row.source, "", row.views);
	for (const row of report.queries) push("query", row.query, row.engine, row.views);
	for (const row of report.countries) push("country", row.country, "", row.views);
	for (const row of report.cities) push("city", row.name, "", row.views);
	for (const row of report.regions) push("region", row.name, "", row.views);
	for (const row of report.continents) push("continent", row.name, "", row.views);
	for (const row of report.devices) push("device", row.device, "", row.views);
	for (const row of report.browsers) push("browser", row.name, "", row.views);
	for (const row of report.operatingSystems) push("os", row.name, "", row.views);
	for (const row of report.screens) push("screen", row.name, "", row.views);
	for (const row of report.languages) push("language", row.name, "", row.views);
	for (const row of report.outbound) push("outbound", row.host, row.path, row.views);
	for (const row of report.sourceClicks) push("source_click", row.host, row.path, row.views);
	for (const row of report.landing) push("landing", row.name, "", row.views);
	for (const row of report.exit) push("exit", row.name, "", row.views);
	for (const row of report.categories) push("category", row.name, "", row.views);
	for (const row of report.tags) push("tag", row.name, "", row.views);
	for (const row of report.authors) push("author", row.name, "", row.views);
	for (const row of report.bots) push("bot", row.name, "", row.views);
	for (const row of report.notFound) push("not_found", row.name, "", row.views);
	for (const row of report.feeds) push("feed", row.name, "", row.views);
	for (const row of report.series.day) push("day", row.label, "", row.views, row.uniques);
	for (const row of report.publishLog) push("publish", row.slug, `${row.publishedAt} ${row.words} ${row.author}`, 0);
	return `${lines.join("\n")}\n`;
}

function articleSlug(pathname: string): string | null {
	return /^\/ai-news\/api\/stats\/article\/([a-z0-9-]{1,120})$/.exec(pathname)?.[1] ?? null;
}

export async function handleNewsStatsRequest(request: Request, env: NewsEnv, repo: NewsRepository | null, origin: string, now = new Date()): Promise<Response> {
	const allowed = await statsAuthorized(request, env.AI_NEWS_INGEST_TOKEN);
	if (!allowed || (request.method !== "GET" && request.method !== "HEAD")) return hiddenNotFound(request, origin);
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/$/, "") || "/";
	const slug = articleSlug(path);
	const query = statsQueryFromUrl(url, slug);
	let report = emptyStatsReport(now);
	if (repo) {
		try {
			report = await repo.pageViewReport(now, query);
		} catch (error) {
			console.error(JSON.stringify({
				message: "ai-news stats failed",
				error: error instanceof Error ? error.message : "stats",
			}));
			report = emptyStatsReport(now);
		}
	}
	if (path.endsWith("/stats.csv")) {
		const headers = statsHeaders("text/csv; charset=utf-8");
		headers.set("content-disposition", "attachment; filename=\"ai-news-stats.csv\"");
		if (request.method === "HEAD") return new Response(null, { status: 200, headers });
		return new Response(renderStatsCsv(report), { status: 200, headers });
	}
	if (path.endsWith("/dashboard") || slug) {
		const headers = statsHeaders("text/html; charset=utf-8");
		if (request.method === "HEAD") return new Response(null, { status: 200, headers });
		const heading = slug ? `Article stats: ${slug}` : "Newsroom stats";
		return new Response(renderStatsDashboard(report, heading), { status: 200, headers });
	}
	const headers = statsHeaders("application/json; charset=utf-8");
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(JSON.stringify(report), { status: 200, headers });
}
