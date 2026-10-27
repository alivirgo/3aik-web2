import { describe, expect, it, vi } from "vitest";
import { FEEDS } from "../src/news/config";
import { pingIndexNow, runPublishCycle } from "../src/news/pipeline";
import { MemoryNewsRepository } from "../src/news/repository";
import type { ArticleDraft, StoredArticle } from "../src/news/types";
import { TINY_JPEG, TINY_PNG } from "../src/news/text";

const now = new Date("2026-10-23T12:07:00.000Z");
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const feed = FEEDS.find((entry) => entry.category === "ai");
if (!feed) throw new Error("missing AI feed");

function draft(): ArticleDraft {
	const paragraph = (index: number) => [
		`${feed!.outlet} reported a narrow product note, and this retelling keeps that limit on pass ${index}.`,
		"The excerpt stops there.",
		"No extra names are added in this pass.",
		"Until a later report from the same outlet prints a price, a date, and a rollout list, this desk will leave those blanks empty rather than invent a figure the source never printed.",
		"Hold the limit here.",
		"Open the link.",
	].join(" ");
	return {
		title: "A short bulletin, retold with the blanks left blank",
		description: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		tags: ["desk", "brief"],
		keyPoints: [
			"The outlet reported a narrow product note, and this brief does not add names or prices.",
			"Missing figures stay missing until a later report from the same outlet prints them.",
			"Readers should open the linked source before treating this page as the full record.",
		],
		faq: [
			{
				question: "What did the outlet report?",
				answer: "The outlet reported a narrow product note. This page repeats that limit and does not add names, prices, cities, or a scoreboard that the excerpt never contained.",
			},
			{
				question: "What is still missing?",
				answer: "A price, a date, and a rollout list are not in the text used here. Those blanks stay blank until a later report from the same outlet fills them in.",
			},
			{
				question: "Where should a reader check the claim?",
				answer: "The linked source is the record. This page is a brief in another voice, and it should be checked against that source before anyone relies on it.",
			},
		],
		paragraphs: [1, 2, 3, 4, 5, 6].map(paragraph),
		imageAlt: "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.",
		imagePrompt: "Abstract editorial illustration of stacked paper rectangles in sand and ink blue on a warm gray field, soft shadow, no lettering.",
	};
}

function rss() {
	return `<?xml version="1.0"?><rss><channel><item>
<title>Vendor posts a wholly separate Thursday bulletin</title>
<link>https://example.com/fresh-bulletin</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>Quilted badgers maintain a violet harbor while the public status page stays quiet and uneventful today.</description>
</item></channel></rss>`;
}

function harness(options: { publishing?: string; rate?: string; indexNow?: string; token?: string; githubStatus?: number; generator?: string; omitGenerator?: boolean } = {}) {
	const repo = new MemoryNewsRepository();
	const writeDraft = vi.fn(async () => ({ text: JSON.stringify(draft()), model: "dry-run" }));
	const paint = vi.fn(async () => ({ bytes: TINY_PNG, contentType: "image/png", model: "dry-run" }));
	const ping = vi.fn(async () => undefined);
	const githubCalls: Array<{ url: string; method: string; authorization: string; body: string }> = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (url === feed!.url) return new Response(rss(), { status: 200, headers: { "content-type": "application/rss+xml" } });
		if (url.startsWith("https://api.github.com/")) {
			const headers = new Headers(init?.headers);
			githubCalls.push({
				url,
				method: init?.method ?? "GET",
				authorization: headers.get("authorization") ?? "",
				body: typeof init?.body === "string" ? init.body : "",
			});
			if (init?.method === "GET" || !init?.method) {
				return new Response(JSON.stringify({ sha: "abc123" }), { status: 200, headers: { "x-ratelimit-remaining": "4000" } });
			}
			const status = options.githubStatus ?? (init?.method === "DELETE" ? 200 : 201);
			const body = status === 200 || status === 201
				? JSON.stringify({
					commit: { sha: COMMIT_SHA },
					content: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
				})
				: "{}";
			return new Response(body, {
				status,
				headers: { "x-ratelimit-remaining": "4000" },
			});
		}
		return new Response("no", { status: 404 });
	});
	return {
		repo,
		writeDraft,
		paint,
		ping,
		fetchImpl,
		githubCalls,
		deps: {
			env: {
				AI_NEWS_PUBLISHING: options.publishing ?? "on",
				...(options.omitGenerator ? {} : { AI_NEWS_GENERATOR: options.generator ?? "workers-ai" }),
				AI_NEWS_ARTICLES_PER_HOUR: options.rate ?? "1",
				AI_NEWS_SITE_ORIGIN: "https://3aik.com",
				INDEXNOW_KEY: options.indexNow,
				GITHUB_IMAGES_TOKEN: options.token,
			},
			repo,
			now,
			fetchImpl: fetchImpl as typeof fetch,
			writeDraft,
			paint,
			ping,
		},
	};
}

