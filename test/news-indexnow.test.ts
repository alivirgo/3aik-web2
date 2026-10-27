import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { DEFAULT_INDEXNOW_KEY } from "../src/news/config";
import { INDEXNOW_BATCH_SIZE, indexNowCatalogUrls, submitIndexNow } from "../src/news/indexnow";
import { pingIndexNow } from "../src/news/pipeline";
import { D1NewsRepository, MemoryNewsRepository } from "../src/news/repository";
import { handleNewsRequest } from "../src/news/routes";
import type { StoredArticle } from "../src/news/types";

const root = resolve(import.meta.dirname, "..");
const TOKEN = "ingest-bearer-token";
const NOW = new Date("2026-10-27T12:00:00.000Z");

function article(slug: string): StoredArticle {
	return {
		id: "22222222-2222-4222-8222-222222222222",
		slug,
		title: "A desk note",
		description: "A desk note.",
		category: "ai",
		tags: [],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The outlet reported a narrow note.",
		keyPoints: [],
		faq: [],
		sources: [],
		related: [],
		imageKey: "",
		imageCommit: "",
		imageAlt: "",
		imageType: "",
		imageCredit: "",
		imageSourceUrl: "",
		publishedAt: "2026-10-23T12:07:00.000Z",
		updatedAt: "2026-10-23T12:07:00.000Z",
	};
}

function submit(token = TOKEN, when = NOW) {
	const repo = new MemoryNewsRepository();
	repo.articles.push(article("desk-note"));
	const fetchImpl = vi.fn(async () => new Response("accepted", { status: 202 }));
	const request = new Request("https://3aik.test/ai-news/api/indexnow/submit-all", {
		method: "POST",
		headers: { authorization: `Bearer ${token}` },
	});
	return {
		repo,
		fetchImpl,
		send: (at = when) => handleNewsRequest(
			request,
			{ AI_NEWS_INGEST_TOKEN: TOKEN, AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo, fetchImpl: fetchImpl as typeof fetch, now: at },
		),
	};
}

