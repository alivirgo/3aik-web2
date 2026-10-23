import { authorById, AUTHORS } from "./authors";
import {
	ACCURACY_DISCLAIMER,
	CATEGORY_DECK,
	CATEGORY_LABEL,
	DESK_DISCLOSURE,
	PUBLISHER_NAME,
	SITE_NAME,
	personaFooter,
} from "./config";
import type { Category, StoredArticle } from "./types";
import { CATEGORIES } from "./types";
import { escapeHtml, formatDate, jsonForScript, stripEditorialDashes } from "./text";

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function renderInline(text: string, allow: Set<string>): string {
	const source = stripEditorialDashes(text);
	let html = "";
	let last = 0;
	for (const match of source.matchAll(LINK_PATTERN)) {
		const index = match.index ?? 0;
		html += escapeHtml(source.slice(last, index));
		const label = match[1] ?? "";
		const href = match[2] ?? "";
		if (allow.has(href)) {
			const external = href.startsWith("http");
			const rel = external ? ` rel="noopener noreferrer"` : "";
			html += `<a href="${escapeHtml(href)}"${rel}>${escapeHtml(label)}</a>`;
		} else {
			html += escapeHtml(label);
		}
		last = index + match[0].length;
	}
	html += escapeHtml(source.slice(last));
	return html;
}

export function renderBodyHtml(paragraphs: string[], allow: Set<string>): string {
	return paragraphs.map((paragraph) => `<p>${renderInline(paragraph, allow)}</p>`).join("\n");
}

export function paragraphsFromBody(bodyText: string): string[] {
	return bodyText.split(/\n\n+/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function visibleTitle(title: string): string {
	return stripEditorialDashes(title);
}

function categoryHref(origin: string, category: Category): string {
	return `${origin}/ai-news/${category}`;
}

function articleHref(origin: string, slug: string): string {
	return `${origin}/ai-news/article/${slug}`;
}

function authorHref(origin: string, id: string): string {
	return `${origin}/ai-news/author/${id}`;
}

interface PageOptions {
	origin: string;
	title: string;
	description: string;
	canonical: string;
	body: string;
	robots?: string;
	ogType?: string;
	image?: string;
	imageAlt?: string;
	jsonLd?: unknown[];
	publishedAt?: string;
	section?: string;
	tags?: string[];
}

export function renderPage(options: PageOptions): string {
	const description = stripEditorialDashes(options.description);
	const title = stripEditorialDashes(options.title);
	const imageTags = options.image
		? `<meta property="og:image" content="${escapeHtml(options.image)}">
<meta property="og:image:alt" content="${escapeHtml(options.imageAlt ?? "")}">
<meta name="twitter:image" content="${escapeHtml(options.image)}">
<meta name="twitter:image:alt" content="${escapeHtml(options.imageAlt ?? "")}">`
		: "";
	const published = options.publishedAt
		? `<meta property="article:published_time" content="${escapeHtml(options.publishedAt)}">
<meta property="article:modified_time" content="${escapeHtml(options.publishedAt)}">`
		: "";
	const section = options.section ? `<meta property="article:section" content="${escapeHtml(options.section)}">` : "";
	const tags = (options.tags ?? []).map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`).join("\n");
	const scripts = (options.jsonLd ?? []).map((entry) => `<script type="application/ld+json">${jsonForScript(entry)}</script>`).join("\n");
	const nav = CATEGORIES.map((category) => {
		const current = options.canonical.includes(`/ai-news/${category}`) ? ` aria-current="page"` : "";
		return `<a href="${categoryHref(options.origin, category)}"${current}>${CATEGORY_LABEL[category]}</a>`;
	}).join("");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(options.canonical)}">
<meta name="robots" content="${escapeHtml(options.robots ?? "index,follow,max-image-preview:large")}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="${escapeHtml(options.ogType ?? "website")}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(options.canonical)}">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="${options.image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${imageTags}
${published}
${section}
${tags}
<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="${options.origin}/ai-news/feed.xml">
<link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="${options.origin}/ai-news/atom.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/ai-news.css">
${scripts}
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="top">
<div class="top-bar">
<a class="brand" href="${options.origin}/ai-news">3aik News</a>
<nav aria-label="Sections">${nav}<a href="${options.origin}/ai-news/about">About</a></nav>
</div>
<p class="disclosure">${escapeHtml(DESK_DISCLOSURE)}</p>
</header>
<main id="content">${options.body}</main>
<footer class="site-foot">
<p>${escapeHtml(ACCURACY_DISCLAIMER)}</p>
<p class="foot-links"><a href="${options.origin}/ai-news/about">About this desk</a><a href="${options.origin}/ai-news/disclaimer">Disclaimer</a><a href="${options.origin}/">3aik home</a></p>
</footer>
</body>
</html>`;
}

function crumbs(origin: string, items: Array<{ href?: string; label: string }>): { html: string; json: unknown } {
	const html = `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
		.map((item, index) => {
			const last = index === items.length - 1;
			const inner = item.href && !last ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>` : escapeHtml(item.label);
			return `<li>${inner}</li>`;
		})
		.join("")}</ol></nav>`;
	return {
		html,
		json: {
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: items.map((item, index) => ({
				"@type": "ListItem",
				position: index + 1,
				name: item.label,
				...(item.href ? { item: item.href } : {}),
			})),
		},
	};
}

function articleCard(origin: string, article: StoredArticle): string {
	const author = authorById(article.authorId);
	const name = author?.name ?? article.authorId;
	return `<article class="card">
