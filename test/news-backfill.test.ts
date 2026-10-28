import { describe, expect, it } from "vitest";
import { backfillLeads, backfillLimit } from "../src/news/backfill";
import { MemoryNewsRepository } from "../src/news/repository";
import type { StoredArticle } from "../src/news/types";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const WEBP = Uint8Array.from([
	0x52, 0x49, 0x46, 0x46, 0x0c, 0x00, 0x00, 0x00,
	0x57, 0x45, 0x42, 0x50, 0x00, 0x00, 0x00, 0x00,
]);

function article(id: string, slug: string, sourceUrl: string, publishedAt: string): StoredArticle {
	return {
		id,
		slug,
		title: "A short bulletin",
		description: "A short bulletin stays inside the note.",
		category: "ai",
		tags: [],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The outlet reported a narrow note.",
		keyPoints: [],
		faq: [],
		sources: [],
		related: [],
		imageKey: `images/2026/10/${slug}.jpg`,
		imageCommit: SHA,
		imageAlt: "Paper shapes",
		imageType: "image/jpeg",
		imageCredit: "Image: The Verge",
		imageSourceUrl: sourceUrl,
		publishedAt,
		updatedAt: publishedAt,
	};
}

function installFetch(mode: "webp" | "missing" | "jpeg") {
	const widths: number[] = [];
	const puts: string[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		const url = String(input);
		if (url.includes("api.github.com")) {
			if (init?.method === "PUT") {
				puts.push(url);
				return new Response(JSON.stringify({ commit: { sha: SHA } }), {
					status: 201,
					headers: { "content-type": "application/json", "x-ratelimit-remaining": "4000" },
				});
			}
			return new Response("missing", { status: 404 });
		}
		const cf = (init as { cf?: { image?: { width?: number; format?: string } } } | undefined)?.cf;
		widths.push(cf?.image?.width ?? 0);
		expect(cf?.image?.format).toBe("webp");
		if (mode === "missing") return new Response("no", { status: 404 });
		if (mode === "jpeg") {
			return new Response(WEBP, { status: 200, headers: { "content-type": "image/jpeg" } });
		}
		return new Response(WEBP, { status: 200, headers: { "content-type": "image/webp" } });
	};
	return { fetchImpl, widths, puts };
}

describe("discover backfill", () => {
	it("resizes one article through cf.image and ignores a higher limit", async () => {
		expect(backfillLimit({ limit: 4 })).toBe(1);
		const repo = new MemoryNewsRepository();
		repo.articles.push(
			article("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "newer-note", "https://cdn.example/newer.jpg", "2026-10-02T00:00:00.000Z"),
			article("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "older-note", "https://cdn.example/older.jpg", "2026-10-01T00:00:00.000Z"),
		);
		const { fetchImpl, widths, puts } = installFetch("webp");
		const report = await backfillLeads(
			{ GITHUB_IMAGES_TOKEN: "token" },
			{ repo, fetchImpl, now: new Date("2026-10-03T00:00:00.000Z") },
		);
		expect(report.updated).toBe(1);
		expect(report.failed).toBe(0);
		expect(report.remaining).toBe(1);
		expect(report.results[0]?.slug).toBe("newer-note");
		expect(repo.articles[0]?.imageKey).toMatch(/-16x9\.webp$/);
		expect(repo.articles[0]?.imageType).toBe("image/webp");
		expect(repo.articles[0]?.imageCredit).toBe("Image: The Verge");
		expect(repo.articles[1]?.imageKey).toBe("images/2026/10/older-note.jpg");
		expect(widths).toEqual([1600, 1200, 800, 1600, 1200]);
		expect(puts).toHaveLength(5);
		expect(puts[4]).toContain(repo.articles[0]?.imageKey);
	});

	it("flags an unreadable source once so remaining drains", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(
			article("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "broken-note", "https://cdn.example/broken.jpg", "2026-10-02T00:00:00.000Z"),
			article("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "kept-note", "https://cdn.example/kept.jpg", "2026-10-01T00:00:00.000Z"),
		);
		const broken = installFetch("missing");
		const first = await backfillLeads(
			{ GITHUB_IMAGES_TOKEN: "token" },
			{ repo, fetchImpl: broken.fetchImpl, now: new Date("2026-10-03T00:00:00.000Z") },
		);
		expect(first.failed).toBe(1);
		expect(first.remaining).toBe(1);
		expect(first.results[0]).toMatchObject({ slug: "broken-note", status: "failed", reason: "unprocessable_source" });
		expect(repo.backfillHolds.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toContain("unprocessable_source");
		const again = await backfillLeads(
			{ GITHUB_IMAGES_TOKEN: "token" },
			{ repo, fetchImpl: broken.fetchImpl, now: new Date("2026-10-03T00:00:00.000Z") },
		);
		expect(again.results[0]?.slug).not.toBe("broken-note");
		expect(again.remaining).toBe(0);
		expect(again.failed).toBe(1);
	});

	it("does not flag the article when resizing is not applied", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(article("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "plain-note", "https://cdn.example/plain.jpg", "2026-10-02T00:00:00.000Z"));
		const { fetchImpl } = installFetch("jpeg");
		const report = await backfillLeads(
			{ GITHUB_IMAGES_TOKEN: "token" },
			{ repo, fetchImpl, now: new Date("2026-10-03T00:00:00.000Z") },
		);
		expect(report.error).toBe("resize_unavailable");
		expect(report.failed).toBe(0);
		expect(report.remaining).toBe(1);
		expect(repo.backfillHolds.size).toBe(0);
		expect(repo.articles[0]?.imageKey).toBe("images/2026/10/plain-note.jpg");
	});
});
