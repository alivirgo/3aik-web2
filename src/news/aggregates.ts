/**
 * Bots, 404s, and feed fetches are counted in memory and flushed as daily
 * upserts. A flood becomes a handful of D1 writes per half-minute per isolate
 * instead of one row per request.
 */

export type AggregateKind = "bot" | "miss" | "feed";

interface SqlRunner {
	prepare(sql: string): {
		bind(...binds: unknown[]): { run(): Promise<unknown> };
	};
}

const pending = new Map<string, number>();
let lastFlush = 0;
let flushing = false;
const WINDOW_MS = 30_000;
const MAX_KEYS = 24;

function kindCount(kind: AggregateKind): number {
	let count = 0;
	const prefix = `${kind}\n`;
	for (const key of pending.keys()) {
		if (key.startsWith(prefix)) count += 1;
	}
	return count;
}

export function queueAggregate(kind: AggregateKind, day: string, name: string): void {
	const label = name.replace(/[\r\n]/g, " ").slice(0, 180) || "(unknown)";
	const key = `${kind}\n${day}\n${label}`;
	if (!pending.has(key) && kindCount(kind) >= MAX_KEYS) {
		const other = `${kind}\n${day}\n(other)`;
		pending.set(other, (pending.get(other) ?? 0) + 1);
		return;
	}
	pending.set(key, (pending.get(key) ?? 0) + 1);
}

export async function flushAggregates(db: SqlRunner, force = false): Promise<void> {
	const now = Date.now();
	if (pending.size === 0) return;
	if (flushing) return;
	if (!force && lastFlush !== 0 && now - lastFlush < WINDOW_MS) return;
	flushing = true;
	lastFlush = now;
	const batch = new Map(pending);
	pending.clear();
	try {
		for (const [key, hits] of batch) {
			const split = key.split("\n");
			const kind = split[0];
			const day = split[1];
			const name = split.slice(2).join("\n");
			if (!kind || !day || !name || hits <= 0) continue;
			if (kind === "bot") {
				await db.prepare(
					`INSERT INTO stats_bot_daily (day, bot_name, hits) VALUES (?, ?, ?)
					 ON CONFLICT(day, bot_name) DO UPDATE SET hits = hits + excluded.hits`,
				).bind(day, name, hits).run();
				await db.prepare(
					`INSERT INTO stats_daily (day, views, uniques, bots, engaged_ms, engage_n)
					 VALUES (?, 0, 0, ?, 0, 0)
					 ON CONFLICT(day) DO UPDATE SET bots = bots + excluded.bots`,
				).bind(day, hits).run();
			} else if (kind === "miss") {
				await db.prepare(
					`INSERT INTO stats_miss_daily (day, path, hits) VALUES (?, ?, ?)
					 ON CONFLICT(day, path) DO UPDATE SET hits = hits + excluded.hits`,
				).bind(day, name, hits).run();
			} else if (kind === "feed") {
				await db.prepare(
					`INSERT INTO stats_feed_daily (day, path, hits) VALUES (?, ?, ?)
					 ON CONFLICT(day, path) DO UPDATE SET hits = hits + excluded.hits`,
				).bind(day, name, hits).run();
			}
		}
	} finally {
		flushing = false;
	}
}

export function resetAggregates(): void {
	pending.clear();
	lastFlush = 0;
	flushing = false;
}