<a class="card-media" href="${articleHref(origin, article.slug)}"><img src="${origin}/ai-news/image/${escapeHtml(article.id)}" alt="${escapeHtml(article.imageAlt)}" width="1024" height="1024"></a>
<p class="meta"><a href="${categoryHref(origin, article.category)}">${CATEGORY_LABEL[article.category]}</a> · <time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatDate(article.publishedAt))}</time></p>
<h2><a href="${articleHref(origin, article.slug)}">${escapeHtml(visibleTitle(article.title))}</a></h2>
<p>${escapeHtml(stripEditorialDashes(article.description))}</p>
<p class="by">By <a href="${authorHref(origin, article.authorId)}">${escapeHtml(name)}</a>, editorial persona <span class="ai-label">AI-generated</span></p>
</article>`;
}

export function renderIndex(origin: string, articles: StoredArticle[]): string {
	const canonical = `${origin}/ai-news`;
	const description = "AI-assisted news on AI, technology, fashion, and showbiz, rewritten from credible outlets and linked back to them.";
	const list = articles.length
		? `<div class="cards">${articles.map((article) => articleCard(origin, article)).join("")}</div>`
		: `<p class="empty">No stories are published yet. The desk publishes on a schedule from public reporting by named outlets.</p>`;
	const body = `<h1>News</h1>
<p class="deck">Original briefs built from credible reporting. Each piece names its sources, and the author byline is a persona rather than a human reporter.</p>
${list}`;
	return renderPage({
		origin,
		title: `${SITE_NAME}`,
		description,
		canonical,
		body,
		jsonLd: [{
			"@context": "https://schema.org",
			"@type": "CollectionPage",
			name: SITE_NAME,
			description,
			url: canonical,
			isPartOf: { "@type": "WebSite", name: PUBLISHER_NAME, url: origin },
		}],
	});
}

export function renderCategory(origin: string, category: Category, articles: StoredArticle[]): string {
	const canonical = categoryHref(origin, category);
	const label = CATEGORY_LABEL[category];
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: canonical, label },
	]);
	const list = articles.length
		? `<div class="cards">${articles.map((article) => articleCard(origin, article)).join("")}</div>`
		: `<p class="empty">No ${escapeHtml(label)} stories are published yet.</p>`;
	return renderPage({
		origin,
		title: `${label} news | ${SITE_NAME}`,
		description: CATEGORY_DECK[category],
		canonical,
		body: `${trail.html}<h1>${escapeHtml(label)}</h1><p class="deck">${escapeHtml(CATEGORY_DECK[category])}</p>${list}`,
		jsonLd: [trail.json],
	});
}

export function renderAuthor(origin: string, authorId: string, articles: StoredArticle[]): string | null {
	const author = authorById(authorId);
	if (!author) return null;
	const canonical = authorHref(origin, author.id);
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: categoryHref(origin, author.category), label: CATEGORY_LABEL[author.category] },
		{ href: canonical, label: author.name },
	]);
	const list = articles.length
		? `<div class="cards">${articles.map((article) => articleCard(origin, article)).join("")}</div>`
		: `<p class="empty">No stories from this persona yet.</p>`;
	const body = `${trail.html}
