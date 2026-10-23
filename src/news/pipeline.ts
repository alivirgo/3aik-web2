import { pickAuthor, pickCategory } from "./authors";
import {
	RETENTION_BATCH,
	SHORT_REJECT_TTL_MS,
	SIMILARITY_LIMIT,
	articlesPerHour,
	hourStartIso,
	imageCallBudget,
	imageTimeoutMs,
	lockTtlMs,
	maxFailuresPerRun,
	publishingEnabled,
	rejectTtlHours,
	retentionDays,
	siteOrigin,
	slotsThisRun,
	textCallBudget,
	textTimeoutMs,
	wallBudgetMs,
	type NewsEnv,
} from "./config";
import { fetchStories } from "./feeds";
import {
	GITHUB_DELETE_PACE_MS,
	GITHUB_IMAGE_MAX_BYTES,
	MAX_GITHUB_DELETES_PER_RUN,
	commitImageFile,
	deleteImageFile,
	extensionForMime,
	githubImagePath,
	isGitHubImagePath,
} from "./github-images";
import { buildArticlePrompt, generateDraftText, generateIllustration, isNeuronCap, parseArticleDraft, withTimeout, type ModelBudget } from "./model";
import { assessDraft } from "./quality";
import type { NewsRepository } from "./repository";
import type { ArticleDraft, AuthorPersona, Category, RelatedLink, SourceRef, StoredArticle, StoryItem } from "./types";
import { detectImageType, imageLimitReason, slugify, stripEditorialDashes, tokenJaccard } from "./text";

const ATTEMPTS = 3;

export interface PublishDependencies {
	env: NewsEnv & { AI?: Ai };
	repo: NewsRepository;
	now: Date;
	fetchImpl?: typeof fetch;
	writeDraft?: (prompt: { system: string; user: string }) => Promise<{ text: string; model: string }>;
	paint?: (prompt: string) => Promise<{ bytes: Uint8Array; contentType: string; model: string }>;
	ping?: (urls: string[]) => Promise<void>;
	clock?: () => number;
}

export interface PublishReport {
	published: string[];
	skipped: string;
	failures: string[];
}

function cleanDraft(draft: ArticleDraft): ArticleDraft {
	const clean = (value: string) => stripEditorialDashes(value).replace(/\s+/g, " ").trim();
	return {
		title: clean(draft.title),
		description: clean(draft.description),
		imageAlt: clean(draft.imageAlt),
		imagePrompt: clean(draft.imagePrompt),
		tags: draft.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
		keyPoints: draft.keyPoints.map(clean).filter(Boolean),
		paragraphs: draft.paragraphs.map((paragraph) => stripEditorialDashes(paragraph).trim()).filter(Boolean),
		faq: draft.faq.map((item) => ({ question: clean(item.question), answer: clean(item.answer) })),
	};
}

function attachRelated(draft: ArticleDraft, author: AuthorPersona, related: RelatedLink[]): ArticleDraft {
	if (!related[0]) return draft;
	const line = author.relatedLine(related[0].title, related[0].href);
	if (draft.paragraphs.join("\n").includes(related[0].href)) return draft;
	if (draft.paragraphs.length >= 10) {
		const paragraphs = draft.paragraphs.slice();
		paragraphs[paragraphs.length - 1] = `${paragraphs[paragraphs.length - 1]} ${line}`;
		return { ...draft, paragraphs };
	}
	return { ...draft, paragraphs: [...draft.paragraphs, line] };
}

async function chooseRelated(repo: NewsRepository, origin: string, category: Category, title: string): Promise<RelatedLink[]> {
	const recent = await repo.listRecent(30, category);
	return recent
		.map((article) => ({ article, score: tokenJaccard(title, article.title) }))
		.sort((left, right) => right.score - left.score || right.article.publishedAt.localeCompare(left.article.publishedAt))
		.slice(0, 2)
		.map(({ article }) => ({
			slug: article.slug,
			title: article.title,
			href: `${origin}/ai-news/article/${article.slug}`,
		}));
}

interface RunBudget extends ModelBudget {
	expired: () => boolean;
	stop: boolean;
}

function makeBudget(env: NewsEnv, slots: number, startedAt: number, clock: () => number): RunBudget {
	let textCalls = 0;
	let imageCalls = 0;
	const textLimit = textCallBudget(env, slots);
	const imageLimit = imageCallBudget(env, slots);
	const wall = wallBudgetMs(env);
	const budget: RunBudget = {
		textTimeoutMs: textTimeoutMs(env),
		imageTimeoutMs: imageTimeoutMs(env),
		stop: false,
		expired: () => clock() - startedAt >= wall,
		takeText: () => {
			if (budget.expired() || textCalls >= textLimit) {
				budget.stop = true;
				return false;
			}
			textCalls += 1;
			return true;
		},
		takeImage: () => {
			if (budget.expired()) {
				budget.stop = true;
				return false;
			}
			if (imageCalls >= imageLimit) return false;
			imageCalls += 1;
			return true;
		},
	};
	return budget;
}

