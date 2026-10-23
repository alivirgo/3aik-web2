import { COPY_WINDOW, BODY_SHINGLE_LIMIT, MAX_WORDS, MIN_WORDS, TITLE_JACCARD_LIMIT } from "./config";
import type { ArticleDraft, Category, QualityCorpusItem, SourceRef } from "./types";
import {
	casedTokens,
	forbiddenDash,
	normalizeForMatch,
	sentencesOf,
	shingleJaccard,
	tokenJaccard,
	wordCount,
	words,
	type CasedToken,
} from "./text";

export const SLOP_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
	{ id: "delve", pattern: /\bdelv(?:e|es|ed|ing)\b/i },
	{ id: "fast-paced", pattern: /in today'?s fast-paced/i },
	{ id: "game-changer", pattern: /\bgame[- ]?changers?\b/i },
	{ id: "worth-noting", pattern: /\bit(?:'s| is) worth noting\b/i },
	{ id: "tapestry", pattern: /\btapestry\b/i },
	{ id: "landscape", pattern: /\blandscapes?\b/i },
	{ id: "in-conclusion", pattern: /\bin conclusion\b/i },
	{ id: "in-summary", pattern: /\bin summary\b/i },
	{ id: "important-to-note", pattern: /\bit(?:'s| is) important to note\b/i },
	{ id: "in-a-world", pattern: /\bin a world where\b/i },
	{ id: "cutting-edge", pattern: /\bcutting[- ]edge\b/i },
	{ id: "ever-evolving", pattern: /\bever[- ]evolving\b/i },
	{ id: "testament", pattern: /\btestament to\b/i },
	{ id: "paradigm", pattern: /\bparadigm shift\b/i },
	{ id: "deep-dive", pattern: /\bdeep dive\b/i },
	{ id: "dive-into", pattern: /\bdive into\b/i },
	{ id: "realm", pattern: /\bin the realm\b/i },
	{ id: "moreover", pattern: /\bmoreover\b/i },
	{ id: "furthermore", pattern: /\bfurthermore\b/i },
	{ id: "end-of-day", pattern: /\bat the end of the day\b/i },
	{ id: "when-it-comes", pattern: /\bwhen it comes to\b/i },
	{ id: "crucial-role", pattern: /\bplays a (?:crucial|key|vital) role\b/i },
	{ id: "nestled", pattern: /\bnestled\b/i },
	{ id: "multifaceted", pattern: /\bmultifaceted\b/i },
	{ id: "groundbreaking", pattern: /\bgroundbreaking\b/i },
	{ id: "revolutionize", pattern: /\brevolutioniz(?:e|es|ed|ing)\b/i },
	{ id: "synergy", pattern: /\bsynergy\b/i },
	{ id: "holistic", pattern: /\bholistic\b/i },
	{ id: "pivotal", pattern: /\bpivotal\b/i },
	{ id: "underscore", pattern: /\bunderscores?\b/i },
	{ id: "leveraging", pattern: /\b(?:leveraging|to leverage)\b/i },
	{ id: "not-only-but-also", pattern: /\bnot only\b[\s\S]{0,80}\bbut also\b/i },
];

const MISLEADING_TITLE = /\b(you won'?t believe|shocking|mind-?blowing|one weird|doctors hate)\b/i;
const PERSONA_CLAIM =
	/\b(i interviewed|i spoke with|my sources|i witnessed|as a reporter|staff writer|our newsroom|on the ground i|as an ai language model)\b/i;
const ALLEGATION =
	/\b(accused|allegation|allegations|allegedly|scandal|feud|feuding|slams|slammed|affair|arrested|lawsuit|sued|abuse)\b/i;
const ATTRIBUTION = /\b(according to|reported|reports|report says|said|says|told|wrote|headlined)\b/i;
const IMAGE_FORBIDDEN =
	/\b(portrait|celebrity|celebrities|likeness|logo|logos|face|faces|person|people|human|humans|man|woman|boy|girl|actor|actress|singer)\b/i;

export interface QualityInput {
	draft: ArticleDraft;
	category: Category;
	sources: SourceRef[];
	recent: QualityCorpusItem[];
}

export function slopHits(text: string): string[] {
	return SLOP_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id);
}

const CONNECTORS = new Set("a an and or of in on for to with from by at as nor but per via vs".split(" "));
const LIST_LABELS = new Set(["brand", "brands", "label", "labels"]);
const VERBS = new Set(
	`is are was were be been being has have had do does did will would can could should may might must
	said says say said posted posts post reported reports report opens opened open launches launched launch
	announced announces announce compared compare drew draw made make makes plans planned plan expected expects
	includes included include including named names name lists listed list showed shows show rose fell cut cuts
	added adds add used uses use going goes went come comes came take takes took give gives gave get gets got
	see sees saw know knows think thinks want wants need needs look looks keep keeps kept start starts started
	stop stops stopped call calls called try tries tried ask asks asked work works worked seem seems seemed
	leave leaves left put find finds found tell tells told become becomes became write writes wrote headline headlined
	accused slam slams slammed raise raises raised hit hits win wins won lose loses lost buy buys bought sell sells sold
	pay pays paid grow grows grew move moves moved run runs ran set sets offer offers offered bring brings brought
	hold holds held turn turns turned follow follows followed lead leads led mean means meant remain remains remained
	stay stays stayed appear appears appeared continue continues continued end ends ended begin begins began
	help helps helped let lets reshapes reshape transform transforms change changes unveil unveils reveal reveals
	confirm confirms deny denies seek seeks`.split(/\s+/),
);
const COMMON_WORDS = new Set(
	`about after again all also back before between both day during each first here how into its just last like
	many more most new news next not now off old one only other our out over own part people short since some still
	such than that their them then there these they this those through time today two under until very way week what
	when where which while who year you your vendor bulletin routine maintenance window public status page company
	market price prices store shoppers sale record sales quarter line online note retailers desk limit nothing else
	extra quiet holiday ahead home world city years month months item items group firm firms share shares stock stocks
	deal deals product products service services customer customers user users data team teams big small high low long
	early late full half past second third`.split(/\s+/),
);

/**
 * A copied window is ignored only when the source span is a list of proper nouns
 * (brand names and similar), not a sentence. Lowercase prose, title-case headlines,
 * and any span that contains a verb still count as copies.
 */
function isProperNounList(tokens: CasedToken[]): boolean {
	if (tokens.length < COPY_WINDOW) return false;
	let proper = 0;
	let commas = 0;
	let content = 0;
	for (const token of tokens) {
		if (token.followedByComma) commas += 1;
		if (VERBS.has(token.norm)) {
			content += 1;
			continue;
		}
		if (CONNECTORS.has(token.norm) || LIST_LABELS.has(token.norm) || COMMON_WORDS.has(token.norm)) continue;
		if (token.capitalized) proper += 1;
		else content += 1;
	}
	if (content > 0) return false;
	if (proper >= 6) return true;
	return commas >= 2 && proper >= 4;
}

export function copiedFromSource(sourceText: string, articleText: string): string | null {
	const sourceTokens = casedTokens(sourceText);
	const byWindow = new Map<string, CasedToken[][]>();
	for (let index = 0; index + COPY_WINDOW <= sourceTokens.length; index += 1) {
		const span = sourceTokens.slice(index, index + COPY_WINDOW);
		const key = span.map((token) => token.norm).join(" ");
		const existing = byWindow.get(key);
		if (existing) existing.push(span);
		else byWindow.set(key, [span]);
	}
	const articleTokens = words(articleText);
	for (let index = 0; index + COPY_WINDOW <= articleTokens.length; index += 1) {
		const key = articleTokens.slice(index, index + COPY_WINDOW).join(" ");
		const spans = byWindow.get(key);
		if (!spans) continue;
		if (spans.every((span) => isProperNounList(span))) continue;
		return key;
	}
	const articleNorm = normalizeForMatch(articleText);
	for (const sentence of sourceText.split(/[.!?]+/)) {
		const normalized = normalizeForMatch(sentence);
		if (words(normalized).length < COPY_WINDOW || !articleNorm.includes(normalized)) continue;
		if (isProperNounList(casedTokens(sentence))) continue;
		return normalized;
	}
	return null;
}

function sentenceVariety(body: string): string | null {
	const lengths = sentencesOf(body).map((sentence) => wordCount(sentence)).filter((count) => count > 0);
	if (lengths.length < 8) return "too_few_sentences";
	const shortest = Math.min(...lengths);
	const longest = Math.max(...lengths);
	if (shortest > 12) return "no_short_sentence";
	if (longest < 25) return "no_long_sentence";
	const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
	const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
	const cv = Math.sqrt(variance) / mean;
	if (cv < 0.28) return "flat_rhythm";
	return null;
}

function allegationProblems(body: string, outlets: string[]): string[] {
	const reasons: string[] = [];
	for (const sentence of sentencesOf(body)) {
		if (!ALLEGATION.test(sentence)) continue;
		const attributed = ATTRIBUTION.test(sentence) || outlets.some((outlet) => sentence.toLowerCase().includes(outlet.toLowerCase()));
		if (!attributed) reasons.push("unattributed_allegation");
	}
	return reasons;
}

export function assessDraft(input: QualityInput): { ok: true } | { ok: false; reasons: string[] } {
	const reasons: string[] = [];
	const { draft, sources } = input;
	const blob = [
		draft.title,
		draft.description,
		draft.tags.join(" "),
		draft.keyPoints.join("\n"),
		draft.faq.map((item) => `${item.question} ${item.answer}`).join("\n"),
		draft.paragraphs.join("\n\n"),
		draft.imageAlt,
		draft.imagePrompt,
	].join("\n");
	const body = draft.paragraphs.join("\n\n");

	const dash = forbiddenDash(blob);
	if (dash) reasons.push(dash);

	for (const hit of slopHits(blob)) reasons.push(`slop:${hit}`);

	const count = wordCount(body);
	if (count < MIN_WORDS) reasons.push(`too_short:${count}`);
	if (count > MAX_WORDS) reasons.push(`too_long:${count}`);
	const rhythm = sentenceVariety(body);
	if (rhythm) reasons.push(rhythm);

	if (draft.paragraphs.length < 5 || draft.paragraphs.length > 10) reasons.push("paragraph_count");
	if (draft.title.trim().length < 20 || draft.title.trim().length > 110) reasons.push("title_length");
	if (draft.title === draft.title.toUpperCase()) reasons.push("title_case");
	if (MISLEADING_TITLE.test(draft.title)) reasons.push("misleading_headline");
	if (draft.description.length < 90 || draft.description.length > 170) reasons.push("description_length");
	if (normalizeForMatch(draft.description) === normalizeForMatch(draft.title)) reasons.push("description_repeats_title");

	if (draft.keyPoints.length < 3 || draft.keyPoints.length > 5) reasons.push("key_points");
	const pointNorms = new Set<string>();
	for (const point of draft.keyPoints) {
		const size = wordCount(point);
		if (size < 8 || size > 40) reasons.push("key_point_length");
		const norm = normalizeForMatch(point);
		if (pointNorms.has(norm)) reasons.push("key_point_duplicate");
		pointNorms.add(norm);
	}

	if (draft.faq.length !== 3) reasons.push("faq_count");
	for (const item of draft.faq) {
		if (!item.question.trim().endsWith("?")) reasons.push("faq_question");
		const answerWords = wordCount(item.answer);
		if (answerWords < 20 || answerWords > 90) reasons.push("faq_answer_length");
	}

	if (draft.tags.length < 2 || draft.tags.length > 4) reasons.push("tags");
	for (const tag of draft.tags) {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag) || tag.length > 24) reasons.push("tag_shape");
	}

	if (wordCount(draft.imageAlt) < 8 || wordCount(draft.imageAlt) > 32) reasons.push("image_alt");
	if (IMAGE_FORBIDDEN.test(draft.imageAlt) || IMAGE_FORBIDDEN.test(draft.imagePrompt)) reasons.push("image_prompt");
	if (draft.imagePrompt.trim().length < 40 || draft.imagePrompt.trim().length > 500) reasons.push("image_prompt_length");

	if (PERSONA_CLAIM.test(body)) reasons.push("persona_claim");

	const outlets = [...new Set(sources.map((source) => source.outlet))];
	for (const outlet of outlets) {
		if (!body.toLowerCase().includes(outlet.toLowerCase())) reasons.push(`missing_outlet:${outlet}`);
	}

	const sourceBlob = sources.map((source) => `${source.title}. ${source.excerpt}`).join("\n");
	const publishedBlob = `${draft.title}\n${draft.description}\n${draft.keyPoints.join(" ")}\n${draft.faq.map((item) => `${item.question} ${item.answer}`).join(" ")}\n${body}`;
	const copied = copiedFromSource(sourceBlob, publishedBlob);
	if (copied) reasons.push(`copied_sequence:${copied.slice(0, 80)}`);

	const normalizedTitle = normalizeForMatch(draft.title);
	for (const source of sources) {
		const sourceTitle = normalizeForMatch(source.title);
		if (sourceTitle.length > 20 && (normalizedTitle === sourceTitle || normalizedTitle.includes(sourceTitle))) {
			reasons.push("title_copies_source");
		}
	}

	for (const prior of input.recent) {
		if (normalizeForMatch(prior.title) === normalizedTitle) reasons.push(`duplicate_title:${prior.slug}`);
		else if (tokenJaccard(draft.title, prior.title) >= TITLE_JACCARD_LIMIT) reasons.push(`similar_title:${prior.slug}`);
		if (shingleJaccard(body, prior.bodyText, 5) >= BODY_SHINGLE_LIMIT) reasons.push(`similar_body:${prior.slug}`);
	}

	if (input.category === "fashion" || input.category === "showbiz") {
		if (!ATTRIBUTION.test(body)) reasons.push("missing_attribution");
		reasons.push(...allegationProblems(body, outlets));
	}

	const unique = [...new Set(reasons)];
	return unique.length ? { ok: false, reasons: unique } : { ok: true };
}
