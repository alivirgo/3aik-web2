import { GITHUB_REQUEST_TIMEOUT_MS } from "./config";
import { detectImageType } from "./text";

export { GITHUB_DELETE_PACE_MS, GITHUB_REQUEST_TIMEOUT_MS, MAX_GITHUB_DELETES_PER_RUN, pruneBudgetMs } from "./config";

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
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const CDN_HOSTS = new Set(["cdn.jsdelivr.net", "fastly.jsdelivr.net"]);

export function isCommitSha(value: string): boolean {
	return COMMIT_SHA.test(value);
}

export function isGitHubImagePath(path: string): boolean {
	return IMAGE_PATH.test(path);
}

/**
 * Image file name is the slug plus an optional 8-character suffix. The suffix
 * keeps a new article off a file that retention failed to delete. The stem is
 * shortened so the whole name still fits the 80-character path limit.
 */
export function githubImagePath(publishedAt: string, slug: string, extension: "webp" | "jpg", suffix = ""): string | null {
	if (suffix && !/^[a-z0-9]{8}$/.test(suffix)) return null;
	const extra = suffix ? `-${suffix}` : "";
	const stem = slug.slice(0, 80 - extra.length).replace(/-+$/g, "");
	if (!/^[a-z0-9-]{1,80}$/.test(stem)) return null;
	const date = new Date(publishedAt);
	if (Number.isNaN(date.getTime())) return null;
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const path = `images/${year}/${month}/${stem}${extra}.${extension}`;
	return isGitHubImagePath(path) ? path : null;
}

export function extensionForMime(mime: string): "webp" | "jpg" | null {
	if (mime === "image/webp") return "webp";
	if (mime === "image/jpeg") return "jpg";
	return null;
}

/** Same-origin URL pinned to the commit that stored the file. The browser never talks to jsDelivr. */
export function readerImageUrl(origin: string, imageKey: string, imageCommit: string): string | null {
	if (!isGitHubImagePath(imageKey) || !isCommitSha(imageCommit)) return null;
	return `${origin}/ai-news/media/${imageCommit}/${imageKey}`;
}

export function parseMediaRequest(pathname: string): { commitSha: string; repoPath: string } | null {
	const prefix = "/ai-news/media/";
	if (!pathname.startsWith(prefix)) return null;
	const rest = pathname.slice(prefix.length);
	const slash = rest.indexOf("/");
	if (slash < 0) return null;
	const commitSha = rest.slice(0, slash);
	const repoPath = rest.slice(slash + 1);
	if (!isCommitSha(commitSha) || !isGitHubImagePath(repoPath)) return null;
	return { commitSha, repoPath };
}

function jsDelivrUrl(repoPath: string, commitSha: string, host = "cdn.jsdelivr.net"): string {
	return `https://${host}/gh/${IMAGE_REPO}@${commitSha}/${repoPath}`;
}

function allowedCdnUrl(value: string, repoPath: string, commitSha: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || !CDN_HOSTS.has(url.hostname)) return false;
	const prefix = `/gh/${IMAGE_REPO}@${commitSha}/`;
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

function commitsUrl(repoPath: string): string {
	return `https://api.github.com/repos/${IMAGE_REPO}/commits?path=${encodeURIComponent(repoPath)}&sha=${IMAGE_BRANCH}&per_page=1`;
}

function rateRemaining(response: Response): number | null {
	const raw = response.headers.get("x-ratelimit-remaining");
	if (!raw) return null;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Seconds or an HTTP date. A past date yields zero. An unreadable value yields null. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
	if (!header) return null;
	const trimmed = header.trim();
	if (!trimmed) return null;
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
	const dated = Date.parse(trimmed);
	if (!Number.isFinite(dated)) return null;
	return Math.max(0, dated - now);
}

function redacted(error: unknown, token: string): string {
	const message = error instanceof Error ? error.message : String(error);
	return token ? message.split(token).join("[redacted]") : message;
}

async function readBody(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
}

function messageOf(payload: unknown): string {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
	const message = (payload as Record<string, unknown>).message;
	return typeof message === "string" ? message : "";
}

function commitShaOf(payload: unknown): string {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
	const commit = (payload as Record<string, unknown>).commit;
	if (!commit || typeof commit !== "object") return "";
	const sha = (commit as Record<string, unknown>).sha;
	return typeof sha === "string" && isCommitSha(sha) ? sha : "";
}

/**
 * 429 is always a limit. A 403 is a limit only when the budget is exhausted,
 * GitHub names a secondary limit, or Retry-After is set. A plain permission 403 is not.
 */
