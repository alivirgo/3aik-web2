import type { NewsEnv } from "./config";
import { tokensMatch } from "./ingest";
import type { NamedCount, NewsStatsReport, PageCount, SeriesPoint, StatsQuery } from "./pageviews";
import { emptyStatsReport } from "./pageviews";
import { publicNotFoundResponse } from "./responses";
import type { NewsRepository } from "./repository";
import { escapeHtml } from "./text";

/** SHA-256 hex of the stats bearer. The bearer itself is held offline and is not the ingest token. */
export const NEWS_STATS_DIGEST = "e5c04756be85b8c5d0bcbe3d32ec3778d56a356ce90c2c27faf32536b2c8ba42";

let digestWarned = false;

export function resetStatsDigestWarning(): void {
	digestWarned = false;
}

/** Log once when an override is present but not 64 hex characters, then keep the committed digest. */
export function noteStatsDigest(env: { AI_NEWS_STATS_TOKEN_SHA256?: string }): void {
	const value = env.AI_NEWS_STATS_TOKEN_SHA256?.trim().toLowerCase() ?? "";
	if (!value || /^[0-9a-f]{64}$/.test(value)) return;
	if (digestWarned) return;
	digestWarned = true;
	console.error(JSON.stringify({
		message: "ai-news stats digest override rejected",
		reason: "malformed",
	}));
}

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

export function expectedStatsDigest(override: string | undefined): string {
	const value = override?.trim().toLowerCase() ?? "";
	if (/^[0-9a-f]{64}$/.test(value)) return value;
	if (value) noteStatsDigest({ AI_NEWS_STATS_TOKEN_SHA256: value });
	return NEWS_STATS_DIGEST;
}

async function sha256Hex(value: string): Promise<string> {
	const bounded = value.length > 512 ? `${value.slice(0, 512)}\n` : value;
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bounded));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Header bearer only. The presented bearer is hashed and compared in constant
 * time with the stats digest. The ingest token is not accepted. Credential
 * query keys are rejected even when the header is correct. Cookies are never read.
 */
export async function statsAuthorized(request: Request, env: { AI_NEWS_STATS_TOKEN_SHA256?: string }): Promise<boolean> {
	const digest = await sha256Hex(bearerToken(request.headers.get("authorization")));
	const matches = await tokensMatch(digest, expectedStatsDigest(env.AI_NEWS_STATS_TOKEN_SHA256));
	if (!matches) return false;
	const url = new URL(request.url);
	for (const [key, value] of url.searchParams) {
		if (CREDENTIAL_KEYS.has(key.toLowerCase())) return false;
		if (key !== "from" && key !== "to") return false;
		if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	}
	return true;
}

const MAX_STATS_RANGE_DAYS = 400;

export function statsQueryFromUrl(url: URL, slug: string | null = null, now = new Date()): StatsQuery {
	const date = /^\d{4}-\d{2}-\d{2}$/;
	const rawFrom = url.searchParams.get("from");
	const rawTo = url.searchParams.get("to");
	let from = rawFrom && date.test(rawFrom) ? rawFrom : null;
	let to = rawTo && date.test(rawTo) ? rawTo : null;
	if (!from && !to) return { from, to, slug };
	const today = now.toISOString().slice(0, 10);
	if (!to || to > today) to = today;
	if (from && from > to) from = to;
	const earliest = dayShift(to, -(MAX_STATS_RANGE_DAYS - 1));
	if (!from || from < earliest) from = earliest;
	return { from, to, slug };
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
	headers.set("content-security-policy", "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'");
	return headers;
}

function hiddenNotFound(request: Request, origin: string): Promise<Response> {
	return publicNotFoundResponse(request, origin);
}

function cell(value: string | number): string {
	return `<td>${escapeHtml(String(value))}</td>`;
}

/** Milliseconds as m:ss, or h:mm:ss once an hour is reached. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
	return `${minutes}:${seconds}`;
}

/** Bounce rate is stored as a 0–1 ratio. */
export function formatPercent(rate: number): string {
	const pct = Math.round(rate * 1000) / 10;
	return Number.isInteger(pct) ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
}

