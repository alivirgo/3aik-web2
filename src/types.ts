export interface Env {
	AI: Ai;
	ASSETS: Fetcher;
	CHAT_RATE_LIMITER?: RateLimit;
	IMAGE_RATE_LIMITER?: RateLimit;
	AGENT_RATE_LIMITER?: RateLimit;
	/** Per-client news stats lanes. `namespace_id` 3104. Approximate, and per location. */
	NEWS_STATS_RATE_LIMITER?: RateLimit;
	/** SQLite Durable Object. Global cap of 25,000 D1 stats row writes per UTC day. */
	NEWS_STATS_BUDGET?: DurableObjectNamespace;
	/** Raw reader events. Write-only on the Free plan. */
	AI_NEWS_EVENTS?: AnalyticsEngineDataset;
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
	/** `workers-ai` or `off`. Missing means off, so the cron does not spend neurons. */
	AI_NEWS_GENERATOR?: string;
	/** Bearer secret for /ai-news/api/ingest. It does not authorize /ai-news/api/stats. */
	AI_NEWS_INGEST_TOKEN?: string;
	/** Optional SHA-256 hex override for the stats bearer. The bearer is not stored. */
	AI_NEWS_STATS_TOKEN_SHA256?: string;
	/** `false` stops collect writes and hides the stats desk. Default `true`. */
	AI_NEWS_STATS_ENABLED?: string;
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
