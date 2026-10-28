import { GITHUB_IMAGE_MAX_BYTES } from "./github-images";
import { detectImageType } from "./text";

export interface ResizeSpec {
	suffix: string;
	width: number;
	height: number;
}

/** Smaller files first. The 1600x900 crop is last so its commit contains the others. */
export const BACKFILL_SPECS: ResizeSpec[] = [
	{ suffix: "-16x9-1200.webp", width: 1200, height: 675 },
	{ suffix: "-16x9-800.webp", width: 800, height: 450 },
	{ suffix: "-4x3.webp", width: 1600, height: 1200 },
	{ suffix: "-1x1.webp", width: 1200, height: 1200 },
	{ suffix: "-16x9.webp", width: 1600, height: 900 },
];

export const PRIMARY_RESIZE = BACKFILL_SPECS[BACKFILL_SPECS.length - 1] as ResizeSpec;

export type ResizeFetch =
	| { ok: true; bytes: Uint8Array }
	| { ok: false; reason: "rejected" | "unavailable" | "too_large" | "transient" };

interface CfImageInit extends RequestInit {
	cf: {
		image: {
			width: number;
			height: number;
			fit: "cover";
			gravity: "center";
			format: "webp";
			quality: number;
		};
	};
}

const RESIZE_TIMEOUT_MS = 12_000;

/**
 * Ask Cloudflare to crop and encode. The Worker only receives the WebP, so a
 * multi-megapixel publisher original is not decoded in the isolate.
 */
export async function fetchResizedWebp(
	url: string,
	spec: Pick<ResizeSpec, "width" | "height">,
	fetchImpl: typeof fetch,
): Promise<ResizeFetch> {
	const first = await fetchOnce(url, spec, 72, fetchImpl);
	if (first.ok || first.reason !== "too_large") return first;
	return fetchOnce(url, spec, 45, fetchImpl);
}

async function fetchOnce(
	url: string,
	spec: Pick<ResizeSpec, "width" | "height">,
	quality: number,
	fetchImpl: typeof fetch,
): Promise<ResizeFetch> {
	const init: CfImageInit = {
		redirect: "follow",
		signal: AbortSignal.timeout(RESIZE_TIMEOUT_MS),
		cf: {
			image: {
				width: spec.width,
				height: spec.height,
				fit: "cover",
				gravity: "center",
				format: "webp",
				quality,
			},
		},
	};
	let response: Response;
	try {
		response = await fetchImpl(url, init as RequestInit);
	} catch {
		return { ok: false, reason: "transient" };
	}
	const type = response.headers.get("content-type") ?? "";
	const webp = type.toLowerCase().includes("image/webp");
	const advertised = Number(response.headers.get("content-length") ?? "");
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		if (response.status === 429 || response.status >= 500) return { ok: false, reason: "transient" };
		return { ok: false, reason: "rejected" };
	}
	if (!webp) {
		await response.body?.cancel().catch(() => undefined);
		return { ok: false, reason: "unavailable" };
	}
	if (Number.isFinite(advertised) && advertised > GITHUB_IMAGE_MAX_BYTES) {
		await response.body?.cancel().catch(() => undefined);
		return { ok: false, reason: "too_large" };
	}
	const bytes = await readCapped(response, GITHUB_IMAGE_MAX_BYTES);
	if (!bytes) return { ok: false, reason: "too_large" };
	if (detectImageType(bytes)?.mime !== "image/webp") return { ok: false, reason: "unavailable" };
	return { ok: true, bytes };
}

async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
	const reader = response.body?.getReader();
	if (!reader) {
		const buffered = new Uint8Array(await response.arrayBuffer());
		return buffered.byteLength > maxBytes ? null : buffered;
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const step = await reader.read();
			if (step.done) break;
			total += step.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(step.value);
		}
	} catch {
		await reader.cancel().catch(() => undefined);
		return null;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
