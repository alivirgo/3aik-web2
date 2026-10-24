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

/** Same word split as `words`, plus the casing and commas the plagiarism check needs. */
export interface CasedToken {
	norm: string;
	capitalized: boolean;
	followedByComma: boolean;
}

export function casedTokens(input: string): CasedToken[] {
	const tokens: CasedToken[] = [];
	let raw = "";
	const flush = (followedByComma: boolean) => {
		if (!raw) return;
		const first = raw[0] ?? "";
		tokens.push({
			norm: raw.toLowerCase(),
			capitalized: first >= "A" && first <= "Z",
			followedByComma,
		});
		raw = "";
	};
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index] ?? "";
		if (char === "'" || char === "\u2019" || char === "\u2018") continue;
		if (/[A-Za-z0-9]/.test(char)) {
			raw += char;
			continue;
		}
		flush(char === ",");
	}
	flush(false);
	return tokens;
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

/** Weekday dateline for the top bar. UTC so a render does not depend on the server zone. */
export function formatDateline(now = Date.now()): { label: string; iso: string } {
	const date = new Date(now);
	const iso = Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
	const label = new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(date);
	return { label, iso };
}

/** Compact timestamp for the Latest column. */
export function formatTimestamp(iso: string, now = Date.now()): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const hours = date.getUTCHours();
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	const suffix = hours >= 12 ? "p.m." : "a.m.";
	const hour12 = hours % 12 || 12;
	const clock = `${hour12}:${minutes} ${suffix}`;
	const sameDay = new Date(now).toISOString().slice(0, 10) === date.toISOString().slice(0, 10);
	if (sameDay) return clock;
	const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(date);
	return `${day}, ${clock}`;
}

/** Words per minute used for the visible reading time. */
const READING_WORDS_PER_MINUTE = 230;

export function readingMinutes(text: string): number {
	return Math.max(1, Math.round(wordCount(text) / READING_WORDS_PER_MINUTE));
}

export function readingLabel(text: string): string {
	return `${readingMinutes(text)} min read`;
}

/** Relative time for a published timestamp. `now` is injectable so tests stay stable. */
export function relativeTime(iso: string, now = Date.now()): string {
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return "recently";
	const elapsed = Math.max(0, now - then);
	if (elapsed < 60_000) return "just now";
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
	const years = Math.floor(days / 365);
	return years === 1 ? "1 year ago" : `${years} years ago`;
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
		if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
			const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
			const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
			if (!width || !height) return null;
			return { width, height };
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