function formatCount(value: number): string {
	return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function table(headers: string[], rows: string[]): string {
	if (!rows.length) return "<p class=\"empty\">None yet.</p>";
	const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
	return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function viewCell(value: number, max: number): string {
	const width = max > 0 && value > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
	return `<td class="metric"><span class="metric-n">${formatCount(value)}</span><span class="meter" style="width:${width}%"></span></td>`;
}

function axisLabel(label: string): string {
	if (label.includes("T")) {
		const [day, hour] = label.split("T");
		return `${(day ?? "").slice(5)} ${hour ?? ""}h`;
	}
	if (/^\d{4}-\d{2}$/.test(label)) return label;
	return label.slice(5);
}

function seriesChart(points: SeriesPoint[], label: string): string {
	if (!points.length) return `<p class="empty">None yet.</p>`;
	const width = 760;
	const height = 250;
	const padL = 48;
	const padR = 16;
	const padT = 22;
	const padB = 52;
	const plotW = width - padL - padR;
	const plotH = height - padT - padB;
	const baseline = padT + plotH;
	const max = Math.max(1, ...points.map((point) => Math.max(point.views, point.uniques)));
	const slot = plotW / points.length;
	const barW = Math.min(16, Math.max(3, slot * 0.55));
	const yFor = (value: number) => baseline - (value / max) * plotH;
	const ticks = [0, 0.5, 1].map((share) => Math.round(max * share));
	const grid = ticks.map((tick) => {
		const y = yFor(tick);
		return `<line class="grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="#d5d8de" stroke-width="1"/>
<text class="tick" x="${padL - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#595959" font-size="11">${formatCount(tick)}</text>`;
	}).join("");
	const bars = points.map((point, index) => {
		const x = padL + index * slot + (slot - barW) / 2;
		const y = yFor(point.views);
		const barHeight = Math.max(point.views > 0 ? 2 : 0, baseline - y);
		const value = slot >= 16 ? `<text class="value" x="${(x + barW / 2).toFixed(1)}" y="${Math.max(padT + 10, y - 4).toFixed(1)}" text-anchor="middle" fill="#1a1a1a" font-size="10">${point.views}</text>` : "";
		return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="#1d4f91"><title>${escapeHtml(point.label)}: ${point.views} views, ${point.uniques} uniques</title></rect>${value}`;
	}).join("");
	const line = points.map((point, index) => {
		const x = padL + index * slot + slot / 2;
		return `${x.toFixed(1)},${yFor(point.uniques).toFixed(1)}`;
	}).join(" ");
	const stride = Math.max(1, Math.ceil(points.length / 8));
	const labels = points.map((point, index) => {
		if (index % stride !== 0 && index !== points.length - 1) return "";
		const x = padL + index * slot + slot / 2;
		const text = axisLabel(point.label);
		return `<text class="tick" x="0" y="0" fill="#595959" font-size="11" transform="translate(${x.toFixed(1)} ${baseline + 14}) rotate(40)">${escapeHtml(text)}</text>`;
	}).join("");
	return `<figure class="chart">
<figcaption>${escapeHtml(label)}</figcaption>
<svg role="img" aria-label="${escapeHtml(label)}" viewBox="0 0 ${width} ${height}" width="100%" height="250">
<rect class="plot" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#f4f6f8"/>
${grid}
<line class="axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${baseline}" stroke="#595959" stroke-width="1.25"/>
<line class="axis" x1="${padL}" y1="${baseline}" x2="${width - padR}" y2="${baseline}" stroke="#595959" stroke-width="1.25"/>
${bars}
<polyline class="uniques" fill="none" stroke="#c45c26" stroke-width="2" points="${line}"/>
${labels}
</svg>
<p class="legend"><span class="swatch views"></span> Views <span class="swatch uniques"></span> Uniques</p>
</figure>`;
}

function heatmap(counts: number[], label: string): string {
	const max = Math.max(1, ...counts);
	const cells = counts.map((count, hour) => {
		const shade = Math.round(255 - (count / max) * 180);
		return `<div class="hour" style="background:rgb(${shade},${shade},${Math.min(255, shade + 20)})"><span>${hour}</span><strong>${count}</strong></div>`;
	}).join("");
	return `<div class="heatmap" role="img" aria-label="${escapeHtml(label)}">${cells}</div>`;
}

function namedTable(headers: [string, string], rows: NamedCount[]): string {
	return table(headers, countedRows(rows.map((row) => ({ label: escapeHtml(row.name), views: row.views }))));
}

function pageTable(rows: PageCount[]): string {
	return table(["Page", "Views"], countedRows(rows.map((row) => ({ label: escapeHtml(row.label), views: row.views }))));
}

function dayShift(iso: string, days: number): string {
	const start = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
	return new Date(start + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function deltaLabel(current: number, previous: number, lowerIsBetter = false): { text: string; tone: string } {
	if (previous === 0 && current === 0) return { text: "0% vs previous period", tone: "flat" };
	if (previous === 0) return { text: "New vs previous period", tone: lowerIsBetter ? "down" : "up" };
	const pct = Math.round((((current - previous) / previous) * 100) * 10) / 10;
	const text = `${pct > 0 ? "+" : ""}${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}% vs previous period`;
	const rising = pct > 0;
	const falling = pct < 0;
	const tone = pct === 0 ? "flat" : (lowerIsBetter ? falling : rising) ? "up" : "down";
	return { text, tone };
}

function bounceCard(current: number | null, previous: number | null, bounces: number): string {
	if (current == null || previous == null) {
		return `<article class="kpi"><h2>Bounce</h2><p class="kpi-value">n/a</p><p class="delta flat">Not computed from rollups</p><p class="kpi-sub">Raw sessions are not stored in D1</p></article>`;
	}
	return kpi("Bounce", formatPercent(current), current, previous, `${formatCount(bounces)} single-page sessions`, true);
}

function kpi(label: string, value: string, current: number, previous: number, detail: string, lowerIsBetter = false): string {
	const delta = deltaLabel(current, previous, lowerIsBetter);
	return `<article class="kpi"><h2>${escapeHtml(label)}</h2><p class="kpi-value">${escapeHtml(value)}</p><p class="delta ${delta.tone}">${escapeHtml(delta.text)}</p><p class="kpi-sub">${detail}</p></article>`;
}

function countedRows(rows: Array<{ label: string; views: number; extra?: string[] }>): string[] {
	const max = Math.max(1, ...rows.map((row) => row.views));
	return rows.map((row) => {
		const extra = (row.extra ?? []).map((item) => cell(item)).join("");
		return `<tr><td>${row.label}</td>${extra}${viewCell(row.views, max)}</tr>`;
	});
}

function section(title: string, body: string, open = false): string {
	return `<details class="panel"${open ? " open" : ""}><summary>${escapeHtml(title)}</summary><div class="panel-body">${body}</div></details>`;
}

export function renderStatsDashboard(report: NewsStatsReport, heading = "Newsroom stats", path = "/ai-news/api/stats/dashboard"): string {
	const totals = report.totals;
	const current = report.comparison.current;
	const previous = report.comparison.previous;
	const articleMax = Math.max(1, ...report.articles.map((article) => article.views));
	const rangeQuery = (from: string, to: string) => `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
	const keep = report.range.from && report.range.to ? rangeQuery(report.range.from, report.range.to) : "";
	const articles = report.articles.map((article) => {
		const href = `/ai-news/api/stats/article/${encodeURIComponent(article.slug)}${keep}`;
		const title = article.title || article.slug;
		return `<tr><td><a href="${href}">${escapeHtml(title)}</a></td>${cell(article.slug)}${viewCell(article.views, articleMax)}${cell(formatCount(article.uniques))}${cell(formatCount(article.last24h))}${cell(formatCount(article.last7d))}${cell(formatDuration(article.avgEngagedMs))}${cell(formatPercent(article.avgScrollPct / 100))}</tr>`;
	});
	const referrers = countedRows(report.referrers.map((row) => ({ label: escapeHtml(row.host), extra: [row.path || "/"], views: row.views })));
	const sources = countedRows(report.sources.map((row) => ({ label: escapeHtml(row.source), views: row.views })));
	const queries = countedRows(report.queries.map((row) => ({ label: escapeHtml(row.engine || "utm"), extra: [row.query], views: row.views })));
	const countries = countedRows(report.countries.map((row) => ({ label: escapeHtml(row.country), views: row.views })));
	const devices = countedRows(report.devices.map((row) => ({ label: escapeHtml(row.device), views: row.views })));
	const campaigns = report.campaigns.map((row) => `<tr>${cell(row.source)}${cell(row.medium)}${cell(row.campaign)}${cell(row.term)}${cell(formatCount(row.views))}</tr>`);
	const publish = report.publishLog.map((row) => `<tr>${cell(row.publishedAt)}${cell(row.title)}${cell(row.author)}${cell(row.category)}${cell(row.words)}${cell(row.tags)}</tr>`);
	const topDay = countedRows(report.topByDay.map((row) => ({ label: escapeHtml(row.day), extra: [row.title || row.slug], views: row.views })));
	const since = report.since ? escapeHtml(report.since) : "no views yet";
	const notice = report.ready ? "" : `<p class="warn">Stats storage is not ready. Apply migrations 0006 and 0007, then reload.</p>`;
	const from = report.range.from ?? "";
	const to = report.range.to ?? "";
	const period = `${current.from} to ${current.to}`;
	const cards = [
		kpi("Views", formatCount(current.views), current.views, previous.views, `Last 24 hours: ${formatCount(totals.last24h)}`),
		kpi("Uniques", formatCount(current.uniques), current.uniques, previous.uniques, "Daily hashes, not people"),
		kpi("Avg engaged time", formatDuration(current.avgEngagedMs), current.avgEngagedMs, previous.avgEngagedMs, `Scroll ${current.avgScrollPct}%`),
		kpi("Scroll depth", formatPercent(current.avgScrollPct / 100), current.avgScrollPct, previous.avgScrollPct, "Mean of beacon samples"),
		bounceCard(current.bounceRate, previous.bounceRate, report.audience.bounces),
		kpi("Bot hits", formatCount(current.bots), current.bots, previous.bots, `${formatCount(totals.botHitsExcluded)} excluded from human counts`, true),
	].join("");
	const end = report.generatedAt.slice(0, 10);
	const ranges = [
		["Last 7 days", dayShift(end, -6), end],
		["Last 30 days", dayShift(end, -29), end],
		["Last 90 days", dayShift(end, -89), end],
	] as const;
	const rangeLinks = ranges.map(([label, fromDay, toDay]) => `<a href="${escapeHtml(path)}${rangeQuery(fromDay, toDay)}">${escapeHtml(label)}</a>`).join("");
	const charts = [
		seriesChart(report.series.hour, "Views by hour"),
		seriesChart(report.series.day, "Views by day"),
		seriesChart(report.series.week, "Views by week"),
		seriesChart(report.series.month, "Views by month"),
	].join("");
	const clickTable = (rows: NewsStatsReport["outbound"]) => table(
		["Host", "Path", "Clicks"],
		countedRows(rows.map((row) => ({ label: escapeHtml(row.host), extra: [row.path || "/"], views: row.views }))),
	);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(heading)}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; color: #1a1a1a; background: #f3f5f7; }
main { width: min(76rem, calc(100% - 1.5rem)); margin: 1rem auto 3rem; }
h1 { font-size: 1.55rem; margin: 0 0 0.35rem; }
a { color: #143d66; }
.meta, .note, .kpi-sub { color: #595959; }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; margin: 1rem 0; }
.kpi, .panel, .chart { background: #fff; border: 1px solid #e1e4e8; border-radius: 10px; }
.kpi { padding: 0.85rem 1rem 0.7rem; }
.kpi h2 { margin: 0; font-size: 0.78rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: #595959; }
.kpi-value { margin: 0.2rem 0 0; font-size: 1.7rem; font-weight: 680; letter-spacing: -0.03em; }
.delta { margin: 0.15rem 0 0; font-size: 0.82rem; font-weight: 650; }
.delta.up { color: #0b6b2f; }
.delta.down { color: #9b1c1c; }
.delta.flat { color: #595959; }
.kpi-sub { margin: 0.25rem 0 0; font-size: 0.8rem; }
.ranges { display: flex; flex-wrap: wrap; gap: 0.45rem 0.9rem; margin: 0.4rem 0 0.2rem; }
.ranges a { font-size: 0.9rem; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.chart { padding: 0.4rem 0.6rem 0.2rem; }
.chart figcaption { font-size: 0.85rem; font-weight: 650; }
.legend { color: #595959; font-size: 0.78rem; }
.swatch { display: inline-block; width: 0.7rem; height: 0.7rem; margin: 0 0.2rem 0 0.6rem; vertical-align: -1px; }
.swatch.views { background: #1d4f91; }
.swatch.uniques { background: #c45c26; }
.panel { margin: 0.75rem 0; }
.panel summary { cursor: pointer; padding: 0.75rem 1rem; font-weight: 680; }
.panel-body { padding: 0 1rem 1rem; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid #e6e8eb; vertical-align: middle; }
th { font-size: 0.72rem; letter-spacing: 0.04em; text-transform: uppercase; color: #595959; }
.metric { min-width: 7rem; }
.metric-n { display: inline-block; min-width: 2.4rem; font-variant-numeric: tabular-nums; }
.meter { display: inline-block; height: 0.45rem; margin-left: 0.35rem; background: #1d4f91; border-radius: 99px; vertical-align: middle; }
.warn { background: #fff6e8; border: 1px solid #ecd7b2; padding: 0.6rem 0.75rem; border-radius: 8px; }
.heatmap { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 0.3rem; }
.hour { min-height: 3.1rem; padding: 0.25rem; font-size: 0.72rem; border-radius: 6px; }
.hour strong { display: block; font-size: 0.95rem; }
.empty { color: #595959; }
@media (max-width: 800px) {
  .kpis, .chart-grid { grid-template-columns: 1fr 1fr; }
  .heatmap { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  h1 { font-size: 1.3rem; }
}
@media (max-width: 520px) {
  .kpis { grid-template-columns: 1fr; }
  .chart-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<main>
<p class="meta"><a href="/ai-news/api/stats/dashboard${keep}">Newsroom</a></p>
<h1>${escapeHtml(heading)}</h1>
<p class="meta">Generated ${escapeHtml(report.generatedAt)}. Since ${since}. Period ${escapeHtml(period)} compared with ${escapeHtml(previous.from)} to ${escapeHtml(previous.to)}. Human counts leave bots out.</p>
${notice}
<nav class="ranges" aria-label="Date range">
${rangeLinks}
<a href="${escapeHtml(path)}">All recent</a>
<a href="/ai-news/api/stats.csv${keep}">CSV</a>
</nav>
<p class="note">These are plain GET links. The stats bearer still has to be on the request. It is not read from the query string. ${from || to ? `Showing ${escapeHtml(from || "…")} to ${escapeHtml(to || "…")}.` : ""}</p>
<section class="kpis" aria-label="Summary">${cards}</section>
${section("Views by hour, day, week, and month", `<div class="chart-grid">${charts}</div>`, true)}
${section("Time of day", `<h2>Last 30 minutes</h2>${pageTable(report.realtime.pages)}<h2>Hour of day, UTC</h2>${heatmap(report.heatmap.utc, "Hour of day UTC")}<h2>Hour of day, Asia/Karachi</h2>${heatmap(report.heatmap.karachi, "Hour of day Asia/Karachi")}`, true)}
${section("Articles and pages", `${table(["Title", "Slug", "Views", "Uniques", "24h", "7d", "Engaged", "Scroll"], articles)}${pageTable(report.pages)}${table(["Day", "Article", "Views"], topDay)}`, true)}
${section("Referrers", `${namedTable(["Group", "Views"], report.referrerGroups)}${table(["Host", "Path", "Views"], referrers)}${table(["Source", "Views"], sources)}${table(["Engine", "Query", "Views"], queries)}${table(["Source", "Medium", "Campaign", "Term", "Views"], campaigns)}`)}
${section("Clicks", `${clickTable(report.outbound)}${clickTable(report.sourceClicks)}`)}
${section("Places", `${table(["Country", "Views"], countries)}${namedTable(["City", "Views"], report.cities)}${namedTable(["Region", "Views"], report.regions)}${namedTable(["Continent", "Views"], report.continents)}`)}
${section("Devices and languages", `${table(["Device", "Views"], devices)}${namedTable(["Browser", "Views"], report.browsers)}${namedTable(["OS", "Views"], report.operatingSystems)}${namedTable(["Bucket", "Samples"], report.screens)}${namedTable(["Language", "Views"], report.languages)}${namedTable(["Page", "Sessions"], report.landing)}${namedTable(["Page", "Sessions"], report.exit)}`)}
${section("Sections and bots", `${namedTable(["Category", "Views"], report.categories)}${namedTable(["Tag", "Views"], report.tags)}${namedTable(["Author", "Views"], report.authors)}${namedTable(["Bot", "Hits"], report.bots)}${namedTable(["Path", "Hits"], report.notFound)}${namedTable(["Path", "Fetches"], report.feeds)}`)}
${section("Publish log", table(["Published", "Title", "Author", "Category", "Words", "Tags"], publish))}
<p class="note">${escapeHtml(report.note)} Sessions ${formatCount(report.audience.sessions)}. New ${formatCount(report.audience.newVisitors)}. Returning ${formatCount(report.audience.returningVisitors)}.</p>
</main>
</body>
</html>`;
}

function csvCell(value: string | number): string {
	let raw = String(value);
	if (/^[=+\-@\t\r ]/.test(raw)) raw = `'${raw}`;
	return `"${raw.replaceAll('"', '""')}"`;
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
	const allowed = await statsAuthorized(request, env);
	if (!allowed || (request.method !== "GET" && request.method !== "HEAD")) return await hiddenNotFound(request, origin);
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
		return new Response(renderStatsDashboard(report, heading, path), { status: 200, headers });
	}
	const headers = statsHeaders("application/json; charset=utf-8");
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });
	return new Response(JSON.stringify(report), { status: 200, headers });
}
