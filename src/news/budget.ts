import type { Env } from "../types";

/** D1 stats row writes allowed per UTC day. Ingest and the publish cron stay outside this cap. */
export const STATS_DAILY_WRITE_CAP = 25_000;

export interface StatsBudget {
	take(cost: number, day: string): Promise<boolean>;
}

/**
 * One SQLite Durable Object for the whole account. The counter is not a D1 row,
 * so the cap itself cannot consume the Free plan's 100k daily row writes.
 * `new_sqlite_classes` needs no dashboard step. The class uses the fetch
 * handler so it matches this worker's generated runtime types.
 */
export class NewsStatsBudget {
	private readonly ready: Promise<void>;

	constructor(private readonly state: DurableObjectState, _env: Env) {
		this.ready = this.state.blockConcurrencyWhile(async () => {
			this.state.storage.sql.exec(
				"CREATE TABLE IF NOT EXISTS stats_budget (day TEXT PRIMARY KEY, writes INTEGER NOT NULL)",
			);
		});
	}

	async fetch(request: Request): Promise<Response> {
		await this.ready;
		let cost = 1;
		let day = "";
		try {
			const body = await request.json() as { cost?: unknown; day?: unknown };
			cost = typeof body.cost === "number" ? body.cost : 1;
			day = typeof body.day === "string" ? body.day : "";
		} catch {
			return Response.json({ ok: false });
		}
		return Response.json({ ok: this.reserve(cost, day) });
	}

	private reserve(cost: number, day: string): boolean {
		const amount = Math.max(1, Math.min(2, Math.floor(cost)));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
		const current = this.current(day);
		if (current + amount > STATS_DAILY_WRITE_CAP) return false;
		this.state.storage.sql.exec(
			`INSERT INTO stats_budget (day, writes) VALUES (?, ?)
			 ON CONFLICT(day) DO UPDATE SET writes = writes + excluded.writes`,
			day,
			amount,
		);
		return true;
	}

	private current(day: string): number {
		const step = this.state.storage.sql.exec<{ writes: number }>(
			"SELECT writes FROM stats_budget WHERE day = ?",
			day,
		).next();
		if (step.done || !step.value) return 0;
		const value = Number(step.value.writes);
		return Number.isFinite(value) ? value : 0;
	}
}

export async function takeStatsBudget(namespace: DurableObjectNamespace, cost: number, day: string): Promise<boolean> {
	const stub = namespace.get(namespace.idFromName("ai-news-stats"));
	const response = await stub.fetch("https://stats-budget.internal/take", {
		method: "POST",
		body: JSON.stringify({ cost, day }),
	});
	if (!response.ok) return false;
	const body = await response.json() as { ok?: boolean };
	return body.ok === true;
}
