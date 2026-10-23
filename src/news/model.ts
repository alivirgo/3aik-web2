import { IMAGE_MODELS, TEXT_MODELS } from "./config";
import type { ArticleDraft, AuthorPersona, RelatedLink, StoryItem } from "./types";
import { detectImageType } from "./text";

const SYSTEM_PROMPT = `You write original news for 3aik News as an editorial persona. You are not a human, and you must not claim interviews, eyewitness knowledge, or credentials.
Rules:
- Use only facts in the source excerpt. If a detail is missing, say it is not in the report. Do not invent quotes, numbers, names, or allegations.
- Rewrite with a new angle and new sentences. Do not copy 8 or more consecutive words from the source title or excerpt.
- Name the outlet in the body. Fashion and showbiz claims about a dispute must say "according to" or "reported" in the same sentence as the claim.
- Do not use an em dash or an en dash. Do not use --- or spaced double hyphens. Use commas, periods, parentheses, or a hyphen.
- Do not use these phrases or words: delve, in today's fast-paced, game-changer, it's worth noting, tapestry, landscape, in conclusion, in summary, cutting-edge, ever-evolving, testament to, paradigm shift, deep dive, dive into, in the realm, moreover, furthermore, at the end of the day, when it comes to, nestled, multifaceted, groundbreaking, revolutionize, synergy, holistic, pivotal, underscore, leveraging.
- Vary sentence length. Include at least one sentence of 12 words or fewer and one of 25 words or more.
- Write 5 to 8 paragraphs and 400 to 900 words in the paragraphs alone.
- Headlines may be specific and curious, and they must not claim a fact the body does not support.
- The image prompt describes shapes, materials, and color only. Do not mention people, faces, logos, or lettering, even to forbid them.
- Return only a JSON object, with no markdown fence.`;

export function buildArticlePrompt(input: {
	author: AuthorPersona;
	story: StoryItem;
	related: RelatedLink[];
	failure?: string;
}): { system: string; user: string } {
	const related = input.related.length
		? input.related.map((link) => `- ${link.title}: ${link.href}`).join("\n")
		: "None yet.";
	const sensitive = input.story.category === "fashion" || input.story.category === "showbiz"
		? "This is a fashion or showbiz story. Attribute claims, especially any dispute, to the outlet. Do not add allegations about a real person."
		: "Stay inside the excerpt.";
	const retry = input.failure
		? `The previous draft was rejected: ${input.failure}. Fix every reason. Do not repeat copied wording.`
		: "";
	const user = `Persona: ${input.author.name} (${input.author.id}). This persona is not a real person.
Beat: ${input.author.beat}.
Voice: ${input.author.voice}.
${sensitive}
${retry}

Source outlet: ${input.story.outlet}
Source title: ${input.story.title}
Source URL: ${input.story.url}
Source excerpt:
${input.story.excerpt}

Related desk stories you may link with markdown, and no other URLs:
${related}

Return JSON with this shape:
{"title":"","description":"90 to 160 characters","tags":["two-to-four-lowercase-tags"],"keyPoints":["8 to 30 words","8 to 30 words","8 to 30 words"],"faq":[{"question":"...?","answer":"20 to 70 words"},{"question":"...?","answer":"20 to 70 words"},{"question":"...?","answer":"20 to 70 words"}],"paragraphs":["","","","",""],"imageAlt":"8 to 24 words about the illustration","imagePrompt":"40 to 300 characters of shapes and materials"}`;
	return { system: SYSTEM_PROMPT, user };
}

export function extractModelText(result: unknown): string {
	if (typeof result === "string") return result;
	if (!result || typeof result !== "object") return "";
	const record = result as Record<string, unknown>;
	if (typeof record.response === "string") return record.response;
	if (typeof record.result === "string") return record.result;
	if (typeof record.output_text === "string") return record.output_text;
	if (Array.isArray(record.choices)) {
		const first = record.choices[0];
		if (first && typeof first === "object") {
			const message = (first as Record<string, unknown>).message;
			if (message && typeof message === "object") {
				const content = (message as Record<string, unknown>).content;
				if (typeof content === "string") return content;
			}
		}
	}
	return "";
}

