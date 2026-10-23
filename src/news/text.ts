import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE } from "./config";

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

const OTHER_DASH = /[\u2012\u2212\u2E3A\uFE31\uFE58]/g;

/** Turn clause dashes into commas. Numeric ranges become hyphens. */
export function stripEditorialDashes(input: string): string {
	return input
		.replace(/&mdash;|&#8212;|&#x2014;/gi, ", ")
		.replace(/&ndash;|&#8211;|&#x2013;/gi, ", ")
		.replace(/&#8210;|&#x2012;/gi, ", ")
		.replace(/&#8722;|&#x2212;/gi, ", ")
		.replace(/&#65080;|&#xfe58;/gi, ", ")
		.replace(/&#65073;|&#xfe31;/gi, ", ")
		.replace(/&#11834;|&#x2e3a;/gi, ", ")
		.replace(/(\d)\s*[\u2012\u2013\u2014\u2015\u2212]\s*(\d)/g, "$1-$2")
		.replace(/[\u2014\u2015]/g, ", ")
		.replace(/\u2013/g, ", ")
		.replace(new RegExp(OTHER_DASH.source, "g"), ", ")
		.replace(/\s+([,.;:!?])/g, "$1")
		.replace(/[ ]{2,}/g, " ")
		.replace(/\s+,/g, ",");
}

export function forbiddenDash(input: string): "em_dash" | "en_dash_clause" | "dash_substitute" | "other_dash" | null {
	const decoded = input
		.replace(/&mdash;|&#8212;|&#x2014;/gi, "\u2014")
		.replace(/&ndash;|&#8211;|&#x2013;/gi, "\u2013")
		.replace(/&#8210;|&#x2012;/gi, "\u2012")
		.replace(/&#8722;|&#x2212;/gi, "\u2212")
		.replace(/&#65080;|&#xfe58;/gi, "\uFE58")
		.replace(/&#65073;|&#xfe31;/gi, "\uFE31")
		.replace(/&#11834;|&#x2e3a;/gi, "\u2E3A");
	if (/[\u2014\u2015]/.test(decoded)) return "em_dash";
	if (new RegExp(OTHER_DASH.source).test(decoded)) return "other_dash";
	if (/---/.test(decoded) || /\s--\s/.test(decoded)) return "dash_substitute";
	const withoutRanges = decoded.replace(/\d\u2013\d/g, "");
	if (/\u2013/.test(withoutRanges)) return "en_dash_clause";
	return null;
}

/** Flatten untrusted text so it cannot open a new markdown link or heading. */
export function escapeMarkdown(value: string): string {
	return value
		.replace(/[\u0000-\u001f]+/g, " ")
		.replace(/\\/g, "\\\\")
		.replace(/[[\]()*_`#]/g, "\\$&")
		.replace(/\s+/g, " ")
		.trim();
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

function readU32BE(bytes: Uint8Array, offset: number): number | null {
	if (offset + 4 > bytes.length) return null;
	return ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
}

function readU24LE(bytes: Uint8Array, offset: number): number | null {
	if (offset + 3 > bytes.length) return null;
	return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length >= 24 && IMAGE_SIGNATURES.png.every((byte, index) => bytes[index] === byte)) {
		const width = readU32BE(bytes, 16);
		const height = readU32BE(bytes, 20);
		if (!width || !height) return null;
		return { width, height };
	}
	if (bytes.length >= 4 && IMAGE_SIGNATURES.jpeg.every((byte, index) => bytes[index] === byte)) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) return null;
			const marker = bytes[offset + 1] ?? 0;
			const size = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
			if (size < 2) return null;
			const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (startOfFrame) {
				const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
				const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
				if (!width || !height) return null;
				return { width, height };
			}
			offset += 2 + size;
		}
		return null;
	}
	if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
		const chunk = String.fromCharCode(...bytes.slice(12, 16));
		if (chunk === "VP8X") {
			const width = readU24LE(bytes, 24);
			const height = readU24LE(bytes, 27);
			if (!width || !height) return null;
			return { width: width + 1, height: height + 1 };
		}
		if (chunk === "VP8L" && bytes.length >= 25) {
			const b0 = bytes[21] ?? 0;
			const b1 = bytes[22] ?? 0;
			const b2 = bytes[23] ?? 0;
			const b3 = bytes[24] ?? 0;
			const width = 1 + (((b1 & 0x3f) << 8) | b0);
			const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
			return { width, height };
		}
	}
	return null;
}

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

export function imageLimitReason(bytes: Uint8Array): "image_bytes" | "image_dimensions" | "image_edge" | null {
	if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) return "image_bytes";
	const size = imageDimensions(bytes);
	if (!size) return "image_dimensions";
	if (size.width > MAX_IMAGE_EDGE || size.height > MAX_IMAGE_EDGE || size.width < 1 || size.height < 1) return "image_edge";
	return null;
}

/** 1x1 baseline JPEG with a SOF0 marker so the dimension check can read it. */
export const TINY_JPEG = Uint8Array.from([
	0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);

export const TINY_PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);