async function draftStory(
	deps: PublishDependencies,
	story: StoryItem,
	author: AuthorPersona,
	related: RelatedLink[],
	sources: SourceRef[],
	budget: RunBudget,
): Promise<{ ok: true; draft: ArticleDraft; model: string } | { ok: false; tried: boolean; reason: string }> {
	let failure = "";
	let tried = false;
	let sawContentFailure = false;
	const stop = (reason: string, markTried = true): { ok: false; tried: boolean; reason: string } => {
		if (markTried) tried = true;
		return { ok: false, tried, reason: sawContentFailure ? "quality" : reason };
	};
	for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
		if (budget.expired()) {
			budget.stop = true;
			return stop("wall", false);
		}
		const prompt = buildArticlePrompt({ author, story, related, failure: failure || undefined });
		let text = "";
		let model = "dry-run";
		try {
			const written = deps.writeDraft
				? await (async () => {
					if (!budget.takeText()) throw new Error("text_budget");
					tried = true;
					return withTimeout(deps.writeDraft!(prompt), budget.textTimeoutMs);
				})()
				: await generateDraftText(deps.env.AI as Ai, prompt.system, prompt.user, budget);
			if (!deps.writeDraft) tried = true;
			text = written.text;
			model = written.model;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const neuronCap = message === "neuron_cap" || isNeuronCap(error);
			if (message === "text_budget" || message === "ai_timeout" || neuronCap || budget.expired()) budget.stop = true;
			if (neuronCap) tried = false;
			else if (message !== "text_budget") tried = true;
			console.error(JSON.stringify({ message: "ai-news draft failed", error: message }));
			const reason = neuronCap ? "neuron_cap" : message === "text_budget" ? "budget" : message === "ai_timeout" ? "timeout" : "model";
			return stop(reason, false);
		}
		const parsed = parseArticleDraft(text);
		if (!parsed) {
			sawContentFailure = true;
			failure = "model_json";
			continue;
		}
		const draft = attachRelated(cleanDraft(parsed), author, related);
		const recent = await deps.repo.similarityCorpus(SIMILARITY_LIMIT);
		const verdict = assessDraft({ draft, category: story.category, sources, recent });
		if (!verdict.ok) {
			sawContentFailure = true;
			failure = verdict.reasons.join(", ");
			console.log(JSON.stringify({ message: "ai-news draft rejected", attempt, reasons: verdict.reasons }));
			continue;
		}
		return { ok: true, draft, model };
	}
	return { ok: false, tried, reason: sawContentFailure ? "quality" : "content" };
}

interface StoredPicture {
	imageKey: string;
	imageCommit: string;
	imageType: string;
	model: string;
	pauseWrites: boolean;
}

const EMPTY_PICTURE: StoredPicture = { imageKey: "", imageCommit: "", imageType: "", model: "", pauseWrites: false };

