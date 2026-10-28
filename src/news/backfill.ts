import { imageTimeoutMs, textTimeoutMs, type NewsEnv } from "./config";
import {
	commitImageFile,
	deleteImageFile,
	isGitHubImagePath,
	publicImageCdnUrl,
} from "./github-images";
import { BACKFILL_SPECS, fetchResizedWebp, PRIMARY_RESIZE } from "./image-resize";
import { imageCandidates, leadVariantPath, persistLeadVariants, type StoredLead } from "./lead";
import { generateIllustration, type ModelBudget } from "./model";
import { publicHttpsUrl } from "./net";
import type { NewsRepository } from "./repository";
import type { StoredArticle } from "./types";
import { imageLimitReason } from "./text";

const FALLBACK_PROMPT = "Abstract editorial illustration of stacked paper shapes in sand, ink blue, and warm gray, soft shadow.";

export interface BackfillDeps {
	repo: NewsRepository;
	fetchImpl?: typeof fetch;
	now?: Date;
}

export interface BackfillItem {
	id: string;
	slug: string;
	status: "updated" | "failed" | "blocked";
	reason: string;
}

export interface BackfillReport {
	updated: number;
	skipped: number;
	failed: number;
	remaining: number;
	results: BackfillItem[];
	/** Set when this call should be stopped and retried later, without burning the article. */
	error?: string;
}

function imageBudget(env: NewsEnv): ModelBudget {
	let calls = 0;
	return {
		textTimeoutMs: textTimeoutMs(env),
		imageTimeoutMs: imageTimeoutMs(env),
		takeText: () => false,
		takeImage: () => {
			if (calls >= 2) return false;
			calls += 1;
			return true;
		},
	};
}

/** Workers AI illustration, then the same WebP crops as a publisher lead. Used by ingest, not backfill. */
export async function storeGeneratedLead(
	env: NewsEnv & { AI?: Ai },
	prompt: string,
	publishedAt: string,
	slug: string,
	suffix: string,
	fetchImpl: typeof fetch,
): Promise<StoredLead> {
	const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	const ai = env.AI;
	if (!token || !ai) return { imageKey: "", imageCommit: "", imageType: "", pause: false };
	try {
		const image = await generateIllustration(ai, prompt || FALLBACK_PROMPT, imageBudget(env));
		if (imageLimitReason(image.bytes)) return { imageKey: "", imageCommit: "", imageType: "", pause: false };
		return await persistLeadVariants(token, publishedAt, slug, suffix, image.bytes, fetchImpl);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news illustration fallback failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		return { imageKey: "", imageCommit: "", imageType: "", pause: false };
	}
}

function sourceUrls(article: StoredArticle): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const push = (raw: string | null) => {
		if (!raw || seen.has(raw)) return;
		const safe = publicHttpsUrl(raw);
		if (!safe || seen.has(safe)) return;
		seen.add(safe);
		urls.push(safe);
	};
	for (const candidate of imageCandidates(article.imageSourceUrl)) push(candidate);
	push(publicImageCdnUrl(article.imageKey, article.imageCommit));
	return urls.slice(0, 4);
}

type StoreOutcome =
	| { kind: "updated"; lead: StoredLead }
	| { kind: "failed"; reason: string }
	| { kind: "next"; reason: string }
	| { kind: "retry"; reason: string };

async function storeFromUrl(
	token: string,
	article: StoredArticle,
	sourceUrl: string,
	fetchImpl: typeof fetch,
): Promise<StoreOutcome> {
	const suffix = article.id.replace(/-/g, "").slice(0, 8);
	const probe = await fetchResizedWebp(sourceUrl, PRIMARY_RESIZE, fetchImpl);
	if (!probe.ok) {
		if (probe.reason === "unavailable") return { kind: "retry", reason: "resize_unavailable" };
		if (probe.reason === "transient") return { kind: "next", reason: "transient" };
		return { kind: "next", reason: probe.reason === "too_large" ? "resize_too_large" : "unprocessable_source" };
	}
	const rendered = new Map<string, Uint8Array>();
	rendered.set(PRIMARY_RESIZE.suffix, probe.bytes);
	for (const spec of BACKFILL_SPECS) {
		if (rendered.has(spec.suffix)) continue;
		const resized = await fetchResizedWebp(sourceUrl, spec, fetchImpl);
		if (!resized.ok) {
			if (resized.reason === "unavailable") return { kind: "retry", reason: "resize_unavailable" };
			if (resized.reason === "transient") return { kind: "next", reason: "transient" };
			return { kind: "next", reason: "resize_incomplete" };
		}
		rendered.set(spec.suffix, resized.bytes);
	}
	const committed: string[] = [];
	let lastSha = "";
	let pause = false;
	for (const spec of BACKFILL_SPECS) {
		const path = leadVariantPath(article.publishedAt, article.slug, suffix, spec);
		const bytes = rendered.get(spec.suffix);
		if (!path || !bytes) return { kind: "failed", reason: "resize_incomplete" };
		const wrote = await commitImageFile(token, path, bytes, fetchImpl);
		if (!wrote.ok || !wrote.commitSha) {
			for (const stored of committed) await deleteImageFile(token, stored, fetchImpl);
			if (wrote.pause) return { kind: "retry", reason: "github_rate_limit" };
			return { kind: "failed", reason: "github_commit_failed" };
		}
		committed.push(path);
		lastSha = wrote.commitSha;
		pause = wrote.pause;
	}
	const imageKey = committed[committed.length - 1] ?? "";
	if (!imageKey) return { kind: "failed", reason: "github_commit_failed" };
	return {
		kind: "updated",
		lead: { imageKey, imageCommit: lastSha, imageType: "image/webp", pause },
	};
}

