export interface Env {
	AI: Ai;
	ASSETS: Fetcher;
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
