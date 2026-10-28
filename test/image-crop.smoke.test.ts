import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLeadVariants, solidPng } from "../src/news/image-crop";
import { newsOgPng } from "../src/news/og-card";
import { imageDimensions } from "../src/news/text";

describe("lead crops", () => {
	it("builds five webp sizes from a wide png", async () => {
		const variants = await buildLeadVariants(solidPng(1400, 800));
		expect(variants).toBeTruthy();
		const byId = new Map((variants ?? []).map((variant) => [variant.id, variant]));
		expect(imageDimensions(byId.get("16x9")?.bytes ?? new Uint8Array())).toEqual({ width: 1600, height: 900 });
		expect(imageDimensions(byId.get("4x3")?.bytes ?? new Uint8Array())).toEqual({ width: 1600, height: 1200 });
		expect(imageDimensions(byId.get("1x1")?.bytes ?? new Uint8Array())).toEqual({ width: 1200, height: 1200 });
		expect(imageDimensions(byId.get("16x9-1200")?.bytes ?? new Uint8Array())).toEqual({ width: 1200, height: 675 });
		expect(imageDimensions(byId.get("16x9-800")?.bytes ?? new Uint8Array())).toEqual({ width: 800, height: 450 });
	}, 30_000);

	it("keeps the front-page card at Discover size", () => {
		expect(imageDimensions(newsOgPng())).toEqual({ width: 1200, height: 630 });
		const file = readFileSync(new URL("../public/ai-news-og.png", import.meta.url));
		expect(imageDimensions(file)).toEqual({ width: 1200, height: 630 });
	});
});
