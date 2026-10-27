import { AUTHORS } from "./authors";
import { ASSIST_LINE, CATEGORY_LABEL, SITE_NAME } from "./config";
import { mediaContentUrl } from "./lead";
import type { Category, SitemapEntry, StoredArticle } from "./types";
import { CATEGORIES } from "./types";
import { escapeHtml, escapeMarkdown, rfc822, sentenceCaseHeadline, stripEditorialDashes, xmlEscape } from "./text";

function articleUrl(origin: string, slug: string): string {
	return `${origin}/ai-news/article/${slug}`;
}

function feedTitle(article: StoredArticle): string {
	return sentenceCaseHeadline(stripEditorialDashes(article.title));
}

function encodedHtml(article: StoredArticle): string {
	const points = article.keyPoints.map((point) => `<li>${escapeHtml(stripEditorialDashes(point))}</li>`).join("");
	const paragraphs = article.bodyText
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph) => `<p>${escapeHtml(stripEditorialDashes(paragraph))}</p>`)
		.join("");
	const summary = article.keyPoints.length ? `<p><strong>TL;DR</strong></p><ul>${points}</ul>` : "";
	return `${summary}${paragraphs}`.replace(/]]>/g, "]]]]><![CDATA[>");
}

function mediaTag(origin: string, article: StoredArticle): string {
	const url = mediaContentUrl(origin, article.imageKey, article.imageCommit);
	if (!url) return "";
	return `<media:content url="${xmlEscape(url)}" medium="image" type="image/webp" width="1600" height="900"/>`;
}

export function renderRss(origin: string, articles: StoredArticle[], category?: Category): string {
	const link = category ? `${origin}/ai-news/${category}` : `${origin}/ai-news`;
	const self = `${link}/feed.xml`;
	const title = category ? `${SITE_NAME}: ${CATEGORY_LABEL[category]}` : SITE_NAME;
	const items = articles.map((article) => {
		const url = articleUrl(origin, article.slug);
		const media = mediaTag(origin, article);
		return `<item>
<title>${xmlEscape(feedTitle(article))}</title>
<link>${xmlEscape(url)}</link>
<guid isPermaLink="true">${xmlEscape(url)}</guid>
<pubDate>${xmlEscape(rfc822(article.publishedAt))}</pubDate>
<category>${xmlEscape(CATEGORY_LABEL[article.category])}</category>
<dc:creator>3aik News Desk</dc:creator>
<description>${xmlEscape(article.description)}</description>
${media}
<content:encoded><![CDATA[${encodedHtml(article)}]]></content:encoded>
</item>`;
	}).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<title>${xmlEscape(title)}</title>
<link>${xmlEscape(link)}</link>
<atom:link href="${xmlEscape(self)}" rel="self" type="application/rss+xml"/>
<description>${xmlEscape(ASSIST_LINE)}</description>
<language>en</language>
<lastBuildDate>${xmlEscape(new Date().toUTCString())}</lastBuildDate>
${items}
</channel>
</rss>`;
}

export function renderAtom(origin: string, articles: StoredArticle[], category?: Category): string {
	const link = category ? `${origin}/ai-news/${category}` : `${origin}/ai-news`;
	const self = `${link}/atom.xml`;
	const title = category ? `${SITE_NAME}: ${CATEGORY_LABEL[category]}` : SITE_NAME;
	const updated = articles[0]?.publishedAt ?? new Date().toISOString();
	const entries = articles.map((article) => {
		const url = articleUrl(origin, article.slug);
		const media = mediaTag(origin, article);
		const body = encodedHtml(article);
		return `<entry>
<title>${xmlEscape(feedTitle(article))}</title>
<link href="${xmlEscape(url)}" rel="alternate" type="text/html"/>
<id>${xmlEscape(url)}</id>
<updated>${xmlEscape(article.publishedAt)}</updated>
<published>${xmlEscape(article.publishedAt)}</published>
<author><name>3aik News Desk</name></author>
<summary>${xmlEscape(article.description)}</summary>
${media}
<content type="html"><![CDATA[${body}]]></content>
<content:encoded><![CDATA[${body}]]></content:encoded>
</entry>`;
	}).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<title>${xmlEscape(title)}</title>
<link href="${xmlEscape(link)}" rel="alternate" type="text/html"/>
<link href="${xmlEscape(self)}" rel="self" type="application/atom+xml"/>
<id>${xmlEscape(link)}</id>
<updated>${xmlEscape(updated)}</updated>
<subtitle>${xmlEscape(ASSIST_LINE)}</subtitle>
${entries}
</feed>`;
}

