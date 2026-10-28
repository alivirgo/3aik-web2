import { commitImageFile, deleteImageFile, isGitHubImagePath, readerImageUrl, type GitHubWriteResult } from "./github-images";
import type { LeadVariant } from "./image-crop";
import { imageDimensions } from "./text";

export const PRIMARY_SUFFIX = "-16x9.webp";
const VARIANT_SUFFIX = /-(16x9-1200|16x9-800|16x9|4x3|1x1)\.webp$/;
const RESIZE_QUERY = new Set(["w", "h", "width", "height", "fit", "crop", "resize", "q", "quality", "dpr"]);

export interface StoredLead {
	imageKey: string;
	imageCommit: string;
	imageType: string;
	pause: boolean;
}

const EMPTY_LEAD: StoredLead = { imageKey: "", imageCommit: "", imageType: "", pause: false };

export function isDiscoverLeadKey(imageKey: string): boolean {
	return imageKey.endsWith(PRIMARY_SUFFIX);
}

/** Map a variant path back to the primary key stored on the article. */
export function canonicalLeadKey(repoPath: string): string | null {
	const match = VARIANT_SUFFIX.exec(repoPath);
	if (!match || match.index === undefined) return null;
	const canonical = `${repoPath.slice(0, match.index)}${PRIMARY_SUFFIX}`;
	return isGitHubImagePath(canonical) ? canonical : null;
}

export function filesForStoredImage(imageKey: string): string[] {
	if (!imageKey) return [];
	if (!isDiscoverLeadKey(imageKey)) return [imageKey];
	const stem = imageKey.slice(0, -PRIMARY_SUFFIX.length);
	return [
		`${stem}-16x9-1200.webp`,
		`${stem}-16x9-800.webp`,
		`${stem}-4x3.webp`,
		`${stem}-1x1.webp`,
		imageKey,
	];
}

export function leadFileStem(slug: string, suffix: string): string | null {
	if (suffix && !/^[a-z0-9]{8}$/.test(suffix)) return null;
	const extra = suffix ? `-${suffix}` : "";
	const stem = `${slug}${extra}`.replace(/^-+|-+$/g, "");
	if (!/^[a-z0-9-]{1,85}$/.test(stem)) return null;
	return stem;
}

export function leadVariantPath(publishedAt: string, slug: string, suffix: string, variant: Pick<LeadVariant, "suffix">): string | null {
	const stem = leadFileStem(slug, suffix);
	if (!stem) return null;
	const date = new Date(publishedAt);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const path = `images/${year}/${month}/${stem}${variant.suffix}`;
	return isGitHubImagePath(path) ? path : null;
}

export async function deleteStoredImages(
	token: string,
	imageKey: string,
	fetchImpl: typeof fetch,
): Promise<{ deleted: number; pause: boolean }> {
	let deleted = 0;
	for (const path of filesForStoredImage(imageKey)) {
		if (!isGitHubImagePath(path)) continue;
		if (deleted > 0) await new Promise((resolve) => setTimeout(resolve, 0));
		const result = await deleteImageFile(token, path, fetchImpl);
		deleted += 1;
		if (result.pause) return { deleted, pause: true };
	}
	return { deleted, pause: false };
}

/**
 * Upload the smaller crops first and the 1600x900 file last. The last commit SHA
 * contains every file committed earlier in the sequence.
 */