<h1>${escapeHtml(author.name)}</h1>
<p class="kicker">${escapeHtml(CATEGORY_LABEL[author.category])} · ${escapeHtml(author.beat)}</p>
<p>${escapeHtml(author.bio)}</p>
<p>${escapeHtml(personaFooter(author.name))}</p>
${list}`;
	return renderPage({
		origin,
		title: `${author.name} | ${SITE_NAME}`,
		description: author.bio.slice(0, 160),
		canonical,
		body,
		jsonLd: [
			trail.json,
			{
				"@context": "https://schema.org",
				"@type": "ProfilePage",
				name: author.name,
				url: canonical,
				description: author.bio,
				mainEntity: {
					"@type": "Organization",
					name: author.name,
					description: "Editorial persona on the 3aik news desk. Not a real person.",
					url: canonical,
				},
			},
		],
	});
}

export function renderArticle(origin: string, article: StoredArticle): string {
	const author = authorById(article.authorId);
	const name = author?.name ?? "Desk persona";
	const canonical = articleHref(origin, article.slug);
	const image = `${origin}/ai-news/image/${article.id}`;
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: categoryHref(origin, article.category), label: CATEGORY_LABEL[article.category] },
		{ label: stripEditorialDashes(article.title) },
	]);
	const points = article.keyPoints.map((point) => `<li>${escapeHtml(stripEditorialDashes(point))}</li>`).join("");
	const faqs = article.faq
		.map((item) => `<h3>${escapeHtml(stripEditorialDashes(item.question))}</h3><p>${escapeHtml(stripEditorialDashes(item.answer))}</p>`)
		.join("");
	const sources = article.sources
		.map((source) => `<li><a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(stripEditorialDashes(source.outlet))}: ${escapeHtml(stripEditorialDashes(source.title))}</a></li>`)
		.join("");
	const related = article.related.length
		? `<section><h2>Related on this desk</h2><ul>${article.related
			.map((item) => `<li><a href="${articleHref(origin, item.slug)}">${escapeHtml(stripEditorialDashes(item.title))}</a></li>`)
			.join("")}</ul></section>`
		: "";
	const title = visibleTitle(article.title);
	const allow = new Set<string>([
		...article.sources.map((source) => source.url),
		...article.related.map((item) => articleHref(origin, item.slug)),
	]);
	const prose = renderBodyHtml(paragraphsFromBody(article.bodyText), allow);
	const body = `${trail.html}
<article>
<p class="meta"><a href="${categoryHref(origin, article.category)}">${CATEGORY_LABEL[article.category]}</a> · <time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatDate(article.publishedAt))}</time></p>
<h1>${escapeHtml(title)}</h1>
<p class="by">By <a href="${authorHref(origin, article.authorId)}">${escapeHtml(name)}</a>, editorial persona <span class="ai-label">AI-generated</span></p>
<figure><img src="${image}" alt="${escapeHtml(article.imageAlt)}" width="1024" height="1024"><figcaption>${escapeHtml(article.imageAlt)}</figcaption></figure>
<section class="tldr" aria-labelledby="tldr"><h2 id="tldr">TL;DR</h2><ul>${points}</ul></section>
<div class="prose">${prose}</div>
<section class="faq" aria-labelledby="faq"><h2 id="faq">Questions</h2>${faqs}</section>
<section><h2>Sources</h2><ul>${sources}</ul></section>
${related}
<p class="persona-foot">${escapeHtml(personaFooter(name))}</p>
</article>`;
	const newsLd = {
		"@context": "https://schema.org",
		"@type": "NewsArticle",
		headline: title,
		description: article.description,
		image: [image],
		datePublished: article.publishedAt,
		dateModified: article.updatedAt,
		articleSection: CATEGORY_LABEL[article.category],
		keywords: article.tags.join(", "),
		author: {
			"@type": "Organization",
			name: SITE_NAME,
			url: `${origin}/ai-news`,
			description: `The byline ${name} is an editorial persona, not a real person.`,
		},
		publisher: {
			"@type": "Organization",
			name: PUBLISHER_NAME,
			url: origin,
			logo: { "@type": "ImageObject", url: `${origin}/icon-512.png` },
		},
		mainEntityOfPage: canonical,
		isBasedOn: article.sources.map((source) => ({
			"@type": "NewsArticle",
			headline: stripEditorialDashes(source.title),
			url: source.url,
			publisher: { "@type": "Organization", name: source.outlet },
		})),
	};
	const faqLd = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: article.faq.map((item) => ({
			"@type": "Question",
			name: item.question,
			acceptedAnswer: { "@type": "Answer", text: item.answer },
		})),
	};
	return renderPage({
		origin,
		title: `${title} | ${SITE_NAME}`,
		description: article.description,
		canonical,
		body,
		ogType: "article",
		image,
		imageAlt: article.imageAlt,
		publishedAt: article.publishedAt,
		section: CATEGORY_LABEL[article.category],
		tags: article.tags,
		jsonLd: [newsLd, trail.json, faqLd],
	});
}

export function renderAbout(origin: string): string {
	const canonical = `${origin}/ai-news/about`;
	const roster = AUTHORS.map((author) => `<li><a href="${authorHref(origin, author.id)}">${escapeHtml(author.name)}</a> <span>${escapeHtml(CATEGORY_LABEL[author.category])} · ${escapeHtml(author.beat)}</span><br>${escapeHtml(author.bio)}</li>`).join("");
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: canonical, label: "About" },
	]);
	const body = `${trail.html}
