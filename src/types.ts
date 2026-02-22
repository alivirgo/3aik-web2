/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
	/**
	 * Binding for the Workers AI API.
	 */
	AI: Ai;

	/**
	 * Binding for static assets.
	 */
	ASSETS: { fetch: (request: Request) => Promise<Response> };

	/**
	 * Binding for visitor statistics KV.
	 */
	NUC7_STATS: KVNamespace;

	/**
	 * URL of the private vault bridge worker.
	 */
	VAULT_URL: string;

	/**
	 * Token to authorize requests to the vault bridge.
	 */
	INTERNAL_BRIDGE_TOKEN: string;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}