describe("publish cycle", () => {
	it("publishes one gated article and commits a jpeg to GitHub", async () => {
		const { deps, repo, writeDraft, paint, ping, githubCalls } = harness({ token: "ghp-test" });
		const report = await runPublishCycle(deps);
		expect(report.skipped).toBe("published");
		expect(report.published).toHaveLength(1);
		expect(writeDraft).toHaveBeenCalledTimes(1);
		expect(paint).toHaveBeenCalledTimes(1);
		expect(ping).toHaveBeenCalledTimes(1);
		const article = await repo.getBySlug(report.published[0] ?? "");
		expect(article?.authorId).toBe("adele-okonkwo");
		expect(article?.sources[0]?.url).toBe("https://example.com/fresh-bulletin");
		expect(article?.bodyText).toContain("The Verge");
		expect(article?.bodyHtml).toBe("");
		expect(article?.imageKey).toBe(`images/2026/10/${article?.slug}-${article?.id.slice(0, 8)}-16x9.webp`);
		expect(article?.imageType).toBe("image/webp");
		expect(article?.imageCommit).toBe(COMMIT_SHA);
		expect(githubCalls.filter((call) => call.method === "PUT")).toHaveLength(5);
		expect(githubCalls.at(-1)?.method).toBe("PUT");
		expect(githubCalls.at(-1)?.url).toBe(`https://api.github.com/repos/alivirgo/3aik-ai-news-images/contents/${article?.imageKey}`);
		expect(githubCalls[0]?.authorization).toBe("Bearer ghp-test");
		expect(githubCalls[0]?.url).not.toContain("ghp-test");
		expect(JSON.parse(githubCalls.at(-1)?.body ?? "{}").content).not.toBe(Buffer.from(TINY_PNG).toString("base64"));
	});

	it("publishes with no image when the token is missing, the painter throws, or GitHub rejects the commit", async () => {
		const missing = harness();
		const missingReport = await runPublishCycle(missing.deps);
		expect(missingReport.published).toHaveLength(1);
		expect(missing.paint).not.toHaveBeenCalled();
		expect((await missing.repo.getBySlug(missingReport.published[0] ?? ""))?.imageKey).toBe("");
		expect(await missing.repo.isRejected("https://example.com/fresh-bulletin", now.toISOString())).toBe(false);

		const painted = harness({ token: "ghp-test" });
		painted.paint.mockRejectedValue(new Error("image down"));
		const paintedReport = await runPublishCycle(painted.deps);
		expect(paintedReport.published).toHaveLength(1);
		expect((await painted.repo.getBySlug(paintedReport.published[0] ?? ""))?.imageKey).toBe("");
		expect(await painted.repo.isRejected("https://example.com/fresh-bulletin", now.toISOString())).toBe(false);

		const rejected = harness({ token: "ghp-test", githubStatus: 500 });
		const rejectedReport = await runPublishCycle(rejected.deps);
		expect(rejectedReport.published).toHaveLength(1);
		expect((await rejected.repo.getBySlug(rejectedReport.published[0] ?? ""))?.imageKey).toBe("");
		expect(rejected.githubCalls[0]?.method).toBe("PUT");

		const png = harness({ token: "ghp-test" });
		png.paint.mockResolvedValue({ bytes: TINY_PNG, contentType: "image/png", model: "dry-run" });
		const pngReport = await runPublishCycle(png.deps);
		expect((await png.repo.getBySlug(pngReport.published[0] ?? ""))?.imageKey.endsWith("-16x9.webp")).toBe(true);
		expect(png.githubCalls.some((call) => call.method === "PUT")).toBe(true);
	});

	it("retries after a slop rejection and publishes the clean draft once", async () => {
		const { deps, writeDraft } = harness();
		writeDraft
			.mockResolvedValueOnce({ text: JSON.stringify({ ...draft(), paragraphs: ["Please delve into this."] }), model: "dry-run" })
			.mockResolvedValueOnce({ text: JSON.stringify(draft()), model: "dry-run" });
		const report = await runPublishCycle(deps);
		expect(report.published).toHaveLength(1);
		expect(writeDraft).toHaveBeenCalledTimes(2);
		expect(deps.repo.articles[0]?.bodyText).not.toContain("delve");
	});

	it("prunes and does not call Workers AI when the generator is off or unset", async () => {
		for (const mode of ["off", "unset"] as const) {
			const run = harness(mode === "unset" ? { omitGenerator: true } : { generator: "off" });
			const old = existing("https://example.com/aged-generator", "2026-01-01T00:00:00.000Z");
			old.imageKey = "";
			run.repo.articles.push(old);
			const report = await runPublishCycle(run.deps);
			expect(report.skipped).toBe("generator-off");
			expect(report.published).toEqual([]);
			expect(run.writeDraft).not.toHaveBeenCalled();
			expect(run.paint).not.toHaveBeenCalled();
			expect(run.fetchImpl).not.toHaveBeenCalled();
			expect(run.repo.articles.find((article) => article.id === old.id)).toBeUndefined();
			expect(await run.repo.tryLock("2026-10-23T13:00:00.000Z", now.toISOString())).toBe(true);
		}
	});

	it("does not call the writer when publishing is paused or the hourly quota is full", async () => {
		const paused = harness({ publishing: "paused" });
		expect((await runPublishCycle(paused.deps)).skipped).toBe("paused");
		expect(paused.writeDraft).not.toHaveBeenCalled();

		const full = harness();
		full.repo.articles.push(existing("https://example.com/already", now.toISOString()));
		expect((await runPublishCycle(full.deps)).skipped).toBe("quota");
		expect(full.writeDraft).not.toHaveBeenCalled();
	});

	it("skips a source URL that was already published", async () => {
		const { deps, writeDraft, repo } = harness();
		repo.articles.push(existing("https://example.com/fresh-bulletin", "2026-10-22T00:00:00.000Z"));
		const report = await runPublishCycle(deps);
		expect(report.skipped).toBe("no-stories");
		expect(writeDraft).not.toHaveBeenCalled();
		expect(repo.articles).toHaveLength(1);
	});

	it("stores a failed source and will not pay for it again until the TTL ends", async () => {
		const { deps, repo, writeDraft } = harness({ rate: "1" });
		deps.env.AI_NEWS_TEXT_CALLS_PER_ARTICLE = "1";
		writeDraft.mockResolvedValue({ text: "not json", model: "dry-run" });
		const first = await runPublishCycle(deps);
		expect(first.published).toEqual([]);
		expect(writeDraft).toHaveBeenCalledTimes(1);
		expect(await repo.isRejected("https://example.com/fresh-bulletin", now.toISOString())).toBe(true);
		expect(await repo.isRejected("https://example.com/fresh-bulletin", new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString())).toBe(true);

		writeDraft.mockClear();
		const second = await runPublishCycle(deps);
		expect(second.skipped).toBe("no-stories");
		expect(writeDraft).not.toHaveBeenCalled();
	});

	it("stops after two failed stories instead of walking the rest of the feed", async () => {
		const { deps, repo, writeDraft } = harness();
		deps.fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url !== feed!.url) return new Response("no", { status: 404 });
			const items = ["one", "two", "three"].map((name) => `<item>
<title>Separate bulletin ${name} for the desk</title>
<link>https://example.com/${name}</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>Quilted badgers maintain a violet harbor while the ${name} status page stays quiet today.</description>
</item>`).join("");
			return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
				status: 200,
				headers: { "content-type": "application/rss+xml" },
			});
		});
		writeDraft.mockResolvedValue({ text: "not json", model: "dry-run" });
		await runPublishCycle(deps);
		expect(writeDraft.mock.calls.length).toBeLessThanOrEqual(6);
		expect(await repo.isRejected("https://example.com/one", now.toISOString())).toBe(true);
		expect(await repo.isRejected("https://example.com/two", now.toISOString())).toBe(true);
		expect(await repo.isRejected("https://example.com/three", now.toISOString())).toBe(false);
	});

	it("deletes the D1 row before the GitHub file, and still drops the row if GitHub fails", async () => {
		const { deps, repo, githubCalls } = harness({ token: "ghp-test", githubStatus: 500 });
		deps.env.AI_NEWS_RETENTION_DAYS = "1";
		const old = existing("https://example.com/aged", "2026-01-01T00:00:00.000Z");
		old.imageKey = "images/2026/01/already-published.jpg";
		old.imageType = "image/jpeg";
		repo.articles.push(old);
		await runPublishCycle(deps);
		expect(repo.articles.find((article) => article.id === old.id)).toBeUndefined();
		expect(githubCalls[0]?.method).toBe("GET");
		expect(githubCalls[0]?.url).toContain("images/2026/01/already-published.jpg");
		expect(githubCalls[1]?.method).toBe("DELETE");
	});

	it("stops retention and later image commits when GitHub asks for a pause", async () => {
		const { deps, repo, paint } = harness({ token: "ghp-test" });
		deps.env.AI_NEWS_RETENTION_DAYS = "1";
		const older = existing("https://example.com/aged-1", "2026-01-01T00:00:00.000Z");
		older.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
		older.slug = "aged-one";
		older.imageKey = "images/2026/01/aged-one.jpg";
		older.imageType = "image/jpeg";
		older.imageCommit = COMMIT_SHA;
		const newer = existing("https://example.com/aged-2", "2026-02-01T00:00:00.000Z");
		newer.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
		newer.slug = "aged-two";
		newer.imageKey = "images/2026/02/aged-two.jpg";
		newer.imageType = "image/jpeg";
		newer.imageCommit = COMMIT_SHA;
		repo.articles.push(older, newer);
		deps.fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === feed!.url) return new Response(rss(), { status: 200, headers: { "content-type": "application/rss+xml" } });
			if (url.startsWith("https://api.github.com/")) {
				return new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit." }), {
					status: 403,
					headers: { "retry-after": "30", "x-ratelimit-remaining": "4000" },
				});
			}
			return new Response("no", { status: 404 });
		});
		await runPublishCycle(deps);
		expect(repo.articles.find((article) => article.id === older.id)).toBeUndefined();
		expect(repo.articles.find((article) => article.id === newer.id)).toBeTruthy();
		expect(paint).not.toHaveBeenCalled();
		expect(deps.fetchImpl.mock.calls.filter((call) => {
			const url = typeof call[0] === "string" ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url;
			return url.startsWith("https://api.github.com/");
		})).toHaveLength(1);
	});

	it("keeps publishing when an article mentions 3036", async () => {
		const { deps, repo, writeDraft } = harness({ rate: "4" });
		deps.fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url !== feed!.url) return new Response("no", { status: 404 });
			const items = ["one", "two"].map((name) => `<item>
<title>Separate bulletin ${name} for the desk</title>
<link>https://example.com/${name}</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>Quilted badgers maintain a violet harbor while the ${name} status page stays quiet today.</description>
</item>`).join("");
			return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
				status: 200,
				headers: { "content-type": "application/rss+xml" },
			});
		});
		let call = 0;
		writeDraft.mockImplementation(async () => {
			call += 1;
			const body = draft();
			if (call > 1) {
				body.title = "Harbor lights, retold without adding prices or dates";
				body.description = "The outlet reported a harbor note. This brief stays inside that note and does not add names, prices, or a scoreboard.";
				body.paragraphs = body.paragraphs.map((paragraph) => paragraph
					.replaceAll("product", "harbor")
					.replaceAll("excerpt", "harbor text")
					.replaceAll("limit", "boundary")
					.replaceAll("names", "labels")
					.replaceAll("price", "cost")
					.replaceAll("date", "day")
					.replaceAll("rollout", "launch")
					.replaceAll("blanks", "gaps")
					.replaceAll("figure", "amount")
					.replaceAll("link", "source")
					.replaceAll("retelling", "rewrite")
					.replaceAll("pass", "round"));
				body.keyPoints = body.keyPoints.map((point) => point.replaceAll("product", "harbor").replaceAll("names", "labels").replaceAll("price", "cost"));
			}
			body.paragraphs[0] = `${body.paragraphs[0]} Code 3036 stays a number in the note.`;
			return { text: JSON.stringify(body), model: "dry-run" };
		});
		const report = await runPublishCycle(deps);
		expect(report.published).toHaveLength(2);
		expect(writeDraft).toHaveBeenCalledTimes(2);
		expect(repo.articles.every((article) => article.bodyText.includes("3036"))).toBe(true);
	});

	it("stops the tick on the daily neuron cap without rejecting the source", async () => {
		const { deps, repo, writeDraft } = harness();
		deps.fetchImpl.mockImplementation(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url !== feed!.url) return new Response("no", { status: 404 });
			const items = ["one", "two"].map((name) => `<item>
<title>Separate bulletin ${name} for the desk</title>
<link>https://example.com/${name}</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>Quilted badgers maintain a violet harbor while the ${name} status page stays quiet today.</description>
</item>`).join("");
			return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
				status: 200,
				headers: { "content-type": "application/rss+xml" },
			});
		});
		writeDraft.mockRejectedValue(new Error("neuron_cap"));
		const report = await runPublishCycle(deps);
		expect(report.published).toEqual([]);
		expect(writeDraft).toHaveBeenCalledTimes(1);
		expect(await repo.isRejected("https://example.com/one", now.toISOString())).toBe(false);
		expect(await repo.isRejected("https://example.com/two", now.toISOString())).toBe(false);
	});

	it("publishes the current article with no image and does not start another story after error 3036", async () => {
		const { deps, repo, writeDraft, paint } = harness({ rate: "4", token: "ghp-test" });
		deps.fetchImpl.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			if (url === feed!.url) {
				const items = ["one", "two"].map((name) => `<item>
<title>Separate bulletin ${name} for the desk</title>
<link>https://example.com/${name}</link>
<pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate>
<description>Quilted badgers maintain a violet harbor while the ${name} status page stays quiet today.</description>
</item>`).join("");
				return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, {
					status: 200,
					headers: { "content-type": "application/rss+xml" },
				});
			}
			if (url.startsWith("https://api.github.com/")) {
				return new Response("{}", { status: 500, headers: { "x-ratelimit-remaining": "4000" } });
			}
			return new Response("no", { status: init ? 404 : 404 });
		});
		paint.mockRejectedValue(new Error("3036: You have used up your daily free allocation of 10,000 neurons."));
		const report = await runPublishCycle(deps);
		expect(report.published).toHaveLength(1);
		expect(writeDraft).toHaveBeenCalledTimes(1);
		expect(paint).toHaveBeenCalledTimes(1);
		expect((await repo.getBySlug(report.published[0] ?? ""))?.imageKey).toBe("");
		expect(await repo.isRejected("https://example.com/two", now.toISOString())).toBe(false);
	});

	it("stops when the wall clock is exhausted", async () => {
		const { deps, writeDraft } = harness();
		deps.env.AI_NEWS_WALL_MS = "45000";
		let clock = now.getTime();
		deps.clock = () => clock;
		writeDraft.mockImplementation(async () => {
			clock += 60_000;
			return { text: "not json", model: "dry-run" };
		});
		await runPublishCycle(deps);
		expect(writeDraft).toHaveBeenCalledTimes(1);
	});

	it("stores a new image path when a later article reuses a deleted slug", async () => {
		const { deps, repo } = harness({ token: "ghp-test" });
		const first = await runPublishCycle(deps);
		const firstArticle = repo.articles[0];
		expect(first.published).toEqual([firstArticle?.slug]);
		repo.articles.length = 0;
		const second = await runPublishCycle(deps);
		const secondArticle = repo.articles[0];
		expect(second.published).toEqual([firstArticle?.slug]);
		expect(secondArticle?.slug).toBe(firstArticle?.slug);
		expect(secondArticle?.imageKey).toBe(`images/2026/10/${secondArticle?.slug}-${secondArticle?.id.slice(0, 8)}-16x9.webp`);
		expect(secondArticle?.imageKey).not.toBe(firstArticle?.imageKey);
	});

	it("releases the lock after a cycle", async () => {
		const { deps, repo } = harness({ publishing: "off" });
		await runPublishCycle(deps);
		expect(await repo.tryLock("2026-10-23T12:10:00.000Z", now.toISOString())).toBe(true);
	});
});