<h1>About this desk</h1>
<p>3aik News is the news section of 3aik.com. Articles are written with AI assistance and editorially checked before they are published.</p>
<h2>What the check is</h2>
<p>The editorial check is a set of desk rules applied before publishing. A draft must link at least one credible source, avoid copying that source's sentences, attribute sensitive claims, clear a length and sentence-variety bar, and avoid a list of stock phrases. The check is not a claim that a human reporter witnessed the event, and it is not a promise that the story is complete.</p>
<h2>Personas are not real people</h2>
<p>Twenty-four named author personas split the beats across AI, technology, fashion, and showbiz. Each persona has a fixed beat and a distinct voice. A bio describes that voice. It does not describe a degree, an employer, or a human career. Do not treat a persona as a real journalist.</p>
<h2>Sources and disputes</h2>
<p>Every article is built from at least one story already published by a configured outlet, then rewritten. The source is linked. Fashion and showbiz pieces repeat disputed claims only when that outlet reported them, and they attribute the claim. They do not add allegations about real people.</p>
<h2>Pictures</h2>
<p>Each article includes one generated illustration. The picture is not a photograph of a real person, and it does not use a company logo.</p>
<h2>The roster</h2>
<ul class="roster">${roster}</ul>
<p><a href="${origin}/ai-news/disclaimer">Read the disclaimer</a>.</p>`;
	return renderPage({
		origin,
		title: `About | ${SITE_NAME}`,
		description: "How 3aik News uses AI assistance, editorial checks, and 24 personas who are not real people.",
		canonical,
		body,
		jsonLd: [trail.json, {
			"@context": "https://schema.org",
			"@type": "AboutPage",
			name: `About ${SITE_NAME}`,
			url: canonical,
			description: "Articles are AI-assisted, editorially checked, and written under personas who are not real people.",
		}],
	});
}

export function renderDisclaimer(origin: string): string {
	const canonical = `${origin}/ai-news/disclaimer`;
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: canonical, label: "Disclaimer" },
	]);
	const body = `${trail.html}
<h1>Disclaimer</h1>
<p>${escapeHtml(ACCURACY_DISCLAIMER)}</p>
<p>Reports can be incomplete, outdated, or wrong even when they link to a credible outlet. Read the linked source before you rely on a claim. Headlines here can be specific, and they are not supposed to state a fact the article does not support. If a headline and a source disagree, trust the source and treat this page as a brief, not as the record.</p>
<p>Articles are written with AI assistance. Named authors are editorial personas, not real people. They do not have private sources or personal knowledge of the events they describe. A persona bio is a description of a writing voice, not a credential.</p>
<p>The editorial check rejects some drafts before publishing. It looks for a real source link, copied wording, missing attribution, and a short list of writing failures. Passing the check does not make a story true.</p>
<p>Fashion and showbiz copy may mention a dispute only when a credible outlet has already reported it. The sentence should name that outlet. This desk does not add allegations of its own about real people.</p>
<p>Nothing on these pages is legal, medical, financial, or other professional advice.</p>
<p><a href="${origin}/ai-news/about">About this desk</a></p>`;
	return renderPage({
		origin,
		title: `Disclaimer | ${SITE_NAME}`,
		description: "3aik.com takes no responsibility for the accuracy of news. Verify claims with the linked original sources.",
		canonical,
		body,
		jsonLd: [trail.json],
	});
}

export function renderNotFound(origin: string): string {
	return renderPage({
		origin,
		title: `Not found | ${SITE_NAME}`,
		description: "That news page is not on this desk.",
		canonical: `${origin}/ai-news`,
		robots: "noindex",
		body: `<h1>Not found</h1><p>That page is not on the news desk. <a href="${origin}/ai-news">Back to the latest stories</a>.</p>`,
	});
}