describe("IndexNow key file", () => {
	it("serves the committed public key when the env var is unset", async () => {
		const assets = vi.fn(async () => new Response("asset"));
		const response = await worker.fetch(
			new Request(`https://3aik.test/${DEFAULT_INDEXNOW_KEY}.txt`),
			{ ASSETS: { fetch: assets } } as never,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/plain");
		expect(await response.text()).toBe(DEFAULT_INDEXNOW_KEY);
		expect(assets).not.toHaveBeenCalled();
	});

	it("lets INDEXNOW_KEY replace the committed key", async () => {
		const assets = vi.fn(async () => new Response("asset", { status: 200 }));
		const env = { INDEXNOW_KEY: "index-key", ASSETS: { fetch: assets } } as never;
		const custom = await worker.fetch(new Request("https://3aik.test/index-key.txt"), env);
		expect(custom.status).toBe(200);
		expect(await custom.text()).toBe("index-key");
		expect(assets).not.toHaveBeenCalled();
		const unused = await worker.fetch(new Request(`https://3aik.test/${DEFAULT_INDEXNOW_KEY}.txt`), env);
		expect(await unused.text()).toBe("asset");
	});

	it("leaves the home page bytes unchanged", () => {
		const bytes = readFileSync(resolve(root, "public/index.html"));
		expect(createHash("sha256").update(bytes).digest("hex")).toBe("66bc6bcf324cb48f618811968002a32852437e3302bd6e91de398a49d42f7ace");
	});
});

describe("IndexNow submit-all", () => {
	it("rejects a missing or wrong ingest bearer with the same 404", async () => {
		const hidden = await worker.fetch(
			new Request("https://3aik.test/ai-news/api/indexnow/submit-all", { method: "POST" }),
			{ ASSETS: { fetch: vi.fn() } } as never,
		);
		expect(hidden.status).toBe(404);
		expect(await hidden.json()).toEqual({ error: "not_found" });

		const wrong = await worker.fetch(
			new Request("https://3aik.test/ai-news/api/indexnow/submit-all", {
				method: "POST",
				headers: { authorization: "Bearer wrong" },
			}),
			{ AI_NEWS_INGEST_TOKEN: TOKEN, ASSETS: { fetch: vi.fn() } } as never,
		);
		expect(wrong.status).toBe(404);
		expect(await wrong.json()).toEqual({ error: "not_found" });
	});

	it("submits articles and desk pages, then waits 10 minutes", async () => {
		const state = submit();
		const first = await state.send();
		expect(first.status).toBe(200);
		const body = await first.json() as { batches: Array<{ count: number; engines: Array<{ engine: string; status: number }> }> };
		const catalog = indexNowCatalogUrls("https://3aik.com");
		expect(body.batches).toEqual([{
			count: catalog.length + 1,
			engines: [
				{ engine: "bing", status: 202 },
				{ engine: "yandex", status: 202 },
			],
		}]);
		expect(state.fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([
			"https://www.bing.com/indexnow",
			"https://yandex.com/indexnow",
		]);
		const posted = JSON.parse(String(state.fetchImpl.mock.calls[0]?.[1]?.body)) as { host: string; key: string; keyLocation: string; urlList: string[] };
		expect(state.fetchImpl.mock.calls[1]?.[1]?.body).toBe(state.fetchImpl.mock.calls[0]?.[1]?.body);
		expect(posted.host).toBe("3aik.com");
		expect(posted.key).toBe(DEFAULT_INDEXNOW_KEY);
		expect(posted.keyLocation).toBe(`https://3aik.com/${DEFAULT_INDEXNOW_KEY}.txt`);
		expect(posted.urlList).toContain("https://3aik.com/ai-news/article/desk-note");
		expect(posted.urlList).toContain("https://3aik.com/ai-news");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/archive");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/ai");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/author/mira-ellison");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/about");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/editorial-policy");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/corrections");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/contact");
		expect(posted.urlList).toContain("https://3aik.com/ai-news/disclaimer");

		const early = await state.send(new Date(NOW.getTime() + 60 * 1000));
		expect(early.status).toBe(429);
		expect(early.headers.get("retry-after")).toBe("540");
		expect(await early.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 540 });
		expect(state.fetchImpl).toHaveBeenCalledTimes(2);

		const later = await state.send(new Date(NOW.getTime() + 10 * 60 * 1000));
		expect(later.status).toBe(200);
		expect(state.fetchImpl).toHaveBeenCalledTimes(4);
	});

	it("allows GET to hide behind 404 until the bearer matches", async () => {
		const state = submit();
		const response = await handleNewsRequest(
			new Request("https://3aik.test/ai-news/api/indexnow/submit-all", {
				headers: { authorization: `Bearer ${TOKEN}` },
			}),
			{ AI_NEWS_INGEST_TOKEN: TOKEN, AI_NEWS_SITE_ORIGIN: "https://3aik.com" },
			{ repo: state.repo, fetchImpl: state.fetchImpl as typeof fetch, now: NOW },
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(state.fetchImpl).not.toHaveBeenCalled();
	});

	it("posts Bing and Yandex, and calls api.indexnow.org only when both fail", async () => {
		const urls = Array.from({ length: INDEXNOW_BATCH_SIZE + 1 }, (_, index) => `https://3aik.com/ai-news/article/story-${index}`);
		const seen: Array<{ endpoint: string; count: number }> = [];
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const endpoint = String(input);
			const body = JSON.parse(String(init?.body)) as { urlList: string[] };
			seen.push({ endpoint, count: body.urlList.length });
			if (body.urlList.length === INDEXNOW_BATCH_SIZE) {
				if (endpoint.includes("bing.com")) return new Response("ok", { status: 202 });
				if (endpoint.includes("yandex.com")) return new Response("ok", { status: 200 });
			}
			if (endpoint.includes("bing.com")) return new Response("limited", { status: 429 });
			if (endpoint.includes("yandex.com")) return new Response("no", { status: 403 });
			if (endpoint.includes("api.indexnow.org")) return new Response("ok", { status: 200 });
			throw new Error(`unexpected ${endpoint}`);
		});
		const batches = await submitIndexNow({ AI_NEWS_SITE_ORIGIN: "https://3aik.com" }, urls, fetchImpl as typeof fetch);
		expect(seen).toEqual([
			{ endpoint: "https://www.bing.com/indexnow", count: INDEXNOW_BATCH_SIZE },
			{ endpoint: "https://yandex.com/indexnow", count: INDEXNOW_BATCH_SIZE },
			{ endpoint: "https://www.bing.com/indexnow", count: 1 },
			{ endpoint: "https://yandex.com/indexnow", count: 1 },
			{ endpoint: "https://api.indexnow.org/indexnow", count: 1 },
		]);
		expect(batches).toEqual([
			{
				count: INDEXNOW_BATCH_SIZE,
				engines: [
					{ engine: "bing", status: 202 },
					{ engine: "yandex", status: 200 },
				],
			},
			{
				count: 1,
				engines: [
					{ engine: "bing", status: 429 },
					{ engine: "yandex", status: 403 },
					{ engine: "indexnow", status: 200 },
				],
			},
		]);

		const partial = vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).includes("bing.com")) return new Response("ok", { status: 202 });
			throw new Error("yandex down");
		});
		const one = await submitIndexNow({}, ["https://3aik.com/ai-news"], partial as typeof fetch);
		expect(one).toEqual([{
			count: 1,
			engines: [
				{ engine: "bing", status: 202 },
				{ engine: "yandex", status: 0 },
			],
		}]);
		expect(partial.mock.calls.map((call) => String(call[0]))).toEqual([
			"https://www.bing.com/indexnow",
			"https://yandex.com/indexnow",
		]);

		await expect(pingIndexNow({}, ["https://3aik.com/ai-news/article/demo"], vi.fn(async () => {
			throw new Error("down");
		}) as typeof fetch)).resolves.toBeUndefined();
	});

	it("keeps the 10 minute claim in runtime_lock", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec("CREATE TABLE runtime_lock (name TEXT PRIMARY KEY, locked_until TEXT NOT NULL)");
		const db = {
			prepare(statement: string) {
				return {
					bind(...values: unknown[]) {
						const prepared = sqlite.prepare(statement);
						const args = values as never[];
						return {
							async run() {
								const info = prepared.run(...args);
								return { meta: { changes: Number(info.changes ?? 0) } };
							},
							async first() {
								return (prepared.get(...args) as Record<string, unknown> | undefined) ?? null;
							},
						};
					},
				};
			},
		};
		const repo = new D1NewsRepository(db as unknown as D1Database);
		const first = await repo.claimIndexNowSubmit("2026-10-27T12:00:00.000Z", "2026-10-27T12:10:00.000Z");
		const second = await repo.claimIndexNowSubmit("2026-10-27T12:01:00.000Z", "2026-10-27T12:11:00.000Z");
		const third = await repo.claimIndexNowSubmit("2026-10-27T12:10:00.000Z", "2026-10-27T12:20:00.000Z");
		expect(first).toEqual({ allowed: true, retryAfterSeconds: 0 });
		expect(second).toEqual({ allowed: false, retryAfterSeconds: 540 });
		expect(third.allowed).toBe(true);
	});
});
