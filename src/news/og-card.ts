import { PhotonImage } from "@cf-wasm/photon";

const WIDTH = 1200;
const HEIGHT = 630;
const GLYPHS: Record<string, string[]> = {
	"3": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
	a: ["00000", "01110", "00001", "01111", "10001", "10001", "01111"],
	i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
	k: ["00000", "10001", "10010", "11100", "10010", "10001", "10001"],
	N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
	e: ["00000", "01110", "10001", "11111", "10000", "10001", "01110"],
	w: ["00000", "10001", "10001", "10101", "10101", "10101", "01010"],
	s: ["00000", "01111", "10000", "01110", "00001", "00001", "11110"],
	" ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function paint(pixels: Uint8Array, x: number, y: number, rgb: [number, number, number]): void {
	if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
	const offset = (y * WIDTH + x) * 4;
	pixels[offset] = rgb[0];
	pixels[offset + 1] = rgb[1];
	pixels[offset + 2] = rgb[2];
	pixels[offset + 3] = 255;
}

function fill(pixels: Uint8Array, rgb: [number, number, number]): void {
	for (let index = 0; index < WIDTH * HEIGHT; index += 1) {
		const offset = index * 4;
		pixels[offset] = rgb[0];
		pixels[offset + 1] = rgb[1];
		pixels[offset + 2] = rgb[2];
		pixels[offset + 3] = 255;
	}
}

function rect(pixels: Uint8Array, x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
	for (let row = y; row < y + h; row += 1) {
		for (let col = x; col < x + w; col += 1) paint(pixels, col, row, rgb);
	}
}

/** 1200x630 branded card for the /ai-news front page. */
export function newsOgPng(): Uint8Array {
	const ink: [number, number, number] = [26, 26, 26];
	const paper: [number, number, number] = [244, 239, 230];
	const accent: [number, number, number] = [227, 107, 26];
	const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
	fill(pixels, ink);
	rect(pixels, 0, 0, WIDTH, 18, accent);
	rect(pixels, 72, 248, 36, 36, accent);
	const text = "3aik News";
	const scale = 14;
	const glyphW = 5 * scale;
	const gap = 10;
	const textW = text.length * glyphW + (text.length - 1) * gap;
	let cursor = Math.round((WIDTH - textW) / 2) + 24;
	const top = 286;
	for (const char of text) {
		const rows = GLYPHS[char] ?? GLYPHS[" "];
		if (!rows) continue;
		for (let row = 0; row < rows.length; row += 1) {
			const bits = rows[row] ?? "";
			for (let col = 0; col < bits.length; col += 1) {
				if (bits[col] !== "1") continue;
				rect(pixels, cursor + col * scale, top + row * scale, scale - 2, scale - 2, paper);
			}
		}
		cursor += glyphW + gap;
	}
	const image = new PhotonImage(pixels, WIDTH, HEIGHT);
	try {
		return image.get_bytes();
	} finally {
		image.free();
	}
}
