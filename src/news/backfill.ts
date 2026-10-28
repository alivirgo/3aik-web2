import { imageTimeoutMs, textTimeoutMs, type NewsEnv } from "./config";
import { deleteImageFile, isGitHubImagePath, loadPublicImage } from "./github-images";
import { imageCandidates, isDiscoverLeadKey, leadWideEnough, persistLeadVariants, type StoredLead } from "./lead";
import { generateIllustration, type ModelBudget } from "./model";
import type { NewsRepository } from "./repository";
import { imageLimitReason } from "./text";

const FALLBACK_PROMPT = "Abstract editorial illustration of stacked paper shapes in sand, ink blue, and warm gray, soft shadow.";
const DEFAULT_LIMIT = 4;
const MAX_LIMIT = 8;

export interface BackfillDeps {
	repo: NewsRepository;
	fetchImpl?: typeof fetch;
	now?: Date;
}

export interface BackfillReport {
	updated: number;
	skipped: number;
	failed: number;
	remaining: number;
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

/** Workers AI illustration, then the same WebP crops as a publisher lead. */
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

async function fetchWide(url: string, fetchImpl: typeof fetch, fetchImage: (url: string, fetchImpl: typeof fetch) => Promise<{ bytes: Uint8Array; finalUrl: string } | null>): Promise<{ bytes: Uint8Array; finalUrl: string } | null> {
	const fetched = await fetchImage(url, fetchImpl);
	if (!fetched || !leadWideEnough(fetched.bytes)) return null;
	return fetched;
}

export async function backfillLeads(
	env: NewsEnv & { AI?: Ai },
	deps: BackfillDeps,
	limit: number,
	fetchImage: (url: string, fetchImpl: typeof fetch) => Promise<{ bytes: Uint8Array; finalUrl: string } | null>,
): Promise<BackfillReport> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const nowIso = (deps.now ?? new Date()).toISOString();
	const capped = Math.min(MAX_LIMIT, Math.max(1, limit || DEFAULT_LIMIT));
	const rows = await deps.repo.listForBackfill(capped);
	let updated = 0;
	let skipped = 0;
	let failed = 0;
	const token = env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	for (const article of rows) {
		if (isDiscoverLeadKey(article.imageKey)) {
			skipped += 1;
			continue;
		}
		if (!token) {
			failed += 1;
			continue;
		}
		let bytes: Uint8Array | null = null;
		let credit = article.imageCredit;
		let sourceUrl = article.imageSourceUrl;
		let fromPublisher = false;
		if (article.imageKey && article.imageCommit) {
			const stored = await loadPublicImage(article.imageKey, article.imageCommit, fetchImpl);
			if (stored && leadWideEnough(stored.bytes)) {
				bytes = stored.bytes;
				fromPublisher = Boolean(article.imageCredit || article.imageSourceUrl);
			}
		}
		if (!bytes && article.imageSourceUrl) {
			for (const url of imageCandidates(article.imageSourceUrl)) {
				const fetched = await fetchWide(url, fetchImpl, fetchImage);
				if (!fetched) continue;
				bytes = fetched.bytes;
				sourceUrl = fetched.finalUrl;
				fromPublisher = true;
				break;
			}
		}
		const suffix = article.id.replace(/-/g, "").slice(0, 8);
		let lead: StoredLead = { imageKey: "", imageCommit: "", imageType: "", pause: false };
		if (bytes) {
			lead = await persistLeadVariants(token, article.publishedAt, article.slug, suffix, bytes, fetchImpl);
		}
		if (!lead.imageKey) {
			lead = await storeGeneratedLead(env, FALLBACK_PROMPT, article.publishedAt, article.slug, suffix, fetchImpl);
			fromPublisher = false;
		}
		if (!lead.imageKey) {
			failed += 1;
			if (lead.pause) break;
			continue;
		}
		if (!fromPublisher) {
			credit = "";
			sourceUrl = "";
		}
		const previous = article.imageKey;
		await deps.repo.updateLeadImage(article.id, {
			imageKey: lead.imageKey,
			imageCommit: lead.imageCommit,
			imageType: lead.imageType,
			imageCredit: credit,
			imageSourceUrl: sourceUrl,
			updatedAt: nowIso,
		});
		if (previous && previous !== lead.imageKey && isGitHubImagePath(previous)) {
			await deleteImageFile(token, previous, fetchImpl);
		}
		updated += 1;
		if (lead.pause) break;
	}
	const remaining = await deps.repo.countForBackfill();
	return { updated, skipped, failed, remaining };
}

export function backfillLimit(raw: unknown): number {
	const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).limit : undefined;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
	return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}
