export const CATEGORIES = ["ai", "technology", "fashion", "showbiz"] as const;

export type Category = (typeof CATEGORIES)[number];

export interface FaqItem {
	question: string;
	answer: string;
}

export interface ArticleDraft {
	title: string;
	description: string;
	tags: string[];
	keyPoints: string[];
	faq: FaqItem[];
	paragraphs: string[];
	imageAlt: string;
	imagePrompt: string;
}

export interface SourceRef {
	url: string;
	title: string;
	outlet: string;
	excerpt: string;
}

export interface StoryItem {
	url: string;
	title: string;
	outlet: string;
	category: Category;
	excerpt: string;
	publishedAt: string | null;
}

export interface RelatedLink {
	slug: string;
	title: string;
	href: string;
}

export interface QualityCorpusItem {
	title: string;
	bodyText: string;
	slug: string;
}

export interface StoredSource {
	url: string;
	title: string;
	outlet: string;
}

export interface StoredRelated {
	slug: string;
	title: string;
}

export interface SitemapEntry {
	slug: string;
	title: string;
	publishedAt: string;
	updatedAt: string;
}

export interface StoredArticle {
	id: string;
	slug: string;
	title: string;
	description: string;
	category: Category;
	tags: string[];
	authorId: string;
	bodyHtml: string;
	bodyText: string;
	keyPoints: string[];
	faq: FaqItem[];
	sources: StoredSource[];
	related: StoredRelated[];
	imageKey: string;
	/** Git commit that contains imageKey. Empty when the article has no picture. */
	imageCommit: string;
	imageAlt: string;
	imageType: string;
	publishedAt: string;
	updatedAt: string;
}

export interface StatSnapshot {
	count: number;
	last: string | null;
}

export interface DeskStats {
	authors: Record<string, StatSnapshot>;
	categories: Record<string, StatSnapshot>;
}

export interface AuthorPersona {
	id: string;
	name: string;
	category: Category;
	beat: string;
	voice: string;
	bio: string;
	relatedLine: (title: string, href: string) => string;
}