export async function persistLeadVariants(
	token: string,
	publishedAt: string,
	slug: string,
	suffix: string,
	source: Uint8Array,
	fetchImpl: typeof fetch,
): Promise<StoredLead> {
	if (!token) return EMPTY_LEAD;
	// Loaded only when a generated illustration is cropped. Ingest does not call this.
	const { buildLeadVariants } = await import("./image-crop");
	const variants = await buildLeadVariants(source);
	if (!variants?.length) return EMPTY_LEAD;
	const committed: string[] = [];
	const rollback = async () => {
		for (const path of committed) await deleteImageFile(token, path, fetchImpl);
	};
	let last: GitHubWriteResult = { ok: false, pause: false, commitSha: "", retryAfterMs: null };
	let primary = "";
	for (const variant of variants) {
		const path = leadVariantPath(publishedAt, slug, suffix, variant);
		if (!path) {
			await rollback();
			return EMPTY_LEAD;
		}
		last = await commitImageFile(token, path, variant.bytes, fetchImpl);
		if (!last.ok || !last.commitSha) {
			await rollback();
			return { ...EMPTY_LEAD, pause: last.pause };
		}
		committed.push(path);
		if (variant.id === "16x9") primary = path;
	}
	if (!primary || committed.length !== variants.length) {
		await rollback();
		return EMPTY_LEAD;
	}
	return { imageKey: primary, imageCommit: last.commitSha, imageType: "image/webp", pause: last.pause };
}

export interface LeadView {
	src: string;
	width: number;
	height: number;
	srcset: string;
}

const OPTIONAL_SUFFIXES = ["-16x9-1200.webp", "-16x9-800.webp", "-4x3.webp", "-1x1.webp"] as const;

function variantUrl(origin: string, imageKey: string, imageCommit: string, suffix: string): string | null {
	if (!isDiscoverLeadKey(imageKey)) return null;
	const stem = imageKey.slice(0, -PRIMARY_SUFFIX.length);
	return readerImageUrl(origin, `${stem}${suffix}`, imageCommit);
}

/**
 * Suffixes that are safe to put in srcset. `pending` undefined means we have
 * not confirmed the crops, so only the stored 16:9 file is advertised.
 * An empty string means every crop is in storage.
 */
export function readyVariantSuffixes(pending: string | undefined): Set<string> {
	if (pending === undefined) return new Set();
	const missing = new Set(pending.split(",").map((part) => part.trim()).filter(Boolean));
	return new Set(OPTIONAL_SUFFIXES.filter((suffix) => !missing.has(suffix)));
}

/** Hero, card, and thumb URLs. Legacy files stay exact. Missing crops are omitted. */
export function leadView(
	origin: string,
	imageKey: string,
	imageCommit: string,
	role: "hero" | "card" | "thumb",
	pending?: string,
): LeadView | null {
	if (!isDiscoverLeadKey(imageKey)) return null;
	const full = readerImageUrl(origin, imageKey, imageCommit);
	if (!full) return null;
	const ready = readyVariantSuffixes(pending);
	const small = ready.has("-16x9-800.webp") ? variantUrl(origin, imageKey, imageCommit, "-16x9-800.webp") : null;
	const mid = ready.has("-16x9-1200.webp") ? variantUrl(origin, imageKey, imageCommit, "-16x9-1200.webp") : null;
	const four = ready.has("-4x3.webp") ? variantUrl(origin, imageKey, imageCommit, "-4x3.webp") : null;
	const square = ready.has("-1x1.webp") ? variantUrl(origin, imageKey, imageCommit, "-1x1.webp") : null;
	const parts = [
		small ? `${small} 800w` : "",
		mid ? `${mid} 1200w` : "",
		`${full} 1600w`,
	].filter(Boolean);
	const srcset = parts.join(", ");
	if (role === "thumb" && square) return { src: square, width: 1200, height: 1200, srcset: `${square} 1200w` };
	if (role === "card" && four) return { src: four, width: 1600, height: 1200, srcset: `${four} 1600w` };
	if (role === "thumb" && small) return { src: small, width: 800, height: 450, srcset };
	if (role === "card" && mid) return { src: mid, width: 1200, height: 675, srcset };
	return { src: full, width: 1600, height: 900, srcset };
}

export interface SchemaImage {
	"@type": "ImageObject";
	url: string;
	width: number;
	height: number;
}

