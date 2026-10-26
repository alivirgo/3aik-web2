import { ADSENSE_SCRIPT } from "../adsense";
import { authorById, AUTHORS } from "./authors";
import {
	ACCURACY_DISCLAIMER,
	ASSIST_LINE,
	CATEGORY_DECK,
	CATEGORY_LABEL,
	PUBLISHER_NAME,
	SITE_NAME,
} from "./config";
import { readerImageUrl } from "./github-images";
import type { Category, StoredArticle } from "./types";
import { CATEGORIES } from "./types";
import {
	escapeHtml,
	formatDate,
	formatDateline,
	formatTimestamp,
	jsonForScript,
	readingLabel,
	readingMinutes,
	relativeTime,
	stripEditorialDashes,
} from "./text";

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SHORT_LIST_NOTE = "More stories will show up here as the desk publishes. What is live so far is on this page.";
const STACK_NOTE = "The next briefs will land in this column.";

/** Short labels for the section nav. Full names stay in CATEGORY_LABEL for pages and schema. */
const CHIP_LABEL: Record<Category, string> = {
	ai: "AI",
	technology: "Tech",
	fashion: "Fashion",
	showbiz: "Showbiz",
};

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

export function authorInitials(name: string): string {
	const letters = name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase() ?? "");
	return letters.slice(0, 2).join("") || "N";
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

type NavCurrent = "about" | Category;

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
	modifiedAt?: string;
	section?: string;
	tags?: string[];
	navCurrent?: NavCurrent;
	footerNote?: string;
}

function sectionNav(origin: string, current?: NavCurrent): string {
	const mark = (key: NavCurrent) => (current === key ? ` aria-current="page"` : "");
	const chips = CATEGORIES.map((category) => {
		return `<a href="${categoryHref(origin, category)}"${mark(category)}>${CHIP_LABEL[category]}</a>`;
	}).join("");
	return `<nav class="sections" aria-label="Sections">${chips}</nav>`;
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
<meta property="article:modified_time" content="${escapeHtml(options.modifiedAt ?? options.publishedAt)}">`
		: "";
	const section = options.section ? `<meta property="article:section" content="${escapeHtml(options.section)}">` : "";
	const tags = (options.tags ?? []).map((tag) => `<meta property="article:tag" content="${escapeHtml(tag)}">`).join("\n");
	const scripts = (options.jsonLd ?? []).map((entry) => `<script type="application/ld+json">${jsonForScript(entry)}</script>`).join("\n");
	const dateline = formatDateline();
	const aboutCurrent = options.navCurrent === "about" ? ` aria-current="page"` : "";
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
${ADSENSE_SCRIPT}
</head>
<body class="desk">
<a class="skip" href="#content">Skip to content</a>
<header class="top">
<div class="wrap">
<div class="topbar">
<time class="dateline" datetime="${escapeHtml(dateline.iso)}">${escapeHtml(dateline.label)}</time>
<a href="${options.origin}/ai-news/about"${aboutCurrent}>About</a>
</div>
<a class="brand" href="${options.origin}/ai-news">3aik News</a>
${sectionNav(options.origin, options.navCurrent)}
</div>
</header>
<main id="content"><div class="wrap">${options.body}</div></main>
<footer class="site-foot">
<div class="wrap">
${options.footerNote ? `<p class="assist">${escapeHtml(options.footerNote)}</p>` : ""}
<p class="foot-links"><a href="${options.origin}/ai-news/about">About this desk</a><a href="${options.origin}/ai-news/disclaimer">Disclaimer</a><a href="${options.origin}/">3aik home</a></p>
</div>
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

function kickerLink(origin: string, category: Category): string {
	return `<p class="kicker"><a href="${categoryHref(origin, category)}">${CATEGORY_LABEL[category]}</a></p>`;
}

function sourceLine(article: StoredArticle): string {
	if (!article.sources.length) return "";
	const links = article.sources.map((source) => {
		const label = stripEditorialDashes(source.outlet) || "Source";
		return `<a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
	}).join(", ");
	return `<p class="source-line">Source: ${links}</p>`;
}

