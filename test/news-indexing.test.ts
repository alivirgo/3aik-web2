import { describe, expect, it } from "vitest";
import { ASSIST_LINE } from "../src/news/config";
import { LIST_PAGE_SIZE } from "../src/news/paging";
import { MemoryNewsRepository } from "../src/news/repository";
import { handleNewsRequest, newsCacheRequest } from "../src/news/routes";
import type { Category, StoredArticle } from "../src/news/types";

const ORIGIN = "https://3aik.com";

function story(index: number, category: Category = "ai"): StoredArticle {
	const n = String(index).padStart(2, "0");
	const published = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
	const updated = index === 3 ? new Date(Date.UTC(2026, 2, 3, 4, index)).toISOString() : published;
	return {
		id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		slug: `story-${n}`,
		title: `Story ${n} stays inside the cited note`,
		description: `Description for story ${n}, kept inside the cited report.`,
		category,
		tags: ["desk"],
		authorId: "mira-ellison",
		bodyHtml: "",
		bodyText: "The outlet reported a narrow note.",
		keyPoints: ["A narrow note."],
		faq: [{ question: "What did the outlet report?", answer: "A narrow note." }],
		sources: [{ url: `https://example.com/source-${n}`, title: "A source note", outlet: "The Verge" }],
		related: [],
		imageKey: index === 0 ? "" : "images/2026/10/story.jpg",
		imageCommit: index === 0 ? "" : "0123456789abcdef0123456789abcdef01234567",
		imageAlt: index === 0 ? "" : "Abstract paper rectangles.",
		imageType: index === 0 ? "" : "image/jpeg",
		imageCredit: "",
		imageSourceUrl: "",
		publishedAt: published,
		updatedAt: updated,
	};
}

function desk(count = 25): MemoryNewsRepository {
	const repo = new MemoryNewsRepository();
	for (let index = 0; index < count; index += 1) repo.articles.push(story(index));
	return repo;
}

async function html(path: string, repo: MemoryNewsRepository | null, env: Record<string, string> = {}): Promise<{ status: number; html: string; headers: Headers }> {
	const response = await handleNewsRequest(new Request(`https://3aik.test${path}`), { AI_NEWS_SITE_ORIGIN: ORIGIN, ...env }, { repo });
	return { status: response.status, html: await response.text(), headers: response.headers };
}

function articleHrefs(page: string): string[] {
	return [...page.matchAll(/href="https:\/\/3aik\.com\/ai-news\/article\/(story-\d+)"/g)].map((match) => match[1] ?? "");
}

