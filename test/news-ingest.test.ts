import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { AUTHORS } from "../src/news/authors";
import { handleNewsRequest } from "../src/news/routes";
import { tokensMatch } from "../src/news/ingest";
import { MemoryNewsRepository } from "../src/news/repository";
import type { StoredArticle } from "../src/news/types";
import { TINY_JPEG, TINY_PNG, slugify } from "../src/news/text";

const TOKEN = "ab".repeat(32);
const NOW = new Date("2026-10-23T12:07:00.000Z");
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const ALT = "Abstract stack of paper rectangles in sand and ink blue on a warm gray field.";
const EXCERPT = "A vendor posted a short bulletin about a routine maintenance window for its public status page.";

function paragraph(index: number, outlet = "The Verge"): string {
	return [
		`${outlet} reported a narrow product note, and this retelling keeps that limit on pass ${index}.`,
		"The excerpt stops there.",
		"No extra names are added in this pass.",
		"Until a later report from the same outlet prints a price, a date, and a rollout list, this desk will leave those blanks empty rather than invent a figure the source never printed.",
		"Hold the limit here.",
		"Open the link.",
	].join(" ");
}

function articleFields(overrides: Record<string, unknown> = {}) {
	return {
		title: "A short bulletin, retold with the blanks left blank",
		dek: "The outlet reported a narrow note. This brief stays inside that note and does not add names, prices, or a scoreboard.",
		category: "ai",
		author_slug: "adele-okonkwo",
		body_markdown: [1, 2, 3, 4, 5, 6].map((index) => paragraph(index)).join("\n\n"),
		tags: ["desk", "brief"],
		key_points: [
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
		sources: [{
			url: "https://www.example.com/story?utm_source=desk",
			publisher: "The Verge",
			title: "Vendor posts a short Thursday bulletin",
			excerpt: EXCERPT,
		}],
		...overrides,
	};
}

function jpegBase64(): string {
	return Buffer.from(TINY_JPEG).toString("base64");
}

interface FetchOptions {
	githubStatus?: number;
	page?: string | null;
}

function desk(options: FetchOptions = {}) {
	const repo = new MemoryNewsRepository();
	const ai = { run: vi.fn() };
	const githubPuts: Array<{ url: string; authorization: string; body: string }> = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (url.startsWith("https://api.github.com/")) {
			const headers = new Headers(init?.headers);
			githubPuts.push({
				url,
				authorization: headers.get("authorization") ?? "",
				body: typeof init?.body === "string" ? init.body : "",
			});
			const status = options.githubStatus ?? 201;
			const body = status === 201
				? JSON.stringify({ commit: { sha: COMMIT_SHA } })
				: "{}";
			return new Response(body, { status, headers: { "x-ratelimit-remaining": "4000" } });
		}
		if (options.page != null) {
			return new Response(options.page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
		}
		return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
	});
	const env = {
		AI: ai,
		AI_NEWS_INGEST_TOKEN: TOKEN,
		AI_NEWS_SITE_ORIGIN: "https://3aik.com",
		GITHUB_IMAGES_TOKEN: "ghp-test",
		AI_NEWS_GENERATOR: "off",
	};
	return { repo, env, fetchImpl, githubPuts, ai };
}