function isRateLimited(status: number, remaining: number | null, retryAfter: number | null, message: string): boolean {
	if (status === 429) return true;
	if (status !== 403) return false;
	if (remaining === 0 || retryAfter !== null) return true;
	return /secondary rate limit|abuse detection/i.test(message);
}

export interface GitHubWriteResult {
	ok: boolean;
	/** True when this tick should stop further Contents API calls. */
	pause: boolean;
	commitSha: string;
	retryAfterMs: number | null;
}

const WRITE_MISS: GitHubWriteResult = { ok: false, pause: false, commitSha: "", retryAfterMs: null };

function lowRemaining(remaining: number | null): boolean {
	return remaining !== null && remaining < RATE_LIMIT_FLOOR;
}

/**
 * Create the file. A 422 means the path already exists: reuse that commit when the
 * bytes match, and leave a different file untouched. The stored id is commit.sha,
 * which is safe to pin. The blob sha is only the Contents API update token, and
 * this path does not update. The lookup is awaited inside this try, so a network
 * error becomes a miss and the draft is still published. Rate-limit responses are
 * not retried. The token stays out of the URL. A long Retry-After stops the tick
 * instead of sleeping through it.
 */
export async function commitImageFile(
	token: string,
	repoPath: string,
	bytes: Uint8Array,
	fetchImpl: typeof fetch = fetch,
): Promise<GitHubWriteResult> {
	if (!token || !isGitHubImagePath(repoPath)) return WRITE_MISS;
	if (bytes.byteLength <= 0 || bytes.byteLength > GITHUB_IMAGE_MAX_BYTES) return WRITE_MISS;
	try {
		const created = await fetchImpl(contentsUrl(repoPath), {
			method: "PUT",
			headers: githubHeaders(token, true),
			body: JSON.stringify({
				message: `Add news image ${repoPath}`,
				content: bytesToBase64(bytes),
				branch: IMAGE_BRANCH,
			}),
			signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
			redirect: "manual",
		});
		const remaining = rateRemaining(created);
		const retryAfter = retryAfterMs(created.headers.get("retry-after"));
		const payload = await readBody(created);
		if (created.status === 200 || created.status === 201) {
			const commitSha = commitShaOf(payload);
			if (!commitSha) {
				console.error(JSON.stringify({ message: "ai-news image commit missing sha", path: repoPath }));
				return WRITE_MISS;
			}
			return { ok: true, pause: lowRemaining(remaining), commitSha, retryAfterMs: null };
		}
		if (isRateLimited(created.status, remaining, retryAfter, messageOf(payload))) {
			console.error(JSON.stringify({
				message: "ai-news image commit rate limited",
				status: created.status,
				path: repoPath,
				retryAfterMs: retryAfter,
			}));
			return { ok: false, pause: true, commitSha: "", retryAfterMs: retryAfter };
		}
		if (created.status !== 422 || !/sha/i.test(messageOf(payload))) {
			console.error(JSON.stringify({ message: "ai-news image commit failed", status: created.status, path: repoPath }));
			return WRITE_MISS;
		}
		return await reuseMatchingCommit(token, repoPath, bytes, fetchImpl);
	} catch (error) {
		console.error(JSON.stringify({ message: "ai-news image commit error", path: repoPath, error: redacted(error, token) }));
		return WRITE_MISS;
	}
}

async function reuseMatchingCommit(
	token: string,
	repoPath: string,
	bytes: Uint8Array,
	fetchImpl: typeof fetch,
): Promise<GitHubWriteResult> {
	const lookup = await fetchImpl(`${contentsUrl(repoPath)}?ref=${IMAGE_BRANCH}`, {
		headers: githubHeaders(token, false),
		signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
		redirect: "manual",
	});
	const lookupRemaining = rateRemaining(lookup);
	const lookupRetry = retryAfterMs(lookup.headers.get("retry-after"));
	const lookedUp = await readBody(lookup);
	if (isRateLimited(lookup.status, lookupRemaining, lookupRetry, messageOf(lookedUp))) {
		return { ok: false, pause: true, commitSha: "", retryAfterMs: lookupRetry };
	}
	const record = lookedUp && typeof lookedUp === "object" && !Array.isArray(lookedUp) ? lookedUp as Record<string, unknown> : null;
	const content = typeof record?.content === "string" ? record.content.replace(/\s/g, "") : "";
	if (lookup.status !== 200 || content !== bytesToBase64(bytes)) {
		console.error(JSON.stringify({ message: "ai-news image commit left existing file", path: repoPath }));
		return WRITE_MISS;
	}
	const history = await fetchImpl(commitsUrl(repoPath), {
		headers: githubHeaders(token, false),
		signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
		redirect: "manual",
	});
	const historyRemaining = rateRemaining(history);
	const historyRetry = retryAfterMs(history.headers.get("retry-after"));
	const listed = await readBody(history);
	if (isRateLimited(history.status, historyRemaining, historyRetry, messageOf(listed))) {
		return { ok: false, pause: true, commitSha: "", retryAfterMs: historyRetry };
	}
	const first = Array.isArray(listed) ? listed[0] : null;
	const sha = first && typeof first === "object" ? (first as Record<string, unknown>).sha : "";
	if (history.status !== 200 || typeof sha !== "string" || !isCommitSha(sha)) {
		console.error(JSON.stringify({ message: "ai-news image commit missing sha", status: history.status, path: repoPath }));
		return { ok: false, pause: lowRemaining(historyRemaining), commitSha: "", retryAfterMs: null };
	}
	return { ok: true, pause: lowRemaining(historyRemaining), commitSha: sha, retryAfterMs: null };
}

