import { PhotonImage, SamplingFilter, crop, resize } from "@cf-wasm/photon";
import encode, { init as initWebp } from "@jsquash/webp/encode.js";

/** Same cap as a GitHub Contents API upload. */
const STORED_IMAGE_MAX_BYTES = 1_000_000;

export const MIN_LEAD_WIDTH = 1200;

export interface LeadVariant {
	id: "16x9" | "16x9-1200" | "16x9-800" | "4x3" | "1x1";
	suffix: string;
	width: number;
	height: number;
	bytes: Uint8Array;
}

const SPECS: Array<Pick<LeadVariant, "id" | "suffix" | "width" | "height">> = [
	{ id: "16x9-1200", suffix: "-16x9-1200.webp", width: 1200, height: 675 },
	{ id: "16x9-800", suffix: "-16x9-800.webp", width: 800, height: 450 },
	{ id: "4x3", suffix: "-4x3.webp", width: 1600, height: 1200 },
	{ id: "1x1", suffix: "-1x1.webp", width: 1200, height: 1200 },
	{ id: "16x9", suffix: "-16x9.webp", width: 1600, height: 900 },
];

type WebpSource = Parameters<typeof encode>[0];

let webpReady: Promise<void> | null = null;

type WebpInit = {
	(module: WebAssembly.Module): Promise<unknown>;
	(module: undefined, options: { wasmBinary: ArrayBuffer }): Promise<unknown>;
};

const startWebp = initWebp as unknown as WebpInit;

async function encoderWasm(): Promise<ArrayBuffer | WebAssembly.Module> {
	try {
		const { readFile } = await import("node:fs/promises");
		const { createRequire } = await import("node:module");
		const require = createRequire(import.meta.url);
		const file = require.resolve("@jsquash/webp/codec/enc/webp_enc_simd.wasm");
		const bytes = await readFile(file);
		return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	} catch {
		const imported = await import("@jsquash/webp/codec/enc/webp_enc_simd.wasm");
		return imported.default;
	}
}

async function ensureWebp(): Promise<void> {
	if (!webpReady) {
		webpReady = (async () => {
			const wasm = await encoderWasm();
			if (wasm instanceof ArrayBuffer) await startWebp(undefined, { wasmBinary: wasm });
			else await startWebp(wasm);
		})().catch((error: unknown) => {
			webpReady = null;
			throw error;
		});
	}
	await webpReady;
}

function centerCrop(source: PhotonImage, width: number, height: number): PhotonImage {
	const srcW = source.get_width();
	const srcH = source.get_height();
	const targetRatio = width / height;
	const sourceRatio = srcW / srcH;
	let cropW = srcW;
	let cropH = srcH;
	if (sourceRatio > targetRatio) {
		cropH = srcH;
		cropW = Math.max(1, Math.min(srcW, Math.round(srcH * targetRatio)));
	} else {
		cropW = srcW;
		cropH = Math.max(1, Math.min(srcH, Math.round(srcW / targetRatio)));
	}
	const x1 = Math.max(0, Math.floor((srcW - cropW) / 2));
	const y1 = Math.max(0, Math.floor((srcH - cropH) / 2));
	const x2 = Math.min(srcW, x1 + cropW);
	const y2 = Math.min(srcH, y1 + cropH);
	const cropped = crop(source, x1, y1, x2, y2);
	const resized = resize(cropped, width, height, SamplingFilter.Lanczos3);
	if (cropped !== source) cropped.free();
	return resized;
}

async function encodeWebp(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
	await ensureWebp();
	const data = new Uint8ClampedArray(pixels.byteLength);
	data.set(pixels);
	const image = { data, width, height, colorSpace: "srgb" } as WebpSource;
	for (let quality = 78; quality >= 40; quality -= 8) {
		const buffer = await encode(image, { quality, method: 1 });
		const bytes = new Uint8Array(buffer);
		if (bytes.byteLength > 0 && bytes.byteLength <= STORED_IMAGE_MAX_BYTES) return bytes;
	}
	return null;
}

/** Center-crop one source into the five Discover files. Null when the bytes will not decode. */
export async function buildLeadVariants(bytes: Uint8Array): Promise<LeadVariant[] | null> {
	let source: PhotonImage | null = null;
	try {
		source = PhotonImage.new_from_byteslice(bytes);
		if (source.get_width() < 1 || source.get_height() < 1) return null;
		const variants: LeadVariant[] = [];
		for (const spec of SPECS) {
			const frame = centerCrop(source, spec.width, spec.height);
			try {
				const encoded = await encodeWebp(frame.get_raw_pixels(), spec.width, spec.height);
				if (!encoded) return null;
				variants.push({ ...spec, bytes: encoded });
			} finally {
				frame.free();
			}
		}
		return variants;
	} catch {
		return null;
	} finally {
		source?.free();
	}
}

/** Solid PNG used by tests and as a last-resort canvas. Photon encodes the PNG. */
export function solidPng(width: number, height: number, rgb: [number, number, number] = [196, 92, 42]): Uint8Array {
	const pixels = new Uint8Array(width * height * 4);
	for (let index = 0; index < width * height; index += 1) {
		const offset = index * 4;
		pixels[offset] = rgb[0];
		pixels[offset + 1] = rgb[1];
		pixels[offset + 2] = rgb[2];
		pixels[offset + 3] = 255;
	}
	const image = new PhotonImage(pixels, width, height);
	try {
		return image.get_bytes();
	} finally {
		image.free();
	}
}
