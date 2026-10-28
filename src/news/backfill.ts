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

const MAX_ATTEMPTS = 5;
const RETRY_MS = 60 * 60 * 1000;

type StoreOutcome =
	| { kind: "updated"; lead: StoredLead; pending: string }
	| { kind: "defer"; reason: string }
	| { kind: "terminal"; reason: string }
	| { kind: "retry"; reason: string };

function nextSpec(article: StoredArticle, pending: string): { suffix: string; width: number; height: number } | null {
	const wanted = pending.split(",").map((part) => part.trim()).filter(Boolean);
	if (wanted.length) return BACKFILL_SPECS.find((spec) => wanted.includes(spec.suffix)) ?? null;
	if (article.imageKey.endsWith(PRIMARY_RESIZE.suffix)) return null;
	return PRIMARY_RESIZE;
}

function pendingAfter(specSuffix: string, pending: string, hadPrimary: boolean): string {
	const rest = (pending ? pending.split(",") : BACKFILL_SPECS.map((spec) => spec.suffix))
		.map((part) => part.trim())
		.filter((part) => part && part !== specSuffix);
	if (!hadPrimary && specSuffix === PRIMARY_RESIZE.suffix) {
		return BACKFILL_SPECS.filter((spec) => spec.suffix !== PRIMARY_RESIZE.suffix).map((spec) => spec.suffix).join(",");
	}
	return rest.join(",");
}

async function storeOneVariant(
	token: string,
	article: StoredArticle,
	spec: { suffix: string; width: number; height: number },
	pending: string,
	fetchImpl: typeof fetch,
): Promise<StoreOutcome> {
	const urls = sourceUrls(article);
	if (!urls.length) return { kind: "terminal", reason: "no_source" };
	const suffix = article.id.replace(/-/g, "").slice(0, 8);
	let sawTransient = false;
	let sawRejected = false;
	for (const url of urls) {
		const resized = await fetchResizedWebp(url, spec, fetchImpl);
		if (!resized.ok) {
			if (resized.reason === "unavailable") return { kind: "retry", reason: "resize_unavailable" };
			if (resized.reason === "transient") sawTransient = true;
			else if (resized.reason === "too_large") return { kind: "defer", reason: "resize_too_large" };
			else sawRejected = true;
			continue;
		}
		const path = leadVariantPath(article.publishedAt, article.slug, suffix, spec);
		if (!path) return { kind: "terminal", reason: "unprocessable_source" };
		const wrote = await commitImageFile(token, path, resized.bytes, fetchImpl);
		if (!wrote.ok || !wrote.commitSha) {
			if (wrote.pause) return { kind: "retry", reason: "github_rate_limit" };
			return { kind: "defer", reason: "github_commit_failed" };
		}
		const imageKey = spec.suffix === PRIMARY_RESIZE.suffix ? path : (article.imageKey || path);
		return {
			kind: "updated",
			lead: { imageKey, imageCommit: wrote.commitSha, imageType: "image/webp", pause: wrote.pause },
			pending: pendingAfter(spec.suffix, pending, article.imageKey.endsWith(PRIMARY_RESIZE.suffix)),
		};
	}
	if (sawTransient && !sawRejected) return { kind: "defer", reason: "transient" };
	if (spec.suffix !== PRIMARY_RESIZE.suffix) return { kind: "defer", reason: "resize_incomplete" };
	return { kind: "terminal", reason: "unprocessable_source" };
}

function emptyReport(remaining: number, extra: Partial<BackfillReport> = {}): BackfillReport {
	return { updated: 0, skipped: 0, failed: 0, remaining, results: [], ...extra };
}

function laterIso(now: Date, ms: number): string {
	return new Date(now.getTime() + ms).toISOString();
}

/**
 * One variant of one article per call. Cloudflare resizes it. A crash leaves
 * retry_after an hour ahead so the manual loop moves on and cron tries again.
 * resize_incomplete is deferred, not terminal.
 */
export async function backfillLeads(
	env: NewsEnv,
	deps: BackfillDeps,
): Promise<BackfillReport> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const now = deps.now ?? new Date();
	const nowIso = now.toISOString();
	const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	const remainingNow = async () => deps.repo.countForBackfill(nowIso);
	if (!token) return emptyReport(await remainingNow(), { error: "images_token_missing" });
	const rows = await deps.repo.listForBackfill(1, nowIso);
	const article = rows[0];
	if (!article) return emptyReport(0);
	const job = await deps.repo.readBackfill(article.id);
	const held = await deps.repo.holdBackfill(article.id, nowIso, laterIso(now, RETRY_MS));
	if (!held) return emptyReport(await remainingNow(), { skipped: 1 });
	const spec = nextSpec(article, job?.pending ?? "");
	if (!spec) {
		await deps.repo.clearBackfill(article.id);
		return emptyReport(await remainingNow(), { skipped: 1 });
	}
	let outcome: StoreOutcome;
	try {
		outcome = await storeOneVariant(token, article, spec, job?.pending ?? "", fetchImpl);
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news backfill article failed",
			slug: article.slug,
			error: error instanceof Error ? error.message : String(error),
		}));
		outcome = { kind: "defer", reason: "transient" };
	}
	if (outcome.kind === "retry") {
		await deps.repo.clearBackfill(article.id);
		return emptyReport(await remainingNow(), {
			error: outcome.reason,
			results: [{ id: article.id, slug: article.slug, status: "blocked", reason: outcome.reason }],
		});
	}
	if (outcome.kind !== "updated") {
		const attempts = (job?.attempts ?? 0) + 1;
		const terminal = outcome.kind === "terminal" || attempts >= MAX_ATTEMPTS;
		const reason = outcome.reason || "unprocessable_source";
		await deps.repo.deferBackfill(
			article.id,
			terminal ? reason : reason,
			nowIso,
			terminal ? "" : laterIso(now, RETRY_MS),
			job?.pending ?? "",
			attempts,
		);
		console.error(JSON.stringify({
			message: terminal ? "ai-news backfill skipped" : "ai-news backfill deferred",
			slug: article.slug,
			reason,
			attempts,
		}));
		return {
			updated: 0,
			skipped: 0,
			failed: terminal ? 1 : 0,
			remaining: await remainingNow(),
			results: [{ id: article.id, slug: article.slug, status: terminal ? "failed" : "blocked", reason }],
		};
	}
	await deps.repo.updateLeadImage(article.id, {
		imageKey: outcome.lead.imageKey,
		imageCommit: outcome.lead.imageCommit,
		imageType: outcome.lead.imageType,
		imageCredit: article.imageCredit,
		imageSourceUrl: article.imageSourceUrl,
		updatedAt: nowIso,
	});
	if (outcome.pending) {
		await deps.repo.deferBackfill(article.id, "pending", nowIso, nowIso, outcome.pending, 0);
	} else {
		await deps.repo.deferBackfill(article.id, "ready", nowIso, "", "", 0);
	}
	const previous = article.imageKey;
	if (previous && previous !== outcome.lead.imageKey && isGitHubImagePath(previous) && !previous.endsWith(PRIMARY_RESIZE.suffix)) {
		await deleteImageFile(token, previous, fetchImpl);
	}
	return {
		updated: 1,
		skipped: 0,
		failed: 0,
		remaining: await remainingNow(),
		results: [{ id: article.id, slug: article.slug, status: "updated", reason: outcome.pending ? "pending" : "" }],
	};
}

/** Backfill always handles one article. A higher limit in the body is ignored. */
export function backfillLimit(_raw: unknown): number {
	return 1;
}
