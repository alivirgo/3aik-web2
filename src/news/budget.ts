import type { Env } from "../types";

/**
 * D1 `meta.rows_written` charged per UTC day, including index rows and prune deletes.
 * Ingest, publishing, and runtime_lock stay outside this cap.
 */
export const STATS_DAILY_WRITE_CAP = 25_000;

export interface StatsBudget {
	/** False once this UTC day has reached the cap. */
	open(day: string): Promise<boolean>;
	/** Add D1 meta.rows_written from a stats statement or a prune delete. */
	charge(rows: number, day: string): Promise<void>;
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
		let op = "";
		let rows = 0;
		let day = "";
		try {
			const body = await request.json() as { op?: unknown; rows?: unknown; day?: unknown };
			op = typeof body.op === "string" ? body.op : "";
			rows = typeof body.rows === "number" ? body.rows : 0;
			day = typeof body.day === "string" ? body.day : "";
		} catch {
			return Response.json({ ok: false });
		}
		if (op === "charge") return Response.json({ ok: this.charge(rows, day) });
		return Response.json({ ok: this.open(day) });
	}

	private open(day: string): boolean {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
		return this.current(day) < STATS_DAILY_WRITE_CAP;
	}

	/** Records rows already written. A charge may cross the cap; the next open() is then false. */
	private charge(rows: number, day: string): boolean {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
		const amount = Math.floor(rows);
		if (Number.isFinite(amount) && amount > 0) {
			this.state.storage.sql.exec(
				`INSERT INTO stats_budget (day, writes) VALUES (?, ?)
				 ON CONFLICT(day) DO UPDATE SET writes = writes + excluded.writes`,
				day,
				Math.min(amount, 100_000),
			);
		}
		return this.open(day);
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

async function budgetFetch(namespace: DurableObjectNamespace, body: { op: string; day: string; rows?: number }): Promise<boolean> {
	try {
		const stub = namespace.get(namespace.idFromName("ai-news-stats"));
		const response = await stub.fetch("https://stats-budget.internal/", {
			method: "POST",
			body: JSON.stringify(body),
		});
		if (!response.ok) return false;
		const payload = await response.json() as { ok?: boolean };
		return payload.ok !== false;
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news stats budget failed",
			error: error instanceof Error ? error.message : "budget",
		}));
		return false;
	}
}

export function statsBudgetOpen(namespace: DurableObjectNamespace, day: string): Promise<boolean> {
	return budgetFetch(namespace, { op: "open", day });
}

export async function statsBudgetCharge(namespace: DurableObjectNamespace, rows: number, day: string): Promise<void> {
	await budgetFetch(namespace, { op: "charge", rows, day });
}