export function parseArticleDraft(raw: string): ArticleDraft | null {
	const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped);
	} catch {
		const start = stripped.indexOf("{");
		const end = stripped.lastIndexOf("}");
		if (start < 0 || end <= start) return null;
		try {
			parsed = JSON.parse(stripped.slice(start, end + 1));
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	const title = typeof record.title === "string" ? record.title.trim() : "";
	const description = typeof record.description === "string" ? record.description.trim() : "";
	const imageAlt = typeof record.imageAlt === "string" ? record.imageAlt.trim() : "";
	const imagePrompt = typeof record.imagePrompt === "string" ? record.imagePrompt.trim() : "";
	const tags = Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()) : [];
	const keyPoints = Array.isArray(record.keyPoints)
		? record.keyPoints.filter((point): point is string => typeof point === "string").map((point) => point.trim())
		: [];
	const paragraphs = Array.isArray(record.paragraphs)
		? record.paragraphs.filter((paragraph): paragraph is string => typeof paragraph === "string").map((paragraph) => paragraph.trim()).filter(Boolean)
		: [];
	const faq = Array.isArray(record.faq)
		? record.faq.flatMap((item) => {
			if (!item || typeof item !== "object") return [];
			const entry = item as Record<string, unknown>;
			if (typeof entry.question !== "string" || typeof entry.answer !== "string") return [];
			return [{ question: entry.question.trim(), answer: entry.answer.trim() }];
		})
		: [];
	if (!title || !description || !paragraphs.length) return null;
	return { title, description, tags, keyPoints, faq, paragraphs, imageAlt, imagePrompt };
}

async function runTextModel(ai: Ai, model: string, system: string, user: string): Promise<string> {
	const result = await ai.run(model as keyof AiModels, {
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		stream: false,
		max_tokens: 2_800,
		temperature: 0.8,
	} as never);
	return extractModelText(result).trim();
}

export async function generateDraftText(
	ai: Ai,
	system: string,
	user: string,
): Promise<{ text: string; model: string }> {
	const failures: string[] = [];
	for (const candidate of TEXT_MODELS) {
		try {
			const text = await runTextModel(ai, candidate.id, system, user);
			if (!text) throw new Error("empty");
			return { text, model: candidate.label };
		} catch (error) {
			failures.push(candidate.label);
			console.warn(JSON.stringify({
				message: "ai-news text model failed",
				model: candidate.label,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}
	throw new Error(`No text model was available (${failures.join(", ")}).`);
}

function bytesFromBase64(value: string): Uint8Array {
	const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

async function imageBytes(result: unknown): Promise<Uint8Array | null> {
	if (result instanceof Uint8Array) return result;
	if (result instanceof ArrayBuffer) return new Uint8Array(result);
	if (result instanceof ReadableStream) return new Uint8Array(await new Response(result).arrayBuffer());
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if (typeof record.image === "string") return bytesFromBase64(record.image);
	}
	return null;
}

export async function generateIllustration(
	ai: Ai,
	prompt: string,
): Promise<{ bytes: Uint8Array; contentType: string; model: string }> {
	const safePrompt = `Abstract editorial illustration of shapes, materials, and color. ${prompt}`.slice(0, 900);
	let lastError: unknown;
	for (const model of IMAGE_MODELS) {
		try {
			let result: unknown;
			if (model.multipart) {
				const form = new FormData();
				form.append("prompt", safePrompt);
				form.append("width", "1024");
				form.append("height", "1024");
				const serialized = new Response(form);
				const contentType = serialized.headers.get("content-type");
				if (!serialized.body || !contentType) throw new Error("Could not serialize the image request.");
				result = await ai.run(model.id as keyof AiModels, {
					multipart: { body: serialized.body, contentType },
				} as never);
			} else {
				result = await ai.run(model.id as keyof AiModels, { prompt: safePrompt, steps: 4 } as never);
			}
			const bytes = await imageBytes(result);
			const detected = bytes ? detectImageType(bytes) : null;
			if (!bytes || !detected) throw new Error("The image model returned no supported image.");
			return { bytes, contentType: detected.mime, model: model.label };
		} catch (error) {
			lastError = error;
			console.warn(JSON.stringify({
				message: "ai-news image model failed",
				model: model.label,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}
	throw lastError instanceof Error ? lastError : new Error("No image model was available.");
}