/** Delete one file. Callers remove the D1 row first. A GitHub error does not throw. */
export async function deleteImageFile(
	token: string,
	repoPath: string,
	fetchImpl: typeof fetch = fetch,
): Promise<GitHubWriteResult> {
	if (!token || !isGitHubImagePath(repoPath)) return { ok: true, pause: false, commitSha: "", retryAfterMs: null };
	try {
		const lookup = await fetchImpl(`${contentsUrl(repoPath)}?ref=${IMAGE_BRANCH}`, {
			headers: githubHeaders(token, false),
			signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
			redirect: "manual",
		});
		const lookupRemaining = rateRemaining(lookup);
		const lookupRetry = retryAfterMs(lookup.headers.get("retry-after"));
		if (lookup.status === 404) {
			await lookup.body?.cancel().catch(() => undefined);
			return { ok: true, pause: lowRemaining(lookupRemaining), commitSha: "", retryAfterMs: null };
		}
		const lookedUp = await readBody(lookup);
		if (isRateLimited(lookup.status, lookupRemaining, lookupRetry, messageOf(lookedUp))) {
			console.error(JSON.stringify({
				message: "ai-news image delete rate limited",
				status: lookup.status,
				path: repoPath,
				retryAfterMs: lookupRetry,
			}));
			return { ok: false, pause: true, commitSha: "", retryAfterMs: lookupRetry };
		}
		const blobSha = lookedUp && typeof lookedUp === "object" && !Array.isArray(lookedUp)
			? (lookedUp as Record<string, unknown>).sha
			: "";
		if (lookup.status !== 200 || typeof blobSha !== "string" || !blobSha) {
			console.error(JSON.stringify({ message: "ai-news image delete skipped", status: lookup.status, path: repoPath }));
			return WRITE_MISS;
		}
		const removed = await fetchImpl(contentsUrl(repoPath), {
			method: "DELETE",
			headers: githubHeaders(token, true),
			body: JSON.stringify({
				message: `Remove news image ${repoPath}`,
				sha: blobSha,
				branch: IMAGE_BRANCH,
			}),
			signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
			redirect: "manual",
		});
		const removedRemaining = rateRemaining(removed);
		const removedRetry = retryAfterMs(removed.headers.get("retry-after"));
		const removedBody = await readBody(removed);
		if (isRateLimited(removed.status, removedRemaining, removedRetry, messageOf(removedBody))) {
			console.error(JSON.stringify({
				message: "ai-news image delete rate limited",
				status: removed.status,
				path: repoPath,
				retryAfterMs: removedRetry,
			}));
			return { ok: false, pause: true, commitSha: "", retryAfterMs: removedRetry };
		}
		if (removed.status === 200 || removed.status === 204) {
			return { ok: true, pause: lowRemaining(removedRemaining), commitSha: "", retryAfterMs: null };
		}
		console.error(JSON.stringify({ message: "ai-news image delete failed", status: removed.status, path: repoPath }));
		return WRITE_MISS;
	} catch (error) {
		console.error(JSON.stringify({ message: "ai-news image delete error", path: repoPath, error: redacted(error, token) }));
		return WRITE_MISS;
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
 * Fetch one illustration from jsDelivr at a commit SHA. Redirects must keep that
 * SHA and this repo. The write token is not sent. `@main` is not used, because
 * jsDelivr caches branch tips for hours while this response is cached for a year.
 */
export async function loadPublicImage(
	repoPath: string,
	commitSha: string,
	fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
	if (!isGitHubImagePath(repoPath) || !isCommitSha(commitSha)) return null;
	let current = jsDelivrUrl(repoPath, commitSha);
	for (let hop = 0; hop < 3; hop += 1) {
		let response: Response;
		try {
			response = await fetchImpl(current, {
				method: "GET",
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
			if (!allowedCdnUrl(next, repoPath, commitSha)) return null;
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