function post(body: unknown, token = TOKEN, path = "/ai-news/api/ingest"): Request {
	return new Request(`https://3aik.test${path}`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
}

async function send(request: Request, state = desk()) {
	const response = await handleNewsRequest(request, state.env, {
		repo: state.repo,
		fetchImpl: state.fetchImpl as typeof fetch,
		now: NOW,
	});
	return { response, state };
}

describe("ingest auth", () => {
	it("compares the bearer token in constant time and rejects a longer lookalike", async () => {
		expect(await tokensMatch(TOKEN, TOKEN)).toBe(true);
		expect(await tokensMatch("nope", TOKEN)).toBe(false);
		expect(await tokensMatch(`${TOKEN}${"x".repeat(80)}`, TOKEN)).toBe(false);
		expect(await tokensMatch(`${"z".repeat(600)}`, "z".repeat(600))).toBe(false);
	});

	it("hides the route when the secret is unset and rejects a bad bearer", async () => {
		const hidden = await worker.fetch(
			new Request("https://3aik.test/ai-news/api/ingest", { method: "POST", body: "{}" }),
			{ AI: { run: vi.fn() }, ASSETS: { fetch: vi.fn() } } as never,
		);
		expect(hidden.status).toBe(404);
		expect(await hidden.json()).toEqual({ error: "not_found" });

		const { response, state } = await send(post(articleFields(), "wrong-token"));
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
		expect(await response.json()).toEqual({ error: "unauthorized" });
		expect(state.repo.articles).toHaveLength(0);
		expect(state.ai.run).not.toHaveBeenCalled();

		const lower = await send(new Request("https://3aik.test/ai-news/api/ingest/meta", {
			headers: { authorization: `bearer ${TOKEN}` },
		}));
		expect(lower.response.status).toBe(200);

		const section = await worker.fetch(
			new Request("https://3aik.test/ai-news", { method: "POST" }),
			{ ...desk().env, ASSETS: { fetch: vi.fn() } } as never,
		);
		expect(section.status).toBe(405);
	});
});

describe("ingest validation and the quality gate", () => {
	it("rejects a bad category, author, source list, and image before insert", async () => {
		const category = await send(post(articleFields({ category: "sports" })));
		expect(category.response.status).toBe(422);
		expect((await category.response.json() as { reasons: string[] }).reasons).toContain("category");

		const author = await send(post(articleFields({ author_slug: "not-a-persona" })));
		expect((await author.response.json() as { reasons: string[] }).reasons).toContain("author_slug");

		const mismatch = await send(post(articleFields({ category: "fashion", author_slug: "adele-okonkwo" })));
		expect((await mismatch.response.json() as { reasons: string[] }).reasons).toEqual(["author_category"]);

		const sources = await send(post(articleFields({ sources: [] })));
		expect((await sources.response.json() as { reasons: string[] }).reasons).toEqual(["sources"]);

		const showbiz = await send(post(articleFields({
			category: "showbiz",
			author_slug: "freya-moss",
			sources: [],
		})));
		expect((await showbiz.response.json() as { reasons: string[] }).reasons).toEqual(["showbiz_source"]);

		const encoding = await send(post(articleFields({ image: "!!!" })));
		expect((await encoding.response.json() as { reasons: string[] }).reasons).toEqual(["image_encoding"]);

		const type = await send(post(articleFields({
			image: { data: Buffer.from("not an image").toString("base64"), alt: ALT },
		})));
		expect((await type.response.json() as { reasons: string[] }).reasons).toEqual(["image_type"]);
		expect(type.state.repo.articles).toHaveLength(0);
	});

	it("returns the same gate reasons for dashes, slop, length, allegations, copy, and an unread source", async () => {
		const dashed = articleFields();
		dashed.title = `${dashed.title.slice(0, 40)} \u2014 note`;
		const dash = await send(post(dashed));
		expect((await dash.response.json() as { reasons: string[] }).reasons).toContain("em_dash");

		const sloppy = articleFields();
		sloppy.body_markdown = `${sloppy.body_markdown}\n\nIt is worth noting the limit stays in place for this pass.`;
		const slop = await send(post(sloppy));
		expect((await slop.response.json() as { reasons: string[] }).reasons).toContain("slop:worth-noting");

		const short = await send(post(articleFields({ body_markdown: "Too short to publish." })));
		expect((await short.response.json() as { reasons: string[] }).reasons.some((reason) => reason.startsWith("too_short:"))).toBe(true);

		const accused = articleFields({
			category: "showbiz",
			author_slug: "freya-moss",
			body_markdown: [paragraph(1), paragraph(2), "A filing accused the vendor of delay.", paragraph(3), paragraph(4), paragraph(5)].join("\n\n"),
		});
		const allegation = await send(post(accused));
		expect((await allegation.response.json() as { reasons: string[] }).reasons).toContain("unattributed_allegation");

		const copied = desk({ page: "<p>The Verge reported a narrow product note and nothing further was printed.</p>" });
		const copy = await send(post(articleFields()), copied);
		expect(copy.response.status).toBe(422);
		expect((await copy.response.json() as { reasons: string[] }).reasons.some((reason) => reason.startsWith("copied_sequence:"))).toBe(true);

		const unread = desk();
		const quiet = articleFields();
		quiet.sources = [{ url: "https://example.com/quiet", publisher: "The Verge", title: "Note" }];
		const missing = await send(post(quiet), unread);
		expect((await missing.response.json() as { reasons: string[] }).reasons).toContain("source_unread:example.com");
		expect(unread.repo.articles).toHaveLength(0);
	});
});

describe("ingest publish", () => {
	it("stores a jpeg sent as a data URL and returns the public article url", async () => {
		const state = desk({ page: "<p>Routine maintenance was mentioned on the status page.</p>" });
		const payload = articleFields({
			image: { data: `data:image/jpeg;base64,${jpegBase64()}`, alt: ALT },
		});
		const { response } = await send(post(payload), state);
		expect(response.status).toBe(201);
		const body = await response.json() as { url: string; slug: string };
		const slug = slugify(payload.title);
		expect(body).toEqual({ url: `https://3aik.com/ai-news/article/${slug}`, slug });
		const article = state.repo.articles[0];
		expect(article?.bodyHtml).toBe("");
		expect(article?.authorId).toBe("adele-okonkwo");
		expect(article?.category).toBe("ai");
		expect(article?.imageAlt).toBe(ALT);
		expect(article?.imageCommit).toBe(COMMIT_SHA);
		expect(article?.imageType).toBe("image/jpeg");
		expect(article?.imageKey).toMatch(new RegExp(`^images/2026/10/${slug}-[a-f0-9]{8}\\.jpg$`));
		expect(article?.sources[0]?.url).toBe("https://example.com/story");
		expect(state.githubPuts).toHaveLength(1);
		expect(state.githubPuts[0]?.authorization).toBe("Bearer ghp-test");
		expect(state.githubPuts[0]?.url).toBe(`https://api.github.com/repos/alivirgo/3aik-ai-news-images/contents/${article?.imageKey}`);
		expect(JSON.parse(state.githubPuts[0]?.body ?? "{}").content).toBe(jpegBase64());
		const stats = await state.repo.stats();
		expect(stats.authors["adele-okonkwo"]?.count).toBe(1);
		expect(stats.categories.ai?.count).toBe(1);
		expect(state.ai.run).not.toHaveBeenCalled();

		const again = await send(post(payload), state);
		expect(again.response.status).toBe(409);
		const conflict = await again.response.json() as { error: string; conflicts: Array<{ field: string; value: string }> };
		expect(conflict.error).toBe("duplicate");
		expect(conflict.conflicts).toEqual(expect.arrayContaining([
			{ field: "slug", value: slug },
			{ field: "source_url", value: "https://example.com/story" },
		]));
	});

	it("accepts a raw base64 string and the tech category alias", async () => {
		const state = desk();
		const payload = articleFields({
			category: "tech",
			author_slug: "caleb-ortiz",
			image: jpegBase64(),
			image_alt: ALT,
			sources: [{
				url: "https://example.com/gadget",
				publisher: "The Verge",
				title: "Vendor posts a short Thursday bulletin",
				excerpt: EXCERPT,
			}],
		});
		const { response } = await send(post(payload), state);
		expect(response.status).toBe(201);
		expect(state.repo.articles[0]?.category).toBe("technology");
		expect(state.repo.articles[0]?.authorId).toBe("caleb-ortiz");
		expect(state.repo.articles[0]?.imageKey.endsWith(".jpg")).toBe(true);
		expect(JSON.parse(state.githubPuts[0]?.body ?? "{}").content).toBe(jpegBase64());
	});

	it("publishes without a picture when the file is png, GitHub fails, or the image token is missing", async () => {
		const png = desk();
		const pngBody = articleFields({
			image: { data: Buffer.from(TINY_PNG).toString("base64"), alt: ALT },
			sources: [{ url: "https://example.com/png", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		});
		const pngResponse = await send(post(pngBody), png);
		expect(pngResponse.response.status).toBe(201);
		expect(png.repo.articles[0]?.imageKey).toBe("");
		expect(png.githubPuts).toHaveLength(0);

		const failed = desk({ githubStatus: 500 });
		const failedResponse = await send(post(articleFields({
			image: { data: jpegBase64(), alt: ALT },
			sources: [{ url: "https://example.com/github-down", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})), failed);
		expect(failedResponse.response.status).toBe(201);
		expect(failed.repo.articles[0]?.imageKey).toBe("");

		const bare = desk();
		bare.env.GITHUB_IMAGES_TOKEN = "";
		const bareResponse = await send(post(articleFields({
			image: { data: jpegBase64(), alt: ALT },
			sources: [{ url: "https://example.com/no-token", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})), bare);
		expect(bareResponse.response.status).toBe(201);
		expect(bare.repo.articles[0]?.imageKey).toBe("");
		expect(bare.githubPuts).toHaveLength(0);
	});

	it("rejects a source URL already stored on a different story", async () => {
		const state = desk();
		const seeded = {
			id: "11111111-1111-4111-8111-111111111111",
			slug: "older-unrelated-archive-note",
			title: "Older unrelated archive note from a different desk week",
			description: "A separate archive row used only to reserve a source URL.",
			category: "technology",
			tags: ["archive", "note"],
			authorId: "caleb-ortiz",
			bodyHtml: "",
			bodyText: "Completely different wording about a warehouse inventory count and a paper log.",
			keyPoints: [],
			faq: [],
			sources: [{ url: "https://example.com/shared-story", title: "Old", outlet: "Wire" }],
			related: [],
			imageKey: "",
			imageCommit: "",
			imageAlt: "",
			imageType: "",
			publishedAt: "2026-10-01T00:00:00.000Z",
			updatedAt: "2026-10-01T00:00:00.000Z",
		} satisfies StoredArticle;
		state.repo.articles.push(seeded);
		const { response } = await send(post(articleFields({
			sources: [{
				url: "https://www.example.com/shared-story?utm_source=newsletter",
				publisher: "The Verge",
				title: "Vendor posts a short Thursday bulletin",
				excerpt: EXCERPT,
			}],
		})), state);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "duplicate",
			conflicts: [{ field: "source_url", value: "https://example.com/shared-story" }],
		});
		expect(state.repo.articles).toHaveLength(1);
	});

	it("caps authenticated posts at ten per hour and still serves meta", async () => {
		const state = desk();
		for (let index = 0; index < 10; index += 1) {
			const response = await send(post({}), state);
			expect(response.response.status).toBe(422);
		}
		const limited = await send(post(articleFields()), state);
		expect(limited.response.status).toBe(429);
		const retry = await limited.response.json() as { error: string; retry_after: number };
		expect(retry).toEqual({ error: "rate_limited", retry_after: 3180 });
		expect(limited.response.headers.get("retry-after")).toBe("3180");

		const ignored = await send(post(articleFields(), "wrong-token"), state);
		expect(ignored.response.status).toBe(401);

		const meta = await handleNewsRequest(new Request("https://3aik.test/ai-news/api/ingest/meta", {
			headers: { authorization: `Bearer ${TOKEN}` },
		}), state.env, { repo: state.repo, now: NOW });
		expect(meta.status).toBe(200);
		const body = await meta.json() as {
			personas: Array<{ slug: string; name: string; beat: string }>;
			categories: Array<{ id: string; aliases: string[] }>;
			limits: { requests_per_hour: number; image_max_bytes: number };
			recent_source_urls: string[];
		};
		expect(body.personas).toHaveLength(AUTHORS.length);
		expect(body.personas[0]).toEqual(expect.objectContaining({ slug: expect.any(String), name: expect.any(String), beat: expect.any(String) }));
		expect(body.categories.find((category) => category.id === "technology")?.aliases).toEqual(["tech"]);
		expect(body.limits.requests_per_hour).toBe(10);
		expect(body.limits.image_max_bytes).toBe(1_572_864);
		expect(body.recent_source_urls).toEqual([]);

		const head = await handleNewsRequest(new Request("https://3aik.test/ai-news/api/ingest/meta", {
			method: "HEAD",
			headers: { authorization: `Bearer ${TOKEN}` },
		}), state.env, { repo: state.repo, now: NOW });
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");

		const wrong = await handleNewsRequest(new Request("https://3aik.test/ai-news/api/ingest", {
			headers: { authorization: `Bearer ${TOKEN}` },
		}), state.env, { repo: state.repo, now: NOW });
		expect(wrong.status).toBe(405);
	});
});
