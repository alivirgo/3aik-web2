import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { AUTHORS } from "../src/news/authors";
import { handleNewsRequest } from "../src/news/routes";
import { tokensMatch } from "../src/news/ingest";
import { D1NewsRepository, MemoryNewsRepository } from "../src/news/repository";
import { pageViewFromRequest } from "../src/news/pageviews";
import type { StoredArticle } from "../src/news/types";
import { solidPng } from "../src/news/image-crop";
import { TINY_JPEG, TINY_PNG, slugify } from "../src/news/text";

const WIDE_PNG = solidPng(1400, 800);
function wideBase64(): string {
	return Buffer.from(WIDE_PNG).toString("base64");
}

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
		const category = await send(post(articleFields({ category: "weather" })));
		expect(category.response.status).toBe(422);
		expect((await category.response.json() as { reasons: string[] }).reasons).toContain("category");

		const bareBreaking = await send(post(articleFields({ category: "breaking", author_slug: "leah-okoye" })));
		expect((await bareBreaking.response.json() as { reasons: string[] }).reasons).toContain("section");

		const breaking = await send(post(articleFields({
			category: "breaking",
			section: "finance",
			author_slug: "leah-okoye",
			sources: [{ url: "https://example.com/breaking-filing", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})));
		expect(breaking.response.status).toBe(201);
		expect(breaking.state.repo.articles[0]?.category).toBe("breaking");
		expect(breaking.state.repo.articles[0]?.section).toBe("finance");

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
			image: { data: `data:image/png;base64,${wideBase64()}`, alt: ALT },
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
		expect(article?.imageType).toBe("image/png");
		expect(article?.imageKey).toMatch(new RegExp(`^images/2026/10/${slug}-[a-f0-9]{8}\\.png$`));
		expect(article?.sources[0]?.url).toBe("https://example.com/story");
		expect(state.githubPuts).toHaveLength(1);
		expect(state.githubPuts[0]?.authorization).toBe("Bearer ghp-test");
		expect(state.githubPuts.at(-1)?.url).toBe(`https://api.github.com/repos/alivirgo/3aik-ai-news-images/contents/${article?.imageKey}`);
		expect(JSON.parse(state.githubPuts.at(-1)?.body ?? "{}").content).toBe(wideBase64());
		const stats = await state.repo.stats();
		expect(stats.authors["adele-okonkwo"]?.count).toBe(1);
		expect(stats.categories.ai?.count).toBe(1);
		expect(state.ai.run).not.toHaveBeenCalled();
		const indexNowCall = state.fetchImpl.mock.calls.find((call) => String(call[0]) === "https://www.bing.com/indexnow");
		const yandexCall = state.fetchImpl.mock.calls.find((call) => String(call[0]) === "https://yandex.com/indexnow");
		expect(indexNowCall?.[1]?.method).toBe("POST");
		expect(yandexCall?.[1]?.body).toBe(indexNowCall?.[1]?.body);
		expect(state.fetchImpl.mock.calls.some((call) => String(call[0]).includes("api.indexnow.org"))).toBe(false);
		const posted = JSON.parse(String(indexNowCall?.[1]?.body)) as { host: string; urlList: string[] };
		expect(posted.host).toBe("3aik.com");
		expect(posted.urlList).toEqual([
			`https://3aik.com/ai-news/article/${slug}`,
			"https://3aik.com/ai-news",
			"https://3aik.com/ai-news/archive",
			"https://3aik.com/ai-news/sitemap.xml",
			"https://3aik.com/ai-news/news-sitemap.xml",
		]);

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
			image: wideBase64(),
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
		expect(state.repo.articles[0]?.imageKey.endsWith(".png")).toBe(true);
		expect(state.githubPuts).toHaveLength(1);
	});

	it("stores a png and publishes without a picture when GitHub fails or the image token is missing", async () => {
		const png = desk();
		const pngBody = articleFields({
			image: { data: wideBase64(), alt: ALT },
			sources: [{ url: "https://example.com/png", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		});
		const pngResponse = await send(post(pngBody), png);
		expect(pngResponse.response.status).toBe(201);
		expect(png.repo.articles[0]?.imageKey.endsWith(".png")).toBe(true);
		expect(png.githubPuts).toHaveLength(1);

		const failed = desk({ githubStatus: 500 });
		const failedResponse = await send(post(articleFields({
			image: { data: wideBase64(), alt: ALT },
			sources: [{ url: "https://example.com/github-down", publisher: "The Verge", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})), failed);
		expect(failedResponse.response.status).toBe(201);
		expect(failed.repo.articles[0]?.imageKey).toBe("");

		const bare = desk();
		bare.env.GITHUB_IMAGES_TOKEN = "";
		const bareResponse = await send(post(articleFields({
			image: { data: wideBase64(), alt: ALT },
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
			imageCredit: "",
			imageSourceUrl: "",
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
		expect(body.limits.image_max_bytes).toBe(1_000_000);
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

describe("publisher images", () => {
	function imageFetch(routes: Record<string, Response | (() => Response)>) {
		const seen: string[] = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			seen.push(url);
			if (url.startsWith("https://api.github.com/")) {
				return new Response(JSON.stringify({ commit: { sha: COMMIT_SHA } }), {
					status: 201,
					headers: { "x-ratelimit-remaining": "4000" },
				});
			}
			const match = routes[url];
			if (match) return typeof match === "function" ? match() : match;
			if (url.startsWith("https://example.com/")) {
				return new Response(EXCERPT, { status: 200, headers: { "content-type": "text/plain" } });
			}
			return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
		});
		return { fetchImpl: fetchImpl as typeof fetch, seen };
	}

	function fields(overrides: Record<string, unknown> = {}) {
		return articleFields({
			image_alt: ALT,
			body_markdown: [1, 2, 3, 4, 5, 6].map((index) => paragraph(index, "WWD")).join("\n\n"),
			sources: [{
				url: "https://example.com/source-photo",
				publisher: "WWD",
				title: "Vendor posts a short Thursday bulletin",
				excerpt: EXCERPT,
			}],
			...overrides,
		});
	}

	it("stores a publisher JPEG and keeps the credit", async () => {
		const state = desk();
		const imageUrl = "https://images.example.net/photo.jpg";
		const { fetchImpl, seen } = imageFetch({
			[imageUrl]: new Response(WIDE_PNG, { status: 200, headers: { "content-type": "image/png" } }),
		});
		state.fetchImpl = fetchImpl;
		const { response } = await send(post(fields({ image_source_url: imageUrl, image_credit: "Image: WWD" })), state);
		expect(response.status).toBe(201);
		const article = state.repo.articles[0];
		expect(article?.imageKey.endsWith(".png")).toBe(true);
		expect(article?.imageCommit).toBe(COMMIT_SHA);
		expect(article?.imageCredit).toBe("Image: WWD");
		expect(article?.imageSourceUrl).toBe(imageUrl);
		expect(article?.imageAlt).toBe(ALT);
		expect(seen.some((url) => url === imageUrl)).toBe(true);
		const page = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/article/${article?.slug}`),
			state.env,
			{ repo: state.repo },
		);
		const html = await page.text();
		expect(html).toContain(`/ai-news/media/${COMMIT_SHA}/`);
		expect(html).toContain("<figcaption>Image: WWD</figcaption>");
		expect(html).not.toContain("images.example.net");
		expect(page.headers.get("content-security-policy")).not.toContain("images.example.net");
		expect(page.headers.get("content-security-policy")).toContain("pagead2.googlesyndication.com");
	});

	it("stores a publisher PNG and drops the picture when the fetch fails", async () => {
		const pngUrl = "https://images.example.net/photo.png";
		const pngState = desk();
		pngState.fetchImpl = imageFetch({
			[pngUrl]: new Response(WIDE_PNG, { status: 200, headers: { "content-type": "image/png" } }),
		}).fetchImpl;
		const png = await send(post(fields({ image_source_url: pngUrl, image_credit: "WWD" })), pngState);
		expect(png.response.status).toBe(201);
		expect(pngState.repo.articles[0]?.imageKey.endsWith(".png")).toBe(true);
		expect(pngState.repo.articles[0]?.imageCredit).toBe("Image: WWD");
		expect(pngState.repo.articles[0]?.imageSourceUrl).toBe(pngUrl);
		const page = await handleNewsRequest(
			new Request(`https://3aik.test/ai-news/article/${pngState.repo.articles[0]?.slug}`),
			pngState.env,
			{ repo: pngState.repo },
		);
		const html = await page.text();
		expect(html).toContain("/ai-news/media/");
		expect(html).not.toContain(`src="${pngUrl}"`);
		expect(html).toContain("<figcaption>Image: WWD</figcaption>");
		expect(page.headers.get("content-security-policy")).not.toContain("images.example.net");

		const missing = desk();
		missing.fetchImpl = imageFetch({}).fetchImpl;
		const missed = await send(post(fields({
			image_source_url: "https://images.example.net/missing.jpg",
			sources: [{ url: "https://example.com/missing-photo", publisher: "WWD", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})), missing);
		expect(missed.response.status).toBe(201);
		expect(missing.repo.articles[0]?.imageKey).toBe("");
		expect(missing.repo.articles[0]?.imageSourceUrl).toBe("");
		expect(missing.repo.articles[0]?.imageCredit).toBe("");
	});

	it("rejects private and non-https image URLs and does not follow an internal redirect", async () => {
		for (const imageUrl of [
			"http://images.example.net/photo.jpg",
			"https://127.0.0.1/photo.jpg",
			"https://10.1.2.3/photo.jpg",
			"https://169.254.169.254/latest/meta-data",
			"https://localhost/photo.jpg",
			"https://metadata.google.internal/computeMetadata/v1/",
			"https://user:pass@images.example.net/photo.jpg",
			"https://2130706433/photo.jpg",
			"https://169.254.169.254.nip.io/photo.jpg",
		]) {
			const state = desk();
			const { response } = await send(post(fields({ image_source_url: imageUrl })), state);
			expect(response.status, imageUrl).toBe(422);
			const body = await response.json() as { reasons: string[] };
			expect(body.reasons, imageUrl).toContain("image_source_url");
			expect(state.fetchImpl).not.toHaveBeenCalled();
		}

		const state = desk();
		const seen: string[] = [];
		state.fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			seen.push(url);
			if (url === "https://images.example.net/jump") {
				return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
			}
			if (url.startsWith("https://example.com/")) return new Response(EXCERPT, { headers: { "content-type": "text/plain" } });
			return new Response("no", { status: 404 });
		}) as typeof fetch;
		const { response } = await send(post(fields({ image_source_url: "https://images.example.net/jump" })), state);
		expect(response.status).toBe(201);
		expect(state.repo.articles[0]?.imageSourceUrl).toBe("");
		expect(seen.some((url) => url.includes("169.254.169.254"))).toBe(false);

		const huge = desk();
		huge.fetchImpl = imageFetch({
			"https://images.example.net/huge.jpg": new Response(TINY_JPEG, {
				status: 200,
				headers: { "content-type": "image/jpeg", "content-length": String(5 * 1024 * 1024 + 1) },
			}),
		}).fetchImpl;
		const oversized = await send(post(fields({
			image_source_url: "https://images.example.net/huge.jpg",
			sources: [{ url: "https://example.com/huge-photo", publisher: "WWD", title: "Vendor posts a short Thursday bulletin", excerpt: EXCERPT }],
		})), huge);
		expect(oversized.response.status).toBe(201);
		expect(huge.repo.articles[0]?.imageKey).toBe("");
		expect(huge.repo.articles[0]?.imageSourceUrl).toBe("https://images.example.net/huge.jpg");
	});

	it("prefers the publisher image over uploaded bytes and still checks alt text", async () => {
		const state = desk();
		const imageUrl = "https://images.example.net/chosen.jpg";
		state.fetchImpl = imageFetch({
			[imageUrl]: new Response(WIDE_PNG, { status: 200, headers: { "content-type": "image/png" } }),
		}).fetchImpl;
		const { response } = await send(post(fields({
			image_source_url: imageUrl,
			image: { data: Buffer.from(TINY_PNG).toString("base64"), alt: ALT },
		})), state);
		expect(response.status).toBe(201);
		expect(state.repo.articles[0]?.imageKey.endsWith(".png")).toBe(true);

		const short = desk();
		const rejected = await send(post(fields({ image_source_url: imageUrl, image_alt: "too short" })), short);
		expect(rejected.response.status).toBe(422);
		const reasons = await rejected.response.json() as { reasons: string[] };
		expect(reasons.reasons).toContain("image_alt");
		expect(short.repo.articles).toHaveLength(0);
	});

	it("keeps publishing when the stats write budget is exhausted", async () => {
		const calls: string[] = [];
		const db = {
			prepare(sql: string) {
				return {
					bind() {
						return {
							async run() {
								calls.push(sql.toLowerCase());
								return { meta: { changes: 1 } };
							},
						};
					},
				};
			},
		};
		const stats = new D1NewsRepository(db as unknown as D1Database, { budget: { async open() { return false; }, async charge() {} } });
		const event = pageViewFromRequest(
			new Request("https://3aik.test/ai-news/article/short-bulletin"),
			{ slug: "short-bulletin", page: "article" },
			NOW,
			"3aik.com",
		);
		event.visitorHash = "cd".repeat(32);
		await stats.recordPageView(event);
		expect(calls.join("\n")).not.toContain("stats_article_hour");
		expect(calls.join("\n")).not.toContain("page_views");
		const state = desk({ page: "<p>Routine maintenance was mentioned on the status page.</p>" });
		const { response } = await send(post(articleFields({
			image: { data: `data:image/jpeg;base64,${jpegBase64()}`, alt: ALT },
		})), state);
		expect(response.status).toBe(201);
		expect(state.repo.articles).toHaveLength(1);
	});
});
