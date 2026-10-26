/**
 * Per-client limits for collect, human views, and bot/404/feed counters.
 *
 * A per-isolate token bucket does not bound this worker. Isolates do not share
 * memory, and the script runs in many Cloudflare locations. The limit below is
 * the Workers Rate Limiting binding (`NEWS_STATS_RATE_LIMITER` in
 * wrangler.jsonc). That binding is free, needs no dashboard namespace, and
 * counts per key inside each location. It is approximate: a location can run
 * slightly over the configured limit while counts catch up. It is not a global
 * daily cap. The global cap is `NewsStatsBudget` (25,000 D1 stats row writes
 * per UTC day).
 *
 * The key is a SHA-256 of cf-connecting-ip, kept only for the `limit()` call.
 * It is not written to D1, Analytics Engine, or logs.
 */

export type StatsLane = "collect" | "view" | "counter";

export async function clientRateKey(ip: string): Promise<string> {
	const material = new TextEncoder().encode(`3aik-news-rl\n${ip || "anon"}`);
	const digest = await crypto.subtle.digest("SHA-256", material);
	return [...new Uint8Array(digest).subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** False when the binding is missing, so a deploy without it cannot write without a limit. */
export async function allowStatsLane(limiter: RateLimit | undefined, ip: string, lane: StatsLane): Promise<boolean> {
	if (!limiter) return false;
	const key = await clientRateKey(ip);
	const result = await limiter.limit({ key: `${lane}:${key}` });
	return result.success;
}