describe("news indexing", () => {
	it("serves a real slice for each index and category page", async () => {
		const repo = desk();
		expect(LIST_PAGE_SIZE).toBe(20);
		const first = await html("/ai-news", repo);
		const second = await html("/ai-news?page=2", repo);
		const third = await html("/ai-news?page=3", repo);
		const again = await html("/ai-news?page=1", repo);
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(third.status).toBe(404);
		expect(again.status).toBe(200);
		expect(first.html).toContain('rel="canonical" href="https://3aik.com/ai-news"');
		expect(again.html).toContain('rel="canonical" href="https://3aik.com/ai-news"');
		expect(second.html).toContain('rel="canonical" href="https://3aik.com/ai-news?page=2"');
		expect(second.html).toContain('<link rel="prev" href="https://3aik.com/ai-news">');
		expect(first.html).toContain('<link rel="next" href="https://3aik.com/ai-news?page=2">');
		expect(second.html).toContain('<a rel="prev" href="https://3aik.com/ai-news">Previous</a>');
		expect(first.html).toContain('<a rel="next" href="https://3aik.com/ai-news?page=2">Next</a>');
		expect(first.html).toContain('aria-current="page">1</a>');
		expect(second.html).toContain('href="https://3aik.com/ai-news?page=2" aria-current="page">2</a>');
		expect(first.html).toContain('class="lead"');
		expect(second.html).not.toContain('class="lead"');
		const pageOne = new Set(articleHrefs(first.html));
		const pageTwo = new Set(articleHrefs(second.html));
		expect(pageOne.has("story-24")).toBe(true);
		expect(pageOne.has("story-05")).toBe(true);
		expect(pageOne.has("story-04")).toBe(true);
		expect(pageOne.has("story-00")).toBe(false);
		expect(pageTwo.has("story-04")).toBe(true);
		expect(pageTwo.has("story-00")).toBe(true);
		expect(pageTwo.has("story-24")).toBe(false);
		expect(pageOne.size).toBe(24);
		expect(pageTwo.size).toBe(5);

		const section = await html("/ai-news/ai?page=2", repo);
		expect(section.status).toBe(200);
		expect(section.html).toContain('rel="canonical" href="https://3aik.com/ai-news/ai?page=2"');
		expect(new Set(articleHrefs(section.html)).size).toBe(5);
		const sectionOne = await html("/ai-news/ai", repo);
		expect(sectionOne.html).toContain('class="section-row');
		expect(new Set(articleHrefs(sectionOne.html)).size).toBe(20);
		expect((await html("/ai-news?page=foo", repo)).status).toBe(404);
		expect((await html("/ai-news?page=0", repo)).status).toBe(404);
		expect((await html("/ai-news?page=01", repo)).status).toBe(404);
		expect((await html("/ai-news/page/0", repo)).status).toBe(404);
	});

	it("redirects /page/N to the canonical query URL", async () => {
		const repo = desk();
		const index = await handleNewsRequest(new Request("https://3aik.test/ai-news/page/2"), { AI_NEWS_SITE_ORIGIN: ORIGIN }, { repo });
		expect(index.status).toBe(301);
		expect(index.headers.get("location")).toBe("https://3aik.com/ai-news?page=2");
		const first = await handleNewsRequest(new Request("https://3aik.test/ai-news/page/1"), { AI_NEWS_SITE_ORIGIN: ORIGIN }, { repo });
		expect(first.headers.get("location")).toBe("https://3aik.com/ai-news");
		const section = await handleNewsRequest(new Request("https://3aik.test/ai-news/ai/page/2"), { AI_NEWS_SITE_ORIGIN: ORIGIN }, { repo });
		expect(section.headers.get("location")).toBe("https://3aik.com/ai-news/ai?page=2");
		const archive = await handleNewsRequest(new Request("https://3aik.test/ai-news/archive/page/2"), { AI_NEWS_SITE_ORIGIN: ORIGIN }, { repo });
		expect(archive.headers.get("location")).toBe("https://3aik.com/ai-news/archive?page=2");
		const author = await handleNewsRequest(new Request("https://3aik.test/ai-news/author/mira-ellison/page/2"), { AI_NEWS_SITE_ORIGIN: ORIGIN }, { repo });
		expect(author.headers.get("location")).toBe("https://3aik.com/ai-news/author/mira-ellison?page=2");
	});

	it("keeps page 2 out of the page 1 cache key and still drops tracking params", () => {
		const tracked = newsCacheRequest(new Request("https://3aik.com/ai-news/article/demo?utm_source=rss"));
		const click = newsCacheRequest(new Request("https://3aik.com/ai-news/article/demo?fbclid=abc"));
		expect(tracked.url).toBe("https://3aik.com/ai-news/article/demo");
		expect(click.url).toBe(tracked.url);
		expect(newsCacheRequest(new Request("https://3aik.com/ai-news?page=2&utm_source=x")).url).toBe("https://3aik.com/ai-news?page=2");
		expect(newsCacheRequest(new Request("https://3aik.com/ai-news?page=1")).url).toBe("https://3aik.com/ai-news");
		expect(newsCacheRequest(new Request("https://3aik.com/ai-news?page=foo")).url).toBe("https://3aik.com/ai-news?page=foo");
	});

	it("links every article from the archive and lists them in both sitemaps", async () => {
		const repo = desk();
		const archive = await html("/ai-news/archive", repo);
		const older = await html("/ai-news/archive?page=2", repo);
		expect(archive.status).toBe(200);
		expect(archive.html).toContain('rel="canonical" href="https://3aik.com/ai-news/archive"');
		expect(archive.html).toContain('class="archive-day"');
		expect(older.html).toContain('rel="canonical" href="https://3aik.com/ai-news/archive?page=2"');
		const linked = new Set([...articleHrefs(archive.html), ...articleHrefs(older.html)]);
		expect([...linked].sort()).toEqual(repo.articles.map((article) => article.slug).sort());
		expect(archive.html).toContain('href="https://3aik.com/ai-news/editorial-policy"');
		expect(archive.html.split(ASSIST_LINE)).toHaveLength(2);

		const sitemap = await html("/ai-news/sitemap.xml", repo);
		expect(sitemap.html).toContain("https://3aik.com/ai-news/sitemap/1.xml");
		expect(sitemap.html).toContain("https://3aik.com/ai-news/news-sitemap.xml");
		expect(sitemap.html).not.toContain("https://3aik.com/ai-news/article/");
		const page = await html("/ai-news/sitemap/1.xml", repo);
		for (const article of repo.articles) {
			expect(page.html).toContain(`https://3aik.com/ai-news/article/${article.slug}`);
			expect(page.html).toContain(`<lastmod>${article.updatedAt}</lastmod>`);
		}
		expect(page.html).toContain("https://3aik.com/ai-news?page=2");
		expect(page.html).toContain("https://3aik.com/ai-news/archive");
		expect(page.html).toContain("https://3aik.com/ai-news/editorial-policy");
		expect(page.html).not.toContain("https://3aik.com/ai-news?page=1");

		const fresh = story(40);
		fresh.publishedAt = new Date().toISOString();
		fresh.updatedAt = fresh.publishedAt;
		fresh.slug = "fresh-window";
		repo.articles.push(fresh);
		const news = await html("/ai-news/news-sitemap.xml", repo);
		expect(news.html).toContain("news:news");
		expect(news.html).toContain("https://3aik.com/ai-news/article/fresh-window");
		expect(news.html).toContain(`<lastmod>${fresh.updatedAt}</lastmod>`);
		expect(news.html).not.toContain("https://3aik.com/ai-news/article/story-00");
	});

	it("publishes trust pages without invented contact details", async () => {
		const repo = desk(1);
		const about = await html("/ai-news/about", repo);
		const policy = await html("/ai-news/editorial-policy", repo);
		const corrections = await html("/ai-news/corrections", repo);
		const contact = await html("/ai-news/contact", repo);
		expect(about.status).toBe(200);
		expect(about.html).toContain("editorial-policy");
		expect(policy.status).toBe(200);
		expect(policy.html).toContain("rewritten with AI assistance");
		expect(policy.html).toContain("Source line");
		expect(policy.html).toContain("credit sits under the picture");
		expect(corrections.status).toBe(200);
		expect(corrections.html).toContain("date modified");
		expect(corrections.html).toContain("no separate public corrections log");
		expect(contact.status).toBe(200);
		expect(contact.html).toContain("has not published a contact address yet");
		expect(contact.html).not.toContain("mailto:");
		expect(contact.html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
		expect(contact.html).not.toContain("tel:");
		for (const page of [policy, corrections, contact]) {
			expect(page.html.match(/<p class="assist">/g)).toBeNull();
		}

		const named = await html("/ai-news/contact", repo, { AI_NEWS_CONTACT_EMAIL: "desk@example.com" });
		expect(named.html).toContain('href="mailto:desk@example.com"');
		const invalid = await html("/ai-news/contact", repo, { AI_NEWS_CONTACT_EMAIL: "not an email" });
		expect(invalid.html).not.toContain("mailto:");
		const index = await html("/ai-news", repo);
		expect(index.html).toContain('href="https://3aik.com/ai-news/editorial-policy">Editorial policy</a>');
		expect(index.html).toContain('href="https://3aik.com/ai-news/corrections">Corrections</a>');
		expect(index.html).toContain('href="https://3aik.com/ai-news/contact">Contact</a>');
		expect(index.html).toContain('href="https://3aik.com/ai-news/archive">Archive</a>');
	});

	it("gives every article a large social card and links the persona", async () => {
		const repo = new MemoryNewsRepository();
		repo.articles.push(story(0));
		const page = await html("/ai-news/article/story-00", repo);
		expect(page.html).toContain('property="og:image" content="https://3aik.com/og.png"');
		expect(page.html).toContain('name="twitter:card" content="summary_large_image"');
		expect(page.html).toContain('property="og:title" content="Story 00 stays inside the cited note"');
		expect(page.html).toContain('property="og:description" content="Description for story 00, kept inside the cited report."');
		expect(page.html).toContain('name="twitter:title" content="Story 00 stays inside the cited note"');
		expect(page.html).toContain('name="twitter:description" content="Description for story 00, kept inside the cited report."');
		expect(page.html).toContain('"publisher":{"@type":"NewsMediaOrganization","name":"3aik News"');
		expect(page.html).toContain('href="https://3aik.com/ai-news/author/mira-ellison"');
		expect(page.html.match(/<p class="assist">/g)).toHaveLength(1);
		expect(page.html.split(ASSIST_LINE)).toHaveLength(4);
		const author = await html("/ai-news/author/mira-ellison", repo);
		expect(author.status).toBe(200);
		expect(author.html).toContain("story-00");
	});
});