function byline(origin: string, article: StoredArticle, now: number): string {
	const author = authorById(article.authorId);
	const name = author?.name ?? article.authorId;
	return `<p class="byline">
<span class="avatar" aria-hidden="true">${escapeHtml(authorInitials(name))}</span>
<span class="byline-copy">
<span class="by">By <a href="${authorHref(origin, article.authorId)}">${escapeHtml(name)}</a> · <a href="${origin}/ai-news/about">Persona</a></span>
<span class="times"><time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatDate(article.publishedAt))}</time><span class="rel">${escapeHtml(relativeTime(article.publishedAt, now))}</span><span class="read">${escapeHtml(readingLabel(article.bodyText))}</span></span>
</span>
</p>`;
}

export function articleImage(origin: string, article: StoredArticle): { src: string; external: boolean } | null {
	const stored = readerImageUrl(origin, article.imageKey, article.imageCommit);
	if (!stored) return null;
	return { src: stored, external: false };
}

export function externalImageOrigins(origin: string, articles: StoredArticle[]): string[] {
	const origins: string[] = [];
	for (const article of articles) {
		const image = articleImage(origin, article);
		if (!image?.external) continue;
		try {
			const value = new URL(image.src).origin;
			if (value.startsWith("https://") && !/[\s;]/.test(value) && !origins.includes(value)) origins.push(value);
		} catch {
			continue;
		}
	}
	return origins;
}

function heroImg(article: StoredArticle, image: string): string {
	return `<img src="${escapeHtml(image)}" alt="${escapeHtml(article.imageAlt)}" width="1600" height="900" loading="eager" fetchpriority="high" decoding="async">`;
}

function thumbImg(article: StoredArticle, image: string): string {
	return `<img src="${escapeHtml(image)}" alt="${escapeHtml(article.imageAlt)}" width="240" height="160" loading="lazy" decoding="async">`;
}

function cardImg(article: StoredArticle, image: string): string {
	return `<img src="${escapeHtml(image)}" alt="${escapeHtml(article.imageAlt)}" width="640" height="360" loading="lazy" decoding="async">`;
}

function latestList(origin: string, articles: StoredArticle[], now: number): string {
	if (!articles.length) return `<p class="rail-empty">No other stories yet.</p>`;
	const items = articles.map((article) => {
		return `<li><time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatTimestamp(article.publishedAt, now))}</time><a href="${articleHref(origin, article.slug)}">${escapeHtml(visibleTitle(article.title))}</a></li>`;
	}).join("");
	return `<ol class="latest-list">${items}</ol>`;
}

function sideStory(origin: string, article: StoredArticle, now: number): string {
	const image = articleImage(origin, article)?.src ?? "";
	const media = image ? `<a class="thumb" href="${articleHref(origin, article.slug)}">${thumbImg(article, image)}</a>` : "";
	return `<article class="side">
${media}
<div>
${kickerLink(origin, article.category)}
<h3><a href="${articleHref(origin, article.slug)}">${escapeHtml(visibleTitle(article.title))}</a></h3>
<p class="meta"><time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatTimestamp(article.publishedAt, now))}</time> <span class="rel">${escapeHtml(relativeTime(article.publishedAt, now))}</span></p>
</div>
</article>`;
}

function storyCard(origin: string, article: StoredArticle, now: number): string {
	const image = articleImage(origin, article)?.src ?? "";
	const media = image ? `<a class="card-media" href="${articleHref(origin, article.slug)}">${cardImg(article, image)}</a>` : "";
	return `<article class="card">
${media}
<div class="card-body">
${kickerLink(origin, article.category)}
<h3><a href="${articleHref(origin, article.slug)}">${escapeHtml(visibleTitle(article.title))}</a></h3>
<p class="meta"><time datetime="${escapeHtml(article.publishedAt)}">${escapeHtml(formatTimestamp(article.publishedAt, now))}</time></p>
</div>
</article>`;
}

function sectionBand(origin: string, category: Category, articles: StoredArticle[], now: number): string {
	if (!articles.length) return "";
	const cards = articles.slice(0, 4).map((article) => storyCard(origin, article, now)).join("");
	return `<section class="band">
<h2 class="section-label"><a href="${categoryHref(origin, category)}">${CATEGORY_LABEL[category]}</a></h2>
<div class="section-row">${cards}</div>
</section>`;
}