function pace(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A missing token, a failed model, a file that is not a small WebP or JPEG, or a
 * failed GitHub commit all publish the article with no image. The source URL is
 * not rejected for that.
 */
async function storeIllustration(
	deps: PublishDependencies,
	prompt: string,
	slug: string,
	imageSuffix: string,
	publishedAt: string,
	budget: RunBudget,
	writesPaused: boolean,
): Promise<StoredPicture> {
	const token = deps.env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	if (budget.expired()) {
		budget.stop = true;
		return EMPTY_PICTURE;
	}
	if (!token || writesPaused) return EMPTY_PICTURE;
	let image: { bytes: Uint8Array; contentType: string; model: string };
	try {
		if (deps.paint) {
			if (!budget.takeImage()) return EMPTY_PICTURE;
			image = await withTimeout(deps.paint(prompt), budget.imageTimeoutMs);
		} else {
			image = await generateIllustration(deps.env.AI as Ai, prompt, budget);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "neuron_cap" || isNeuronCap(error)) budget.stop = true;
		console.error(JSON.stringify({
			message: "ai-news image failed",
			error: message,
		}));
		return EMPTY_PICTURE;
	}
	const detected = detectImageType(image.bytes);
	const extension = detected ? extensionForMime(detected.mime) : null;
	const path = extension ? githubImagePath(publishedAt, slug, extension, imageSuffix) : null;
	if (!detected || !path || imageLimitReason(image.bytes) || image.bytes.byteLength > GITHUB_IMAGE_MAX_BYTES) {
		console.error(JSON.stringify({ message: "ai-news image skipped", reason: "type-or-size", model: image.model }));
		return { ...EMPTY_PICTURE, model: image.model };
	}
	const committed = await commitImageFile(token, path, image.bytes, deps.fetchImpl ?? fetch);
	if (!committed.ok || !committed.commitSha) return { ...EMPTY_PICTURE, model: image.model, pauseWrites: committed.pause };
	return {
		imageKey: path,
		imageCommit: committed.commitSha,
		imageType: detected.mime,
		model: image.model,
		pauseWrites: committed.pause,
	};
}

function rejectionTtlMs(env: NewsEnv, reason: string): number {
	if (reason === "quality" || reason === "content") return rejectTtlHours(env) * 60 * 60 * 1000;
	return SHORT_REJECT_TTL_MS;
}

async function rememberFailure(repo: NewsRepository, env: NewsEnv, url: string, reason: string, now: Date): Promise<void> {
	const expires = new Date(now.getTime() + rejectionTtlMs(env, reason)).toISOString();
	await repo.rejectSource(url, reason, expires);
}

async function pruneDesk(deps: PublishDependencies, nowIso: string): Promise<boolean> {
	await deps.repo.forgetExpiredRejections(nowIso);
	const days = retentionDays(deps.env);
	if (days <= 0) return false;
	const cutoff = new Date(deps.now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
	const expired = await deps.repo.expiredArticles(cutoff, RETENTION_BATCH);
	const token = deps.env.GITHUB_IMAGES_TOKEN?.trim() ?? "";
	let githubDeletes = 0;
	let paused = false;
	let removed = 0;
	for (const row of expired) {
		const needsGithub = Boolean(token && isGitHubImagePath(row.imageKey));
		if (needsGithub && githubDeletes >= MAX_GITHUB_DELETES_PER_RUN) break;
		await deps.repo.deleteArticle(row.id);
		removed += 1;
		if (!needsGithub) continue;
		if (githubDeletes > 0) await pace(GITHUB_DELETE_PACE_MS);
		const result = await deleteImageFile(token, row.imageKey, deps.fetchImpl ?? fetch);
		githubDeletes += 1;
		if (result.pause) {
			paused = true;
			console.error(JSON.stringify({
				message: "ai-news retention paused",
				retryAfterMs: result.retryAfterMs,
				deleted: removed,
			}));
			break;
		}
	}
	if (removed) {
		console.log(JSON.stringify({ message: "ai-news retention", deleted: removed, cutoff, paused }));
	}
	return paused;
}

export async function pingIndexNow(env: NewsEnv, urls: string[], fetchImpl: typeof fetch = fetch): Promise<void> {
	const key = env.INDEXNOW_KEY?.trim();
	if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key) || urls.length === 0) return;
	const origin = siteOrigin(env);
	const host = new URL(origin).host;
	try {
		const response = await fetchImpl("https://api.indexnow.org/indexnow", {
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({
				host,
				key,
				keyLocation: `${origin}/${key}.txt`,
				urlList: urls.slice(0, 100),
			}),
		});
		if (!response.ok) {
			console.error(JSON.stringify({ message: "ai-news indexnow failed", status: response.status }));
		}
		await response.body?.cancel();
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news indexnow error",
			error: error instanceof Error ? error.message : String(error),
		}));
	}
}

