/**
 * AI Chat + Image Application (Cloudflare Workers AI)
 *
 * Supports:
 * - Text chat via LLaMA
 * - Image generation via Stable Diffusion XL Lightning
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Models
const TEXT_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";
const IMAGE_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

// System prompt for chat
const SYSTEM_PROMPT =
	"You are a helpful, concise, and accurate assistant.";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Serve frontend
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// Text chat
		if (url.pathname === "/api/chat" && request.method === "POST") {
			return handleChatRequest(request, env);
		}

		// Image generation
		if (url.pathname === "/api/image" && request.method === "POST") {
			return handleImageRequest(request, env);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Text chat handler (LLaMA)
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		if (!messages.some((m) => m.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(TEXT_MODEL_ID, {
			messages,
			stream: true,
			max_tokens: 1024,
		});

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (err) {
		console.error(err);
		return new Response("Chat failed", { status: 500 });
	}
}

/**
 * Image generation handler (Stable Diffusion)
 */
async function handleImageRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { prompt } = (await request.json()) as {
			prompt: string;
		};

		if (!prompt) {
			return new Response("Prompt required", { status: 400 });
		}

		const result = await env.AI.run(IMAGE_MODEL_ID, {
			prompt,
			width: 1024,
			height: 1024,
			num_outputs: 1,
		});

		return new Response(JSON.stringify(result), {
			headers: { "content-type": "application/json" },
		});
	} catch (err) {
		console.error(err);
		return new Response("Image generation failed", { status: 500 });
	}
}