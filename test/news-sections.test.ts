import { describe, expect, it } from "vitest";
import { readLabel, visibleCategory } from "../src/news/sections";
import type { Category } from "../src/news/types";

const published = "2026-10-23T12:00:00.000Z";

function story(section: Category) {
	return { category: "breaking" as const, section, publishedAt: published };
}

describe("breaking desk", () => {
	it("stays on Breaking for six hours, then reads as its section", () => {
		const fresh = Date.parse("2026-10-23T17:59:00.000Z");
		const later = Date.parse("2026-10-23T18:00:00.000Z");
		expect(visibleCategory(story("finance"), fresh)).toBe("breaking");
		expect(visibleCategory(story("finance"), later)).toBe("finance");
		expect(visibleCategory(story("crime"), later)).toBe("crime");
		expect(visibleCategory({ category: "sports", publishedAt: published }, later)).toBe("sports");
	});

	it("formats public read counts without other stats", () => {
		expect(readLabel(0)).toBe("0 reads");
		expect(readLabel(1)).toBe("1 read");
		expect(readLabel(1200)).toBe("1.2K reads");
		expect(readLabel(12000)).toBe("12K reads");
	});
});
