import type { Category } from "./types";
import { DURABLE_CATEGORIES } from "./types";
import { isCategory } from "./text";

export const BREAKING_WINDOW_MS = 6 * 60 * 60 * 1000;

export function isDurableCategory(value: string): value is Category {
	return (DURABLE_CATEGORIES as readonly string[]).includes(value);
}

export function breakingCutoff(now: number): string {
	return new Date(now - BREAKING_WINDOW_MS).toISOString();
}

/** Breaking stays on the Breaking desk for six hours, then reads as its section. */
export function visibleCategory(article: { category: Category; section?: string; publishedAt: string }, now = Date.now()): Category {
	if (article.category !== "breaking") return article.category;
	const section = article.section ?? "";
	if (!isDurableCategory(section) || !isCategory(section)) return "breaking";
	const published = Date.parse(article.publishedAt);
	if (!Number.isFinite(published) || now - published < BREAKING_WINDOW_MS) return "breaking";
	return section;
}

export function readLabel(count: number): string {
	const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
	if (safe < 1000) return `${safe} ${safe === 1 ? "read" : "reads"}`;
	if (safe < 1_000_000) {
		const value = safe / 1000;
		const text = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
		return `${text}K reads`;
	}
	const value = safe / 1_000_000;
	const text = value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
	return `${text}M reads`;
}
