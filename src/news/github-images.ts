import { detectImageType } from "./text";

/** Public repo that holds news illustrations. The Worker secret can write only this repo. */
export const IMAGE_REPO = "alivirgo/3aik-ai-news-images";
export const IMAGE_BRANCH = "main";

/**
 * Contents API uploads are base64 JSON. Stay at 1 MB so a commit is well under
 * GitHub's request size and jsDelivr's practical file size.
 */
export const GITHUB_IMAGE_MAX_BYTES = 1_000_000;

/** Leave headroom on the token's hourly budget. Further images in this tick are skipped. */
const RATE_LIMIT_FLOOR = 20;

const IMAGE_PATH = /^images\/\d{4}\/\d{2}\/[a-z0-9-]{1,80}\.(webp|jpg)$/;
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "fastly.jsdelivr.net"]);

export function isGitHubImagePath(path: string): boolean {
	return IMAGE_PATH.test(path);
}

export function githubImagePath(publishedAt: string, slug: string, extension: "webp" | "jpg"): string | null {
	if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
	const date = new Date(publishedAt);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const path = `images/${year}/${month}/${slug}.${extension}`;
	return isGitHubImagePath(path) ? path : null;
}

export function extensionForMime(mime: string): "webp" | "jpg" | null {
	if (mime === "image/webp") return "webp";
	if (mime === "image/jpeg") return "jpg";
	return null;
}

/** Same-origin URL. The browser never talks to jsDelivr. */
export function readerImageUrl(origin: string, imageKey: string): string | null {
	if (!isGitHubImagePath(imageKey)) return null;
	return `${origin}/ai-news/media/${imageKey}`;
}

export function mediaPathFromRequest(pathname: string): string | null {
	const prefix = "/ai-news/media/";
	if (!pathname.startsWith(prefix)) return null;
	const repoPath = pathname.slice(prefix.length);
	return isGitHubImagePath(repoPath) ? repoPath : null;
}

function jsDelivrUrl(repoPath: string, host = "cdn.jsdelivr.net"): string {
	return `https://${host}/gh/${IMAGE_REPO}@${IMAGE_BRANCH}/${repoPath}`;
}

function allowedCdnUrl(value: string, repoPath: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || !CDN_HOSTS.has(url.hostname)) return false;
	const prefix = `/gh/${IMAGE_REPO}@`;
	return url.pathname.startsWith(prefix) && url.pathname.endsWith(`/${repoPath}`);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		const slice = bytes.subarray(index, index + chunk);
		let piece = "";
		for (let offset = 0; offset < slice.length; offset += 1) piece += String.fromCharCode(slice[offset] ?? 0);
		binary += piece;
	}
	return btoa(binary);
}

function githubHeaders(token: string, json: boolean): Headers {
	const headers = new Headers();
	headers.set("authorization", `Bearer ${token}`);
	headers.set("accept", "application/vnd.github+json");
	headers.set("user-agent", "3aik-news");
	headers.set("x-github-api-version", "2022-11-28");
	if (json) headers.set("content-type", "application/json");
	return headers;
}

function contentsUrl(repoPath: string): string {
	return `https://api.github.com/repos/${IMAGE_REPO}/contents/${repoPath}`;
}

