/** Stories linked from one index, section, author, or archive page. */
export const LIST_PAGE_SIZE = 20;

/** Missing means page 1. Anything that is not a plain positive integer is invalid. */
export function parsePageParam(raw: string | null): number | "missing" | "invalid" {
	if (raw === null || raw === "") return "missing";
	if (!/^[1-9]\d{0,4}$/.test(raw)) return "invalid";
	const page = Number(raw);
	return Number.isSafeInteger(page) ? page : "invalid";
}

export function pageCount(total: number, size = LIST_PAGE_SIZE): number {
	if (!Number.isFinite(total) || total <= 0) return 1;
	return Math.ceil(total / size);
}

/** Page 1 has no query. Later pages use `?page=N`. */
export function pageHref(base: string, page: number): string {
	return page <= 1 ? base : `${base}?page=${page}`;
}