function frontPage(origin: string, articles: StoredArticle[], now: number): string {
	const lead = articles[0];
	if (!lead) return "";
	const image = articleImage(origin, lead)?.src ?? "";
	const media = image ? `<a class="lead-media" href="${articleHref(origin, lead.slug)}">${heroImg(lead, image)}</a>` : "";
	const stackItems = articles.slice(1, 5);
	const stack = stackItems.length
		? stackItems.map((article) => sideStory(origin, article, now)).join("")
		: `<p class="stack-empty">${STACK_NOTE}</p>`;
	const bands = CATEGORIES.map((category) => sectionBand(origin, category, articles.filter((article) => article.category === category), now)).join("");
	const note = articles.length < 5 ? `<p class="more">${SHORT_LIST_NOTE}</p>` : "";
	return `<div class="front">
<article class="lead">
${media}
${kickerLink(origin, lead.category)}
<h2><a href="${articleHref(origin, lead.slug)}">${escapeHtml(visibleTitle(lead.title))}</a></h2>
<p class="dek">${escapeHtml(stripEditorialDashes(lead.description))}</p>
${byline(origin, lead, now)}
</article>
<div class="stack">${stack}</div>
<aside class="latest"><h2 class="section-label">Latest</h2>${latestList(origin, articles.slice(0, 8), now)}</aside>
</div>
${note}
${bands}`;
}