function rateRemaining(response: Response): number | null {
	const raw = response.headers.get("x-ratelimit-remaining");
	if (!raw) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

function redacted(error: unknown, token: string): string {
	const message = error instanceof Error ? error.message : String(error);
	return token ? message.split(token).join("[redacted]") : message;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const payload = await response.json();
		return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
	} catch {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
}

export interface ImageCommit {
	ok: boolean;
	/** True when another Contents API call this tick should be skipped. */
	pause: boolean;
}

/**
 * Create the file with the Contents API. One sha retry covers a half-finished
 * upload. Rate-limit responses are not retried. The token is never put in the URL.
 */
export async function commitImageFile(
	token: string,
	repoPath: string,
	bytes: Uint8Array,
	fetchImpl: typeof fetch = fetch,
): Promise<ImageCommit> {
	if (!token || !isGitHubImagePath(repoPath)) return { ok: false, pause: false };
	if (bytes.byteLength <= 0 || bytes.byteLength > GITHUB_IMAGE_MAX_BYTES) return { ok: false, pause: false };
	const put = (sha?: string) => fetchImpl(contentsUrl(repoPath), {
		method: "PUT",
		headers: githubHeaders(token, true),
		body: JSON.stringify({
			message: `Add news image ${repoPath}`,
			content: bytesToBase64(bytes),
			branch: IMAGE_BRANCH,
			...(sha ? { sha } : {}),
		}),
		signal: AbortSignal.timeout(10_000),
		redirect: "manual",
	});
	try {
		const created = await put();
		const remaining = rateRemaining(created);
		const pause = created.status === 429 || created.status === 403 || (remaining !== null && remaining < RATE_LIMIT_FLOOR);
		if (created.status === 200 || created.status === 201) {
			await created.body?.cancel().catch(() => undefined);
			return { ok: true, pause };
		}
		if (pause) {
			await created.body?.cancel().catch(() => undefined);
			console.error(JSON.stringify({ message: "ai-news image commit rate limited", status: created.status, path: repoPath }));
			return { ok: false, pause: true };
		}
		const body = await readJson(created);
		const message = typeof body?.message === "string" ? body.message : "";
		if (created.status !== 422 || !/sha/i.test(message)) {
			console.error(JSON.stringify({ message: "ai-news image commit failed", status: created.status, path: repoPath }));
			return { ok: false, pause: false };
		}
		const lookup = await fetchImpl(`${contentsUrl(repoPath)}?ref=${IMAGE_BRANCH}`, {
			headers: githubHeaders(token, false),
			signal: AbortSignal.timeout(10_000),
			redirect: "manual",
		});
		const lookedUp = await readJson(lookup);
		const sha = typeof lookedUp?.sha === "string" ? lookedUp.sha : "";
		const lookupRemaining = rateRemaining(lookup);
		if (!sha || lookup.status === 403 || lookup.status === 429) {
			return { ok: false, pause: lookup.status === 403 || lookup.status === 429 || (lookupRemaining !== null && lookupRemaining < RATE_LIMIT_FLOOR) };
		}
		const replaced = await put(sha);
		const replacedRemaining = rateRemaining(replaced);
		await replaced.body?.cancel().catch(() => undefined);
		const replacedPause = replaced.status === 429 || replaced.status === 403 || (replacedRemaining !== null && replacedRemaining < RATE_LIMIT_FLOOR);
		if (replaced.status === 200 || replaced.status === 201) return { ok: true, pause: replacedPause };
		console.error(JSON.stringify({ message: "ai-news image commit failed", status: replaced.status, path: repoPath }));
		return { ok: false, pause: replacedPause };
	} catch (error) {
		console.error(JSON.stringify({ message: "ai-news image commit error", path: repoPath, error: redacted(error, token) }));
		return { ok: false, pause: false };
	}
}

/** Best-effort delete. Callers delete the D1 row first. A GitHub error does not throw. */
export async function deleteImageFile(token: string, repoPath: string, fetchImpl: typeof fetch = fetch): Promise<void> {
	if (!token || !isGitHubImagePath(repoPath)) return;
	try {
		const lookup = await fetchImpl(`${contentsUrl(repoPath)}?ref=${IMAGE_BRANCH}`, {
			headers: githubHeaders(token, false),
			signal: AbortSignal.timeout(10_000),
			redirect: "manual",
		});
		if (lookup.status === 404) {
			await lookup.body?.cancel().catch(() => undefined);
			return;
		}
		const lookedUp = await readJson(lookup);
		const sha = typeof lookedUp?.sha === "string" ? lookedUp.sha : "";
		if (!sha || lookup.status === 403 || lookup.status === 429) {
			console.error(JSON.stringify({ message: "ai-news image delete skipped", status: lookup.status, path: repoPath }));
			return;
		}
		const removed = await fetchImpl(contentsUrl(repoPath), {
			method: "DELETE",
			headers: githubHeaders(token, true),
			body: JSON.stringify({
				message: `Remove news image ${repoPath}`,
				sha,
				branch: IMAGE_BRANCH,
			}),
			signal: AbortSignal.timeout(10_000),
			redirect: "manual",
		});
		await removed.body?.cancel().catch(() => undefined);
		if (removed.status !== 200 && removed.status !== 204) {
			console.error(JSON.stringify({ message: "ai-news image delete failed", status: removed.status, path: repoPath }));
		}
	} catch (error) {
		console.error(JSON.stringify({ message: "ai-news image delete error", path: repoPath, error: redacted(error, token) }));
	}
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
	const reader = response.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > limit) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} catch {
		await reader.cancel().catch(() => undefined);
		return null;
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

/**
 * Fetch one illustration from jsDelivr. Redirects stay on jsDelivr and must still
 * name this repo. The write token is not sent.
 */
export async function loadPublicImage(
	repoPath: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
	if (!isGitHubImagePath(repoPath)) return null;
	let current = jsDelivrUrl(repoPath);
	for (let hop = 0; hop < 3; hop += 1) {
		let response: Response;
		try {
			response = await fetchImpl(current, {
				redirect: "manual",
				headers: { accept: "image/webp, image/jpeg", "user-agent": "3aik-news" },
				signal: AbortSignal.timeout(8_000),
			});
		} catch {
			return null;
		}
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			await response.body?.cancel().catch(() => undefined);
			if (!location) return null;
			let next: string;
			try {
				next = new URL(location, current).toString();
			} catch {
				return null;
			}
			if (!allowedCdnUrl(next, repoPath)) return null;
			current = next;
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			return null;
		}
		const bytes = await readCapped(response, GITHUB_IMAGE_MAX_BYTES);
		if (!bytes) return null;
		const detected = detectImageType(bytes);
		const extension = repoPath.endsWith(".webp") ? "webp" : "jpg";
		if (!detected || detected.extension !== extension) return null;
		return { bytes, contentType: detected.mime };
	}
	return null;
}
