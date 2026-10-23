import { describe, expect, it, vi } from "vitest";
import {
	MAX_GITHUB_DELETES_PER_RUN,
	commitImageFile,
	deleteImageFile,
	githubImagePath,
	loadPublicImage,
	retryAfterMs,
} from "../src/news/github-images";
import { generateIllustration } from "../src/news/model";
import { TINY_JPEG, TINY_PNG, imageDimensions, imageLimitReason } from "../src/news/text";

const path = "images/2026/10/short-bulletin.jpg";
const commit = "0123456789abcdef0123456789abcdef01234567";

function requestUrl(input: RequestInfo | URL): string {
	return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function lossyWebp(width: number, height: number): Uint8Array {
	const payload = new Uint8Array(10);
	payload[3] = 0x9d;
	payload[4] = 0x01;
	payload[5] = 0x2a;
	payload[6] = width & 0xff;
	payload[7] = (width >> 8) & 0x3f;
	payload[8] = height & 0xff;
	payload[9] = (height >> 8) & 0x3f;
	const file = new Uint8Array(20 + payload.length);
	file.set([0x52, 0x49, 0x46, 0x46], 0);
	const riffSize = file.length - 8;
	file[4] = riffSize & 0xff;
	file[5] = (riffSize >> 8) & 0xff;
	file.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8);
	file[16] = payload.length;
	file.set(payload, 20);
	return file;
}

