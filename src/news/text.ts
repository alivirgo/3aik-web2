const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
	nbsp: " ",
	hellip: "...",
	rsquo: "'",
	lsquo: "'",
	rdquo: "\"",
	ldquo: "\"",
	mdash: "\u2014",
	ndash: "\u2013",
};

export function decodeEntities(input: string): string {
	const withoutCdata = input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
	return withoutCdata.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
		if (body[0] === "#") {
			const hex = body[1] === "x" || body[1] === "X";
			const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return entity;
			try {
				return String.fromCodePoint(code);
			} catch {
				return entity;
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
	});
}

export function stripHtml(input: string): string {
	return decodeEntities(input)
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export function xmlEscape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Turn clause dashes into commas. Numeric ranges become hyphens. */
export function stripEditorialDashes(input: string): string {
	return input
		.replace(/&mdash;|&#8212;|&#x2014;/gi, ", ")
		.replace(/&ndash;|&#8211;|&#x2013;/gi, ", ")
		.replace(/(\d)\s*[\u2013\u2014\u2015]\s*(\d)/g, "$1-$2")
		.replace(/[\u2014\u2015]/g, ", ")
		.replace(/\u2013/g, ", ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/[ ]{2,}/g, " ")
		.replace(/\s+,/g, ",");
}

export function forbiddenDash(input: string): "em_dash" | "en_dash_clause" | "dash_substitute" | null {
	const decoded = input
		.replace(/&mdash;|&#8212;|&#x2014;/gi, "\u2014")
		.replace(/&ndash;|&#8211;|&#x2013;/gi, "\u2013");
	if (/[\u2014\u2015]/.test(decoded)) return "em_dash";
	if (/---/.test(decoded) || /\s--\s/.test(decoded)) return "dash_substitute";
	const withoutRanges = decoded.replace(/\d\u2013\d/g, "");
	if (/\u2013/.test(withoutRanges)) return "en_dash_clause";
	return null;
}

export function normalizeForMatch(input: string): string {
	return input
		.toLowerCase()
		.replace(/[’‘]/g, "'")
		.replace(/['']/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function words(input: string): string[] {
	const normalized = normalizeForMatch(input);
	return normalized ? normalized.split(" ") : [];
}

export function wordCount(input: string): number {
	return words(input).length;
}

export function wordWindows(input: string, size: number): Set<string> {
	const tokens = words(input);
	const out = new Set<string>();
	if (size < 1 || tokens.length < size) return out;
	for (let index = 0; index + size <= tokens.length; index += 1) {
		out.add(tokens.slice(index, index + size).join(" "));
	}
	return out;
}

export function tokenJaccard(left: string, right: string): number {
	const a = new Set(words(left).filter((word) => word.length > 2));
	const b = new Set(words(right).filter((word) => word.length > 2));
	if (!a.size || !b.size) return 0;
	let intersection = 0;
	for (const token of a) if (b.has(token)) intersection += 1;
	return intersection / (a.size + b.size - intersection);
}

export function shingleJaccard(left: string, right: string, size = 5): number {
	const a = wordWindows(left, size);
	const b = wordWindows(right, size);
	if (!a.size || !b.size) return 0;
	let intersection = 0;
	for (const token of a) if (b.has(token)) intersection += 1;
	return intersection / (a.size + b.size - intersection);
}

export function sentencesOf(input: string): string[] {
	const cleaned = input.replace(/\s+/g, " ").trim();
	if (!cleaned) return [];
	return cleaned
		.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘'])/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 0);
}

export function slugify(input: string): string {
	const slug = input
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80)
		.replace(/-+$/g, "");
	return slug || "story";
}

const TRACKING_PARAMS = new Set([
	"utm_source",
	"utm_medium",
	"utm_campaign",
	"utm_term",
	"utm_content",
	"utm_id",
	"utm_name",
	"at_medium",
	"at_campaign",
	"at_source",
	"fbclid",
	"gclid",
	"mc_cid",
	"mc_eid",
]);

export function normalizeSourceUrl(raw: string): string {
	const url = new URL(raw.trim());
	url.hash = "";
	if (url.protocol === "http:") url.protocol = "https:";
	url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
	const keys = [...url.searchParams.keys()];
	for (const key of keys) {
		if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
			url.searchParams.delete(key);
		}
	}
	url.searchParams.sort();
	if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
	return url.toString();
}

export function clipWords(input: string, maxChars: number): string {
	const clean = input.replace(/\s+/g, " ").trim();
	if (clean.length <= maxChars) return clean;
	const sliced = clean.slice(0, maxChars);
	const boundary = sliced.lastIndexOf(" ");
	return `${(boundary > 40 ? sliced.slice(0, boundary) : sliced).trim()}...`;
}

export function formatDate(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

export function rfc822(iso: string): string {
	return new Date(iso).toUTCString();
}

export function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function isCategory(value: string): value is "ai" | "technology" | "fashion" | "showbiz" {
	return value === "ai" || value === "technology" || value === "fashion" || value === "showbiz";
}

const IMAGE_SIGNATURES = {
	png: [0x89, 0x50, 0x4e, 0x47],
	jpeg: [0xff, 0xd8, 0xff],
} as const;

export function detectImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
	if (bytes.length >= 8 && IMAGE_SIGNATURES.png.every((byte, index) => bytes[index] === byte)) {
		return { mime: "image/png", extension: "png" };
	}
	if (bytes.length >= 3 && IMAGE_SIGNATURES.jpeg.every((byte, index) => bytes[index] === byte)) {
		return { mime: "image/jpeg", extension: "jpg" };
	}
	if (
		bytes.length >= 12
		&& String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
		&& String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
	) {
		return { mime: "image/webp", extension: "webp" };
	}
	return null;
}

export const TINY_PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);