export function schemaImages(origin: string, imageKey: string, imageCommit: string, pending?: string): SchemaImage[] | null {
	if (!isDiscoverLeadKey(imageKey)) return null;
	const wide = readerImageUrl(origin, imageKey, imageCommit);
	if (!wide) return null;
	const images: SchemaImage[] = [{ "@type": "ImageObject", url: wide, width: 1600, height: 900 }];
	const ready = readyVariantSuffixes(pending);
	const four = ready.has("-4x3.webp") ? variantUrl(origin, imageKey, imageCommit, "-4x3.webp") : null;
	const square = ready.has("-1x1.webp") ? variantUrl(origin, imageKey, imageCommit, "-1x1.webp") : null;
	if (four) images.push({ "@type": "ImageObject", url: four, width: 1600, height: 1200 });
	if (square) images.push({ "@type": "ImageObject", url: square, width: 1200, height: 1200 });
	return images;
}

export function mediaContentUrl(origin: string, imageKey: string, imageCommit: string): string | null {
	if (!isDiscoverLeadKey(imageKey)) return null;
	return readerImageUrl(origin, imageKey, imageCommit);
}

function httpsUrl(raw: string): string | null {
	try {
		const url = new URL(raw.trim());
		if (url.protocol !== "https:" || url.username || url.password) return null;
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

/** Drop resize query keys and a trailing -1024x576 (or _1024x576) file suffix. */
export function enlargeImageUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	for (const key of [...url.searchParams.keys()]) {
		if (RESIZE_QUERY.has(key.toLowerCase())) url.searchParams.delete(key);
	}
	url.pathname = url.pathname.replace(/[-_](\d{2,5})x(\d{2,5})(?=\.[a-z0-9]+$)/i, "");
	url.hash = "";
	const next = url.toString();
	return next === raw.trim() ? null : next;
}

function absoluteUrl(raw: string, base: string): string {
	try {
		return new URL(raw.trim(), base || undefined).toString();
	} catch {
		return raw.trim();
	}
}

function addCandidate(list: Array<{ url: string; width: number }>, raw: string, width: number, base: string): void {
	const url = httpsUrl(absoluteUrl(raw, base));
	if (!url) return;
	const existing = list.find((entry) => entry.url === url);
	if (existing) {
		existing.width = Math.max(existing.width, width);
		return;
	}
	list.push({ url, width });
}

/** Largest declared source first. Caps the list so ingest does not chase every srcset entry. */
export function imageCandidates(explicit: string, html = "", base = ""): string[] {
	const list: Array<{ url: string; width: number }> = [];
	if (explicit) {
		const explicitUrl = absoluteUrl(explicit, base);
		addCandidate(list, explicitUrl, 0, base);
		const enlarged = enlargeImageUrl(explicitUrl);
		if (enlarged) addCandidate(list, enlarged, 1, base);
	}
	const meta = html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*>/gi);
	for (const tag of meta) {
		const content = /content=["']([^"']+)["']/i.exec(tag[0]);
		if (content?.[1]) {
			const absolute = absoluteUrl(content[1], base);
			addCandidate(list, absolute, 0, base);
			const enlarged = enlargeImageUrl(absolute);
			if (enlarged) addCandidate(list, enlarged, 1, base);
		}
	}
	const srcsets = html.matchAll(/srcset=["']([^"']+)["']/gi);
	for (const set of srcsets) {
		for (const part of (set[1] ?? "").split(",")) {
			const bits = part.trim().split(/\s+/);
			const url = bits[0] ?? "";
			const width = Number(/^(\d+)w$/i.exec(bits[1] ?? "")?.[1] ?? "");
			if (!url) continue;
			const absolute = absoluteUrl(url, base);
			addCandidate(list, absolute, Number.isFinite(width) ? width : 0, base);
			const enlarged = enlargeImageUrl(absolute);
			if (enlarged) addCandidate(list, enlarged, (Number.isFinite(width) ? width : 0) + 1, base);
		}
	}
	return list
		.sort((left, right) => right.width - left.width)
		.slice(0, 6)
		.map((entry) => entry.url);
}

export function leadWideEnough(bytes: Uint8Array): boolean {
	const size = imageDimensions(bytes);
	return Boolean(size && size.width >= 1200 && size.height >= 1);
}
