import type { ArticleDraft, Category, SourceRef } from "../src/news/types";
import { isCategory } from "../src/news/text";

export interface ParsedSample {
	draft: ArticleDraft;
	category: Category;
	authorId: string;
	sources: SourceRef[];
}

function section(body: string, heading: string): string {
	const match = body.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`));
	return match?.[1]?.trim() ?? "";
}

export function parseSample(markdown: string): ParsedSample {
	const text = markdown.replace(/\r\n/g, "\n").trimStart();
	if (!text.startsWith("---\n")) throw new Error("Sample is missing front matter.");
	const end = text.indexOf("\n---\n", 4);
	if (end < 0) throw new Error("Sample front matter is not closed.");
	const meta: Record<string, string> = {};
	for (const line of text.slice(4, end).split("\n")) {
		const split = line.indexOf(":");
		if (split < 0) continue;
		meta[line.slice(0, split).trim()] = line.slice(split + 1).trim();
	}
	const body = text.slice(end + 5);
	const keyPoints = section(body, "Key points")
		.split("\n")
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
	const faq = section(body, "FAQ")
		.split(/\n(?=### )/)
		.map((block) => {
			const [heading, ...rest] = block.trim().split("\n");
			const question = (heading ?? "").replace(/^###\s+/, "").trim();
			const answer = rest.join(" ").trim();
			return { question, answer };
		})
		.filter((item) => item.question && item.answer);
	const paragraphs = section(body, "Body")
		.split(/\n\n+/)
		.map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	const category = meta.category ?? "";
	if (!isCategory(category)) throw new Error(`Unknown sample category: ${category}`);
	const tags = (meta.tags ?? "")
		.split(",")
		.map((tag) => tag.trim())
		.filter(Boolean);
	return {
		category,
		authorId: meta.author ?? "",
		draft: {
			title: meta.title ?? "",
			description: meta.description ?? "",
			tags,
			keyPoints,
			faq,
			paragraphs,
			imageAlt: meta.image_alt ?? "",
			imagePrompt: meta.image_prompt ?? "",
		},
		sources: [{
			url: meta.source_url ?? "",
			title: meta.source_title ?? "",
			outlet: meta.source_outlet ?? "",
			excerpt: meta.source_excerpt ?? "",
		}],
	};
}
