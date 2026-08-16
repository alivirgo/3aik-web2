export interface Env {
	AI: Ai;
	ASSETS: Fetcher;
	CHAT_RATE_LIMITER?: RateLimit;
	IMAGE_RATE_LIMITER?: RateLimit;
	AGENT_RATE_LIMITER?: RateLimit;
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
