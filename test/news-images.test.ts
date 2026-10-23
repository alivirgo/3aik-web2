import { describe, expect, it, vi } from "vitest";
import {
	commitImageFile,
	githubImagePath,
	loadPublicImage,
} from "../src/news/github-images";
import { TINY_JPEG, imageLimitReason } from "../src/news/text";

const path = "images/2026/10/short-bulletin.jpg";

function requestUrl(input: RequestInfo | URL): string {
	return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("GitHub image storage", () => {
	it("accepts the tiny jpeg and builds a dated repo path", () => {
		expect(imageLimitReason(TINY_JPEG)).toBeNull();
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "short-bulletin", "webp")).toBe("images/2026/10/short-bulletin.webp");
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "../secret", "jpg")).toBeNull();
	});

	it("puts the file with a bearer token and does not retry a rate limit", async () => {
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			return new Response("slow down", { status: 429, headers: { "retry-after": "60" } });
		});
		const result = await commitImageFile("ghp-test", path, TINY_JPEG, fetchImpl as typeof fetch);
		expect(result).toEqual({ ok: false, pause: true });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const init = fetchImpl.mock.calls[0]?.[1];
		expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ghp-test");
		expect(requestUrl(fetchImpl.mock.calls[0]?.[0] ?? "")).not.toContain("ghp-test");
		expect(init?.method).toBe("PUT");
	});

	it("retries once with the existing sha when GitHub asks for it", async () => {
		const bodies: string[] = [];
		const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			bodies.push(typeof init?.body === "string" ? init.body : "");
			if (init?.method === "PUT" && bodies.length === 1) {
				return new Response(JSON.stringify({ message: "sha wasn't supplied." }), { status: 422 });
			}
			if (!init?.method || init.method === "GET") {
				return new Response(JSON.stringify({ sha: "abc123" }), { status: 200, headers: { "x-ratelimit-remaining": "100" } });
			}
			return new Response("{}", { status: 200, headers: { "x-ratelimit-remaining": "99" } });
		});
		const result = await commitImageFile("ghp-test", path, TINY_JPEG, fetchImpl as typeof fetch);
		expect(result.ok).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(JSON.parse(bodies[2] ?? "{}").sha).toBe("abc123");
	});

	it("follows a same-repo jsDelivr redirect and refuses any other host", async () => {
		const good = vi.fn(async (input: RequestInfo | URL) => {
			const url = requestUrl(input);
			if (url.startsWith("https://cdn.jsdelivr.net/")) {
				return new Response(null, {
					status: 302,
					headers: { location: "https://fastly.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@abc123/images/2026/10/short-bulletin.jpg" },
				});
			}
			return new Response(TINY_JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
		});
		const loaded = await loadPublicImage(path, good as typeof fetch);
		expect(loaded?.contentType).toBe("image/jpeg");
		expect(loaded?.bytes).toEqual(TINY_JPEG);
		expect(new Headers(good.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();

		const evil = vi.fn(async () => new Response(null, {
			status: 302,
			headers: { location: "https://evil.example/image.jpg" },
		}));
		expect(await loadPublicImage(path, evil as typeof fetch)).toBeNull();
		expect(evil).toHaveBeenCalledTimes(1);
	});
});
