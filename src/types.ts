export interface Env {
	AI: Ai;
	ASSETS: Fetcher;
	CHAT_RATE_LIMITER?: RateLimit;
	IMAGE_RATE_LIMITER?: RateLimit;
	AGENT_RATE_LIMITER?: RateLimit;
	NUC7_STATS?: KVNamespace;
	AI_NEWS_DB?: D1Database;
	/** Fine-grained token with contents:write on alivirgo/3aik-ai-news-images. Set with `wrangler secret put`. */
	GITHUB_IMAGES_TOKEN?: string;
	AI_NEWS_ARTICLES_PER_HOUR?: string;
	AI_NEWS_PUBLISHING?: string;
	AI_NEWS_SITE_ORIGIN?: string;
	AI_NEWS_TEXT_CALLS_PER_ARTICLE?: string;
	AI_NEWS_IMAGE_CALLS_PER_ARTICLE?: string;
	AI_NEWS_MAX_FAILURES?: string;
	AI_NEWS_REJECT_TTL_HOURS?: string;
	AI_NEWS_WALL_MS?: string;
	AI_NEWS_TEXT_TIMEOUT_MS?: string;
	AI_NEWS_IMAGE_TIMEOUT_MS?: string;
	AI_NEWS_RETENTION_DAYS?: string;
	INDEXNOW_KEY?: string;
}

export interface TextContentPart {
	type: "text";
	text: string;
}

export interface ImageContentPart {
	type: "image_url";
	image_url: { url: string };
}

export type ChatContent = string | Array<TextContentPart | ImageContentPart>;

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: ChatContent;
}

export interface AgentToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface AgentMessage {
	role: "user" | "assistant" | "tool";
	content: string;
	name?: string;
	tool_call_id?: string;
	tool_calls?: AgentToolCall[];
}

export interface AgentTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}
