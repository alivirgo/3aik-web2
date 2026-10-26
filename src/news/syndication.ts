import { AUTHORS, authorById } from "./authors";
import { ASSIST_LINE, CATEGORY_LABEL, SITE_NAME } from "./config";
import type { Category, SitemapEntry, StoredArticle } from "./types";
import { CATEGORIES } from "./types";
import { escapeMarkdown, rfc822, stripEditorialDashes, xmlEscape } from "./text";

function articleUrl(origin: string, slug: string): string {
	return `${origin}/ai-news/article/${slug}`;
}

export function renderRss(origin: string, articles: StoredArticle[], category?: Category): string {
	const link = category ? `${origin}/ai-news/${category}` : `${origin}/ai-news`;
	const title = category ? `${SITE_NAME}: ${CATEGORY_LABEL[category]}` : SITE_NAME;
	const items = articles.map((article) => {
		const author = authorById(article.authorId);
		const name = author?.name ?? "Desk";
		const url = articleUrl(origin, article.slug);
		const description = article.description;
		return `<item>
<title>${xmlEscape(stripEditorialDashes(article.title))}</title>
<link>${xmlEscape(url)}</link>
<guid isPermaLink="true">${xmlEscape(url)}</guid>
<pubDate>${xmlEscape(rfc822(article.publishedAt))}</pubDate>
<category>${xmlEscape(CATEGORY_LABEL[article.category])}</category>
<dc:creator>${xmlEscape(name)}</dc:creator>
<description>${xmlEscape(description)}</description>
</item>`;
	}).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${xmlEscape(title)}</title>
<link>${xmlEscape(link)}</link>
<description>${xmlEscape(ASSIST_LINE)}</description>
<language>en</language>
<lastBuildDate>${xmlEscape(new Date().toUTCString())}</lastBuildDate>
${items}
</channel>
</rss>`;
}

export function renderAtom(origin: string, articles: StoredArticle[], category?: Category): string {
	const link = category ? `${origin}/ai-news/${category}` : `${origin}/ai-news`;
	const title = category ? `${SITE_NAME}: ${CATEGORY_LABEL[category]}` : SITE_NAME;
	const updated = articles[0]?.publishedAt ?? new Date().toISOString();
	const entries = articles.map((article) => {
		const author = authorById(article.authorId);
		const name = author?.name ?? "Desk";
		const url = articleUrl(origin, article.slug);
		const summary = article.description;
		return `<entry>
<title>${xmlEscape(stripEditorialDashes(article.title))}</title>
<link href="${xmlEscape(url)}" rel="alternate" type="text/html"/>
<id>${xmlEscape(url)}</id>
<updated>${xmlEscape(article.publishedAt)}</updated>
<published>${xmlEscape(article.publishedAt)}</published>
<author><name>${xmlEscape(name)}</name></author>
<summary>${xmlEscape(summary)}</summary>
</entry>`;
	}).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xmlEscape(title)}</title>
<link href="${xmlEscape(link)}" rel="alternate" type="text/html"/>
<link href="${xmlEscape(`${link}${category ? "" : ""}/atom.xml`)}" rel="self"/>
<id>${xmlEscape(link)}</id>
<updated>${xmlEscape(updated)}</updated>
<subtitle>${xmlEscape(ASSIST_LINE)}</subtitle>
${entries}
</feed>`;
}

export function renderSitemap(origin: string, articles: Array<Pick<SitemapEntry, "slug" | "updatedAt">>): string {
	const staticUrls = [
		`${origin}/ai-news`,
		`${origin}/ai-news/about`,
		`${origin}/ai-news/disclaimer`,
		...CATEGORIES.map((category) => `${origin}/ai-news/${category}`),
		...AUTHORS.map((author) => `${origin}/ai-news/author/${author.id}`),
	];
	const staticEntries = staticUrls.map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
	const articleEntries = articles.map((article) => `<url><loc>${xmlEscape(articleUrl(origin, article.slug))}</loc><lastmod>${xmlEscape(article.updatedAt)}</lastmod></url>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${articleEntries}
</urlset>`;
}

export function renderNewsSitemap(origin: string, articles: Array<Pick<SitemapEntry, "slug" | "title" | "publishedAt">>, now = new Date()): string {
	const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
	const recent = articles.filter((article) => Date.parse(article.publishedAt) >= cutoff);
	const entries = recent.map((article) => `<url>
<loc>${xmlEscape(articleUrl(origin, article.slug))}</loc>
<news:news>
<news:publication><news:name>${xmlEscape(SITE_NAME)}</news:name><news:language>en</news:language></news:publication>
<news:publication_date>${xmlEscape(article.publishedAt)}</news:publication_date>
<news:title>${xmlEscape(stripEditorialDashes(article.title))}</news:title>
</news:news>
</url>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries}
</urlset>`;
}

export function renderLlmsTxt(origin: string, articles: StoredArticle[]): string {
	const sections = CATEGORIES.map((category) => `- [${CATEGORY_LABEL[category]}](${origin}/ai-news/${category}): ${CATEGORY_LABEL[category]} coverage.`).join("\n");
	const recent = articles.slice(0, 20).map((article) => {
		const title = escapeMarkdown(stripEditorialDashes(article.title));
		const description = escapeMarkdown(stripEditorialDashes(article.description));
		return `- [${title}](${articleUrl(origin, article.slug)}): ${description}`;
	}).join("\n");
	return `# 3aik News

> ${ASSIST_LINE}

## Read this first

- [About the desk](${origin}/ai-news/about): how articles are made, and the rule that personas are not real humans.
- [Disclaimer](${origin}/ai-news/disclaimer): accuracy limits and source checking.

## Sections

${sections}

## Feeds

- [RSS](${origin}/ai-news/feed.xml)
- [Atom](${origin}/ai-news/atom.xml)
- [Sitemap](${origin}/ai-news/sitemap.xml)
- [Google News sitemap](${origin}/ai-news/news-sitemap.xml)

## Recent articles

${recent || "- None published yet."}
`;
}