async function storeArticle(
	token: string,
	article: StoredArticle,
	fetchImpl: typeof fetch,
): Promise<StoreOutcome> {
	const urls = sourceUrls(article);
	if (!urls.length) return { kind: "failed", reason: "no_source" };
	let lastFailed = "unprocessable_source";
	let sawTransient = false;
	for (const url of urls) {
		const outcome = await storeFromUrl(token, article, url, fetchImpl);
		if (outcome.kind === "updated" || outcome.kind === "retry" || outcome.kind === "failed") return outcome;
		if (outcome.reason === "transient") sawTransient = true;
		else lastFailed = outcome.reason;
	}
	if (sawTransient) return { kind: "retry", reason: "resize_unavailable" };
	return { kind: "failed", reason: lastFailed };
}

function emptyReport(remaining: number, extra: Partial<BackfillReport> = {}): BackfillReport {
	return { updated: 0, skipped: 0, failed: 0, remaining, results: [], ...extra };
}

/**
 * One article per call. Resizing happens in Cloudflare image transforms, not in
 * the Worker. A held row is never selected again, so a crashed attempt cannot
 * keep the same article at the head of the queue.
 */
export async function backfillLeads(
	env: NewsEnv,
	deps: BackfillDeps,
): Promise<BackfillReport> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const nowIso = (deps.now ?? new Date()).toISOString();
	const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	const remainingBefore = async () => deps.repo.countForBackfill();
	if (!token) return emptyReport(await remainingBefore(), { error: "images_token_missing" });
	const rows = await deps.repo.listForBackfill(1);
	const article = rows[0];
	if (!article) return emptyReport(0);
	const held = await deps.repo.holdBackfill(article.id, nowIso);
	if (!held) return emptyReport(await remainingBefore(), { skipped: 1 });
	let outcome: StoreOutcome;
	try {
		outcome = await storeArticle(token, article, fetchImpl);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news backfill article failed",
			slug: article.slug,
			error: error instanceof Error ? error.message : String(error),
		}));
		outcome = { kind: "failed", reason: "unprocessable_source" };
	}
	if (outcome.kind === "retry") {
		await deps.repo.clearBackfill(article.id);
		return emptyReport(await remainingBefore(), {
			error: outcome.reason,
			results: [{ id: article.id, slug: article.slug, status: "blocked", reason: outcome.reason }],
		});
	}
	if (outcome.kind !== "updated") {
		const reason = outcome.reason || "unprocessable_source";
		await deps.repo.failBackfill(article.id, reason, nowIso);
		console.error(JSON.stringify({
			message: "ai-news backfill skipped",
			slug: article.slug,
			reason,
		}));
		return {
			updated: 0,
			skipped: 0,
			failed: 1,
			remaining: await remainingBefore(),
			results: [{ id: article.id, slug: article.slug, status: "failed", reason }],
		};
	}
	const credit = article.imageCredit;
	const sourceUrl = article.imageSourceUrl;
	await deps.repo.updateLeadImage(article.id, {
		imageKey: outcome.lead.imageKey,
		imageCommit: outcome.lead.imageCommit,
		imageType: outcome.lead.imageType,
		imageCredit: credit,
		imageSourceUrl: sourceUrl,
		updatedAt: nowIso,
	});
	await deps.repo.clearBackfill(article.id);
	const previous = article.imageKey;
	if (previous && previous !== outcome.lead.imageKey && isGitHubImagePath(previous)) {
		await deleteImageFile(token, previous, fetchImpl);
	}
	return {
		updated: 1,
		skipped: 0,
		failed: 0,
		remaining: await remainingBefore(),
		results: [{ id: article.id, slug: article.slug, status: "updated", reason: "" }],
	};
}

/** Backfill always handles one article. A higher limit in the body is ignored. */
export function backfillLimit(_raw: unknown): number {
	return 1;
}