function shareNav(canonical: string, title: string): string {
	const url = encodeURIComponent(canonical);
	const text = encodeURIComponent(title);
	const email = `mailto:?subject=${text}&body=${encodeURIComponent(`${title} ${canonical}`)}`;
	const tweet = `https://x.com/intent/tweet?url=${url}&text=${text}`;
	const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${url}`;
	return `<h2>Share</h2>
<nav class="share" aria-label="Share this article"><a href="${escapeHtml(canonical)}">Article link</a><a href="${escapeHtml(email)}">Email</a><a href="${escapeHtml(tweet)}" rel="noopener noreferrer">X</a><a href="${escapeHtml(linkedin)}" rel="noopener noreferrer">LinkedIn</a></nav>`;
}

export function renderIndex(origin: string, articles: StoredArticle[]): string {
	const canonical = `${origin}/ai-news`;
	const description = "AI-assisted news on AI, technology, fashion, and showbiz, rewritten from credible outlets and linked back to them.";
	const now = Date.now();
	const body = articles.length
		? frontPage(origin, articles, now)
		: `<p class="empty">No stories are published yet. The desk publishes on a schedule from public reporting by named outlets.</p>`;
	return renderPage({
		origin,
		title: `${SITE_NAME}`,
		description,
		canonical,
		footerNote: ASSIST_LINE,
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
	const now = Date.now();
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: canonical, label },
	]);
	const list = articles.length
		? `${sectionBand(origin, category, articles, now)}${articles.length < 5 ? `<p class="more">${SHORT_LIST_NOTE}</p>` : ""}`
		: `<p class="empty">No ${escapeHtml(label)} stories are published yet.</p>`;
	return renderPage({
		origin,
		title: `${label} news | ${SITE_NAME}`,
		description: CATEGORY_DECK[category],
		canonical,
		navCurrent: category,
		footerNote: ASSIST_LINE,
		body: `${trail.html}<header class="section-head"><h1>${escapeHtml(label)}</h1><p class="deck">${escapeHtml(CATEGORY_DECK[category])}</p></header>${list}`,
		jsonLd: [trail.json],
	});
}

export function renderAuthor(origin: string, authorId: string, articles: StoredArticle[]): string | null {
	const author = authorById(authorId);
	if (!author) return null;
	const canonical = authorHref(origin, author.id);
	const now = Date.now();
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: categoryHref(origin, author.category), label: CATEGORY_LABEL[author.category] },
		{ href: canonical, label: author.name },
	]);
	const list = articles.length
		? `<h2 class="section-label">Stories</h2><div class="section-row">${articles.slice(0, 4).map((article) => storyCard(origin, article, now)).join("")}</div>${articles.length < 5 ? `<p class="more">${SHORT_LIST_NOTE}</p>` : ""}`
		: `<p class="empty">No stories from this persona yet.</p>`;
	const body = `${trail.html}
<header class="persona">
<span class="avatar avatar-lg" aria-hidden="true">${escapeHtml(authorInitials(author.name))}</span>
<div>
<h1>${escapeHtml(author.name)}</h1>
<p class="kicker">${escapeHtml(CATEGORY_LABEL[author.category])} · ${escapeHtml(author.beat)}</p>
</div>
</header>
<p class="persona-bio">${escapeHtml(author.bio)}</p>
${list}`;
	return renderPage({
		origin,
		title: `${author.name} | ${SITE_NAME}`,
		description: author.bio.slice(0, 160),
		canonical,
		navCurrent: author.category,
		footerNote: ASSIST_LINE,
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

export function renderArticle(origin: string, article: StoredArticle, latest: StoredArticle[] = []): string {
	const author = authorById(article.authorId);
	const name = author?.name ?? "Desk persona";
	const canonical = articleHref(origin, article.slug);
	const image = articleImage(origin, article)?.src ?? "";
	const title = visibleTitle(article.title);
	const dek = stripEditorialDashes(article.description);
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: categoryHref(origin, article.category), label: CATEGORY_LABEL[article.category] },
		{ label: title },
	]);
	const points = article.keyPoints.map((point) => `<li>${escapeHtml(stripEditorialDashes(point))}</li>`).join("");
	const faqs = article.faq
		.map((item) => `<h3>${escapeHtml(stripEditorialDashes(item.question))}</h3><p>${escapeHtml(stripEditorialDashes(item.answer))}</p>`)
		.join("");
	const relatedItems = article.related.length
		? `<section class="related" aria-labelledby="related-heading"><h2 id="related-heading" class="section-label">Related</h2><ul class="related-list">${article.related
			.map((item) => `<li><a href="${articleHref(origin, item.slug)}">${escapeHtml(stripEditorialDashes(item.title))}</a></li>`)
			.join("")}</ul></section>`
		: "";
	const allow = new Set<string>([
		...article.sources.map((source) => source.url),
		...article.related.map((item) => articleHref(origin, item.slug)),
	]);
	const prose = renderBodyHtml(paragraphsFromBody(article.bodyText), allow);
	const now = Date.now();
	const credit = article.imageCredit.trim();
	const hero = image
		? `<figure class="hero">${heroImg(article, image)}${credit ? `<figcaption>${escapeHtml(credit)}</figcaption>` : ""}</figure>`
		: "";
	const others = latest.filter((item) => item.slug !== article.slug).slice(0, 8);
	const minutes = readingMinutes(article.bodyText);
	const body = `<header class="story">
${trail.html}
${kickerLink(origin, article.category)}
<h1>${escapeHtml(title)}</h1>
<p class="dek">${escapeHtml(dek)}</p>
${sourceLine(article)}
${byline(origin, article, now)}
<p class="assist">${escapeHtml(ASSIST_LINE)}</p>
</header>
${hero}
<div class="article-layout">
<article class="story">
<section class="tldr" aria-labelledby="tldr"><h2 id="tldr">TL;DR</h2><ul>${points}</ul></section>
<div class="prose">${prose}</div>
<section class="faq" aria-labelledby="faq"><h2 id="faq">Questions</h2>${faqs}</section>
${relatedItems}
${shareNav(canonical, title)}
</article>
<aside class="rail">
<h2 class="section-label">Latest</h2>
${latestList(origin, others, now)}
</aside>
</div>`;
	const newsLd = {
		"@context": "https://schema.org",
		"@type": "NewsArticle",
		headline: title,
		description: article.description,
		...(image ? { image: [image] } : {}),
		datePublished: article.publishedAt,
		dateModified: article.updatedAt,
		timeRequired: `PT${minutes}M`,
		articleSection: CATEGORY_LABEL[article.category],
		keywords: article.tags.join(", "),
		author: {
			"@type": "Person",
			name,
			url: `${origin}/ai-news/about`,
			description: "Editorial persona on the 3aik news desk. Not a real person.",
		},
		creditText: ASSIST_LINE,
		disclaimer: ASSIST_LINE,
		publisher: {
			"@type": "Organization",
			name: PUBLISHER_NAME,
			url: origin,
			logo: { "@type": "ImageObject", url: `${origin}/icon-512.png` },
		},
		mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
		url: canonical,
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
		image: image || undefined,
		imageAlt: article.imageAlt,
		publishedAt: article.publishedAt,
		modifiedAt: article.updatedAt,
		section: CATEGORY_LABEL[article.category],
		tags: article.tags,
		navCurrent: article.category,
		jsonLd: [newsLd, trail.json, faqLd],
	});
}

export function renderAbout(origin: string): string {
	const canonical = `${origin}/ai-news/about`;
	const roster = AUTHORS.map((author) => `<li><span class="avatar" aria-hidden="true">${escapeHtml(authorInitials(author.name))}</span><div><a href="${authorHref(origin, author.id)}">${escapeHtml(author.name)}</a> <span>${escapeHtml(CATEGORY_LABEL[author.category])} · ${escapeHtml(author.beat)}</span><p>${escapeHtml(author.bio)}</p></div></li>`).join("");
	const trail = crumbs(origin, [
		{ href: `${origin}/`, label: "3aik" },
		{ href: `${origin}/ai-news`, label: "News" },
		{ href: canonical, label: "About" },
	]);
	const body = `${trail.html}
<article class="story">
<h1>About this desk</h1>
<p>3aik News is the news section of 3aik.com. Articles are written with AI assistance and automatically checked against source and quality rules before they are published.</p>
<h2>What the check is</h2>
<p>The automatic check is a set of desk rules applied before publishing. A draft must link at least one credible source, avoid copying that source's sentences, attribute sensitive claims, clear a length and sentence-variety bar, and avoid a list of stock phrases. The check is not a claim that a human reporter witnessed the event, and it is not a promise that the story is complete.</p>
<h2>Personas are not real people</h2>
<p>Twenty-four named author personas split the beats across AI, technology, fashion, and showbiz. Each persona has a fixed beat and a distinct voice. A bio describes that voice. It does not describe a degree, an employer, or a human career. Do not treat a persona as a real journalist.</p>
<h2>Sources and disputes</h2>
<p>Every article is built from at least one story already published by a configured outlet, then rewritten. The source is linked. Fashion and showbiz pieces repeat disputed claims only when that outlet reported them, and they attribute the claim. They do not add allegations about real people.</p>
<h2>Pictures</h2>
<p>A picture is either a generated illustration or the source outlet's own image, credited under the picture when it comes from that outlet. Generated pictures are not photographs of a real person and do not use a company logo.</p>
<p><a href="${origin}/ai-news/disclaimer">Read the disclaimer</a>.</p>
</article>
<h2 class="section-label">The roster</h2>
<ul class="roster">${roster}</ul>`;
	return renderPage({
		origin,
		title: `About | ${SITE_NAME}`,
		description: "How 3aik News uses AI assistance, automatic checks, and 24 personas who are not real people.",
		canonical,
		navCurrent: "about",
		body,
		jsonLd: [trail.json, {
			"@context": "https://schema.org",
			"@type": "AboutPage",
			name: `About ${SITE_NAME}`,
			url: canonical,
			description: "Articles are AI-assisted, automatically checked against source and quality rules, and written under personas who are not real people.",
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
<article class="story">
<h1>Disclaimer</h1>
<p>${escapeHtml(ACCURACY_DISCLAIMER)}</p>
<p>Reports can be incomplete, outdated, or wrong even when they link to a credible outlet. Read the linked source before you rely on a claim. Headlines here can be specific, and they are not supposed to state a fact the article does not support. If a headline and a source disagree, trust the source and treat this page as a brief, not as the record.</p>
<p>Articles are written with AI assistance. Named authors are editorial personas, not real people. They do not have private sources or personal knowledge of the events they describe. A persona bio is a description of a writing voice, not a credential.</p>
<p>The automatic check rejects some drafts before publishing. It looks for a real source link, copied wording, missing attribution, and a short list of writing failures. Passing the check does not make a story true.</p>
<p>Fashion and showbiz copy may mention a dispute only when a credible outlet has already reported it. The sentence should name that outlet. This desk does not add allegations of its own about real people.</p>
<p>Nothing on these pages is legal, medical, financial, or other professional advice.</p>
<p><a href="${origin}/ai-news/about">About this desk</a></p>
</article>`;
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
		body: `<article class="story"><h1>Not found</h1><p>That page is not on the news desk. <a href="${origin}/ai-news">Back to the latest stories</a>.</p></article>`,
	});
}