describe("IndexNow", () => {
	it("posts the article URL when a key is configured and ignores a bad key", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(`${typeof input === "string" ? input : input.toString()} ${init?.method ?? "GET"}`);
			return new Response("ok");
		});
		await pingIndexNow({ INDEXNOW_KEY: "index-key" }, ["https://3aik.com/ai-news/article/demo"], fetchImpl as typeof fetch);
		expect(calls[0]).toContain("https://api.indexnow.org/indexnow POST");
		const body = JSON.parse(String((fetchImpl.mock.calls[0] ?? [])[1]?.body));
		expect(body.urlList).toEqual(["https://3aik.com/ai-news/article/demo"]);
		expect(body.keyLocation).toBe("https://3aik.com/index-key.txt");

		const skipped = vi.fn();
		await pingIndexNow({ INDEXNOW_KEY: "short" }, ["https://3aik.com/ai-news/article/demo"], skipped as typeof fetch);
		expect(skipped).not.toHaveBeenCalled();
	});
});

function existing(url: string, publishedAt: string): StoredArticle {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		slug: "already-published",
		title: "An older desk brief that is not this story",
		description: "Older.",
		category: "ai",
		tags: ["desk"],
		authorId: "adele-okonkwo",
		bodyHtml: "<p>Older.</p>",
		bodyText: "Older body text about a different subject entirely.",
		keyPoints: [],
		faq: [],
		sources: [{ url, title: "Old", outlet: "The Verge" }],
		related: [],
		imageKey: "articles/old.png",
		imageCommit: "",
		imageAlt: "Old abstract squares.",
		imageType: "image/png",
		imageCredit: "",
		imageSourceUrl: "",
		publishedAt,
		updatedAt: publishedAt,
	};
}