describe("GitHub image storage", () => {
	it("accepts a lossy VP8 webp and builds a dated repo path", () => {
		const webp = lossyWebp(16, 9);
		expect(imageDimensions(webp)).toEqual({ width: 16, height: 9 });
		expect(imageLimitReason(webp)).toBeNull();
		expect(imageLimitReason(TINY_JPEG)).toBeNull();
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "short-bulletin", "webp")).toBe("images/2026/10/short-bulletin.webp");
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "short-bulletin", "jpg", "abcd1234")).toBe("images/2026/10/short-bulletin-abcd1234.jpg");
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "a".repeat(80), "webp", "abcd1234")).toBe(`images/2026/10/${"a".repeat(71)}-abcd1234.webp`);
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "../secret", "jpg")).toBeNull();
		expect(githubImagePath("2026-10-23T12:07:00.000Z", "short-bulletin", "jpg", "../secret")).toBeNull();
		expect(MAX_GITHUB_DELETES_PER_RUN).toBeLessThan(20);
		expect(retryAfterMs("30", 0)).toBe(30_000);
	});

	it("stores commit.sha from the create response", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
			content: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
			commit: { sha: commit },
		}), { status: 201, headers: { "x-ratelimit-remaining": "4000" } }));
		const result = await commitImageFile("ghp-test", path, TINY_JPEG, fetchImpl as typeof fetch);
		expect(result).toEqual({ ok: true, pause: false, commitSha: commit, retryAfterMs: null });
		expect(requestUrl(fetchImpl.mock.calls[0]?.[0] ?? "")).not.toContain("ghp-test");
		expect(requestUrl(fetchImpl.mock.calls[0]?.[0] ?? "")).not.toContain("@main");
	});

	it("pauses on a secondary 403 with Retry-After and leaves a permission 403 unpaused", async () => {
		const limited = vi.fn(async () => new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit." }), {
			status: 403,
			headers: { "retry-after": "30", "x-ratelimit-remaining": "4000" },
		}));
		const paused = await commitImageFile("ghp-test", path, TINY_JPEG, limited as typeof fetch);
		expect(paused.ok).toBe(false);
		expect(paused.pause).toBe(true);
		expect(paused.retryAfterMs).toBe(30_000);
		expect(limited).toHaveBeenCalledTimes(1);

		const denied = vi.fn(async () => new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
			status: 403,
			headers: { "x-ratelimit-remaining": "4000" },
		}));
		const other = await commitImageFile("ghp-test", path, TINY_JPEG, denied as typeof fetch);
		expect(other.pause).toBe(false);
		expect(other.ok).toBe(false);
	});

	it("reuses the existing commit when the bytes match and does not overwrite a different file", async () => {
		let puts = 0;
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = requestUrl(input);
			if (init?.method === "PUT") {
				puts += 1;
				return new Response(JSON.stringify({ message: "sha wasn't supplied." }), { status: 422 });
			}
			if (url.includes("/commits?")) {
				return new Response(JSON.stringify([{ sha: commit }]), { status: 200, headers: { "x-ratelimit-remaining": "100" } });
			}
			return new Response(JSON.stringify({
				sha: "cccccccccccccccccccccccccccccccccccccccc",
				content: Buffer.from(TINY_JPEG).toString("base64"),
			}), { status: 200, headers: { "x-ratelimit-remaining": "100" } });
		});
		const reused = await commitImageFile("ghp-test", path, TINY_JPEG, fetchImpl as typeof fetch);
		expect(reused.ok).toBe(true);
		expect(reused.commitSha).toBe(commit);
		expect(puts).toBe(1);

		const different = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") return new Response(JSON.stringify({ message: "sha wasn't supplied." }), { status: 422 });
			return new Response(JSON.stringify({
				sha: "cccccccccccccccccccccccccccccccccccccccc",
				content: Buffer.from(TINY_PNG).toString("base64"),
			}), { status: 200, headers: { "x-ratelimit-remaining": "100" } });
		});
		const refused = await commitImageFile("ghp-test", path, TINY_JPEG, different as typeof fetch);
		expect(refused.ok).toBe(false);
		expect(refused.commitSha).toBe("");
		expect(different.mock.calls.filter((call) => call[1]?.method === "PUT")).toHaveLength(1);

		const dropped = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") return new Response(JSON.stringify({ message: "sha wasn't supplied." }), { status: 422 });
			throw new Error("network down");
		});
		await expect(commitImageFile("ghp-test", path, TINY_JPEG, dropped as typeof fetch)).resolves.toEqual({
			ok: false,
			pause: false,
			commitSha: "",
			retryAfterMs: null,
		});
	});

	it("returns a pause from delete so retention can stop", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "secondary rate limit" }), {
			status: 429,
			headers: { "retry-after": "8" },
		}));
		const result = await deleteImageFile("ghp-test", path, fetchImpl as typeof fetch);
		expect(result).toMatchObject({ ok: false, pause: true, retryAfterMs: 8_000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("follows a same-repo commit redirect and refuses any other host", async () => {
		const pinned = `https://cdn.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@${commit}/${path}`;
		const good = vi.fn(async (input: RequestInfo | URL) => {
			const url = requestUrl(input);
			if (url === pinned) {
				return new Response(null, {
					status: 302,
					headers: { location: `https://fastly.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@${commit}/${path}` },
				});
			}
			return new Response(TINY_JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
		});
		const loaded = await loadPublicImage(path, commit, good as typeof fetch);
		expect(loaded?.contentType).toBe("image/jpeg");
		expect(loaded?.bytes).toEqual(TINY_JPEG);
		expect(new Headers(good.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();

		const branch = vi.fn(async () => new Response(null, {
			status: 302,
			headers: { location: `https://cdn.jsdelivr.net/gh/alivirgo/3aik-ai-news-images@main/${path}` },
		}));
		expect(await loadPublicImage(path, commit, branch as typeof fetch)).toBeNull();

		const evil = vi.fn(async () => new Response(null, {
			status: 302,
			headers: { location: "https://evil.example/image.jpg" },
		}));
		expect(await loadPublicImage(path, commit, evil as typeof fetch)).toBeNull();
		expect(evil).toHaveBeenCalledTimes(1);
	});

	it("tries the next image model when the first returns a PNG", async () => {
		const ai = {
			run: vi.fn()
				.mockResolvedValueOnce(TINY_PNG)
				.mockResolvedValueOnce(TINY_JPEG),
		};
		const image = await generateIllustration(ai as never, "stacked paper shapes", {
			takeText: () => true,
			takeImage: () => true,
			textTimeoutMs: 1000,
			imageTimeoutMs: 1000,
		});
		expect(image.bytes).toEqual(TINY_JPEG);
		expect(image.contentType).toBe("image/jpeg");
		expect(ai.run).toHaveBeenCalledTimes(2);
	});
});
