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
const IMAGE_MODEL_ID = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

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
 * ✅ Fixed to return base64 in a stable JSON shape
 */
async function handleImageRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		const { prompt } = (await request.json()) as { prompt: string };

		if (!prompt) {
			return new Response(
				JSON.stringify({ error: "Prompt required" }),
				{ status: 400, headers: { "content-type": "application/json" } },
			);
		}

		const result = await env.AI.run(IMAGE_MODEL_ID, {
			prompt,
			width: 1024,
			height: 1024,
			num_outputs: 1,
		});

		/**
		 * Cloudflare Workers AI may return:
		 * - { image: Uint8Array }
		 * - { images: Uint8Array[] }
		 * - { result: { image: Uint8Array } }
		 */

		let base64Image: string | null = null;

		// Case 1: result.image
		if (result?.image instanceof Uint8Array) {
			base64Image = btoa(String.fromCharCode(...result.image));
		}

		// Case 2: result.images[0]
		else if (
			Array.isArray(result?.images) &&
			result.images[0] instanceof Uint8Array
		) {
			base64Image = btoa(String.fromCharCode(...result.images[0]));
		}

		// Case 3: result.result.image
		else if (result?.result?.image instanceof Uint8Array) {
			base64Image = btoa(String.fromCharCode(...result.result.image));
		}

		if (!base64Image) {
			console.error("Unexpected image result:", result);
			return new Response(
				JSON.stringify({ error: "Image generation failed" }),
				{ status: 500, headers: { "content-type": "application/json" } },
			);
		}

		// ✅ Stable, frontend-friendly response
		return new Response(
			JSON.stringify({ images: [base64Image] }),
			{ headers: { "content-type": "application/json" } },
		);
	} catch (err) {
		console.error(err);
		return new Response(
			JSON.stringify({ error: "Image generation failed" }),
			{ status: 500, headers: { "content-type": "application/json" } },
		);
	}
}