export function renderSitemap(
	origin: string,
	articles: Array<Pick<SitemapEntry, "slug" | "updatedAt"> & { publishedAt?: string }>,
	extraUrls: string[] = [],
): string {
	const staticUrls = [
		`${origin}/ai-news`,
		`${origin}/ai-news/about`,
		`${origin}/ai-news/editorial-policy`,
		`${origin}/ai-news/corrections`,
		`${origin}/ai-news/contact`,
		`${origin}/ai-news/archive`,
		`${origin}/ai-news/disclaimer`,
		...CATEGORIES.map((category) => `${origin}/ai-news/${category}`),
		...AUTHORS.map((author) => `${origin}/ai-news/author/${author.id}`),
		...extraUrls,
	];
	const staticEntries = staticUrls.map((url) => `<url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
	const articleEntries = articles.map((article) => {
		const modified = article.updatedAt.trim() || article.publishedAt?.trim() || "";
		const lastmod = modified ? `<lastmod>${xmlEscape(modified)}</lastmod>` : "";
		return `<url><loc>${xmlEscape(articleUrl(origin, article.slug))}</loc>${lastmod}</url>`;
	}).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticEntries}
${articleEntries}
</urlset>`;
}

export function renderSitemapIndex(origin: string, pages: number): string {
	const count = Math.max(1, Math.min(pages, 50));
	const pageEntries = Array.from({ length: count }, (_, index) => {
		const loc = `${origin}/ai-news/sitemap/${index + 1}.xml`;
		return `<sitemap><loc>${xmlEscape(loc)}</loc></sitemap>`;
	}).join("\n");
	const news = `<sitemap><loc>${xmlEscape(`${origin}/ai-news/news-sitemap.xml`)}</loc></sitemap>`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pageEntries}
${news}
</sitemapindex>`;
}

/**
 * Google News sitemaps only accept articles published in the last 48 hours.
 * Older stories stay in /ai-news/sitemap.xml with lastmod.
 */
export function renderNewsSitemap(
	origin: string,
	articles: Array<Pick<SitemapEntry, "slug" | "title" | "publishedAt"> & { updatedAt?: string }>,
	now = new Date(),
): string {
	const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
	const recent = articles.filter((article) => Date.parse(article.publishedAt) >= cutoff);
	const entries = recent.map((article) => {
		const modified = article.updatedAt?.trim() || article.publishedAt;
		return `<url>
<loc>${xmlEscape(articleUrl(origin, article.slug))}</loc>
<lastmod>${xmlEscape(modified)}</lastmod>
<news:news>
<news:publication><news:name>${xmlEscape(SITE_NAME)}</news:name><news:language>en</news:language></news:publication>
<news:publication_date>${xmlEscape(article.publishedAt)}</news:publication_date>
<news:title>${xmlEscape(sentenceCaseHeadline(stripEditorialDashes(article.title)))}</news:title>
</news:news>
</url>`;
	}).join("\n");
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
- [Editorial policy](${origin}/ai-news/editorial-policy): rewriting, source credit, picture credit, and corrections.
- [Corrections](${origin}/ai-news/corrections): how a story is updated when a cited source was misstated.
- [Contact](${origin}/ai-news/contact): where to send a correction when an address is published.
- [Archive](${origin}/ai-news/archive): every published story, by date.
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
