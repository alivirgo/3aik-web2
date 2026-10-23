import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { authorById } from "../src/news/authors";
import { assessDraft } from "../src/news/quality";
import { forbiddenDash } from "../src/news/text";
import { parseSample } from "./sample-doc";

const dir = resolve(import.meta.dirname, "../docs/samples");

describe("sample articles", () => {
	const files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();

	it("includes a reviewable draft for each desk category", () => {
		expect(files.length).toBeGreaterThanOrEqual(4);
	});

	for (const file of files) {
		it(`${file} clears the quality gate`, () => {
			const sample = parseSample(readFileSync(resolve(dir, file), "utf8"));
			const author = authorById(sample.authorId);
			expect(author, file).toBeTruthy();
			expect(author?.category).toBe(sample.category);
			const blob = JSON.stringify(sample.draft);
			expect(forbiddenDash(blob), file).toBeNull();
			const verdict = assessDraft({
				draft: sample.draft,
				category: sample.category,
				sources: sample.sources,
				recent: [],
			});
			expect(verdict, file).toEqual({ ok: true });
		});
	}
});