export async function runPublishCycle(deps: PublishDependencies): Promise<PublishReport> {
	if (!publishingEnabled(deps.env)) {
		console.log(JSON.stringify({ message: "ai-news publishing paused" }));
		return { published: [], skipped: "paused", failures: [] };
	}
	const rate = articlesPerHour(deps.env);
	if (rate <= 0) return { published: [], skipped: "rate", failures: [] };
	const nowIso = deps.now.toISOString();
	const locked = await deps.repo.tryLock(new Date(deps.now.getTime() + lockTtlMs(deps.env)).toISOString(), nowIso);
	if (!locked) return { published: [], skipped: "locked", failures: [] };

	const published: string[] = [];
	const failures: string[] = [];
	try {
		const retentionPaused = await pruneDesk(deps, nowIso);
		const already = await deps.repo.countPublishedSince(hourStartIso(deps.now));
		const slots = slotsThisRun(rate, already);
		if (slots <= 0) return { published, skipped: "quota", failures };
		if (!deps.writeDraft && !deps.env.AI) {
			console.error(JSON.stringify({ message: "ai-news AI binding missing" }));
			return { published, skipped: "no-ai", failures };
		}

		const stories = await fetchStories(deps.now, deps.fetchImpl);
		const fresh: StoryItem[] = [];
		for (const story of stories) {
			if (fresh.length >= 12) break;
			if (await deps.repo.hasSource(story.url)) continue;
			if (await deps.repo.isRejected(story.url, nowIso)) continue;
			fresh.push(story);
		}
		if (!fresh.length) return { published, skipped: "no-stories", failures };

		const origin = siteOrigin(deps.env);
		const clock = deps.clock ?? Date.now;
		const budget = makeBudget(deps.env, slots, clock(), clock);
		const failureCap = maxFailuresPerRun(deps.env);
		let consecutiveFailures = 0;
		let githubWritesPaused = retentionPaused;
		while (published.length < slots && fresh.length && !budget.stop && consecutiveFailures < failureCap) {
			const stats = await deps.repo.stats();
			const available = [...new Set(fresh.map((story) => story.category))];
			const category = pickCategory(stats, available);
			if (!category) break;
			const index = fresh.findIndex((story) => story.category === category);
			const story = fresh.splice(index, 1)[0];
			if (!story) break;
			const author = pickAuthor(story.category, stats);
			const sources: SourceRef[] = [{
				url: story.url,
				title: stripEditorialDashes(story.title),
				outlet: story.outlet,
				excerpt: story.excerpt,
			}];
			const related = await chooseRelated(deps.repo, origin, story.category, story.title);
			const drafted = await draftStory(deps, story, author, related, sources, budget);
			if (!drafted.ok) {
				if (drafted.tried) {
					failures.push(story.url);
					consecutiveFailures += 1;
					await rememberFailure(deps.repo, deps.env, story.url, drafted.reason, deps.now);
				} else {
					budget.stop = true;
				}
				continue;
			}
			const id = crypto.randomUUID();
			const imageSuffix = id.slice(0, 8);
			let slug = slugify(drafted.draft.title);
			if (await deps.repo.hasSlug(slug)) slug = `${slug}-${imageSuffix}`;
			const picture = await storeIllustration(deps, drafted.draft.imagePrompt, slug, imageSuffix, nowIso, budget, githubWritesPaused);
			if (picture.pauseWrites) githubWritesPaused = true;
			const article: StoredArticle = {
				id,
				slug,
				title: drafted.draft.title,
				description: drafted.draft.description,
				category: story.category,
				tags: drafted.draft.tags,
				authorId: author.id,
				bodyHtml: "",
				bodyText: drafted.draft.paragraphs.join("\n\n"),
				keyPoints: drafted.draft.keyPoints,
				faq: drafted.draft.faq,
				sources: sources.map(({ url, title, outlet }) => ({ url, title, outlet })),
				related: related.map(({ slug: relatedSlug, title }) => ({ slug: relatedSlug, title })),
				imageKey: picture.imageKey,
				imageCommit: picture.imageCommit,
				imageAlt: picture.imageKey ? drafted.draft.imageAlt : "",
				imageType: picture.imageType,
				publishedAt: nowIso,
				updatedAt: nowIso,
			};
			try {
				await deps.repo.insert(article);
			} catch (error) {
				if (picture.imageKey) await deleteImageFile(deps.env.GITHUB_IMAGES_TOKEN?.trim() ?? "", picture.imageKey, deps.fetchImpl ?? fetch);
				failures.push(story.url);
				consecutiveFailures += 1;
				await rememberFailure(deps.repo, deps.env, story.url, "insert", deps.now);
				console.error(JSON.stringify({
					message: "ai-news insert failed",
					error: error instanceof Error ? error.message : String(error),
				}));
				if (consecutiveFailures >= failureCap) break;
				continue;
			}
			consecutiveFailures = 0;
			published.push(slug);
			console.log(JSON.stringify({
				message: "ai-news published",
				slug,
				category: story.category,
				authorId: author.id,
				sourceHost: new URL(story.url).host,
				textModel: drafted.model,
				imageModel: picture.model,
			}));
		}

		if (published.length) {
			const urls = published.map((slug) => `${origin}/ai-news/article/${slug}`);
			if (deps.ping) await deps.ping(urls);
			else await pingIndexNow(deps.env, urls);
		}
		return { published, skipped: published.length ? "published" : "none", failures };
	} catch (error) {
		console.error(JSON.stringify({
			message: "ai-news cycle failed",
			error: error instanceof Error ? error.message : String(error),
		}));
		return { published, skipped: "error", failures };
	} finally {
		await deps.repo.unlock();
	}
}
