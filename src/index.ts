import type { ChatMessage, Env } from "./types";

const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
};

const MAX_BODY_BYTES = 128_000;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOTAL_MESSAGE_CHARS = 60_000;
const MAX_SYSTEM_PROMPT_CHARS = 2_000;
const MAX_MESSAGES = 24;

export const MODELS = {
	chat: {
		id: "@cf/meta/llama-4-scout-17b-16e-instruct",
		label: "Llama 4 Scout",
		description: "Fast, capable everyday assistance",
		systemPrompt:
			"You are 3aik, a practical and thoughtful AI assistant. Be accurate, direct, and useful. State uncertainty clearly. Use clean Markdown when structure helps.",
		defaultTemperature: 0.7,
	},
	deep: {
		id: "@cf/openai/gpt-oss-120b",
		label: "GPT OSS 120B",
		description: "Deeper reasoning for difficult questions",
		systemPrompt:
			"You are 3aik in deep reasoning mode. Work through difficult questions carefully, verify your assumptions, and give a concise final answer with the reasoning that is useful to the user. Never reveal hidden chain-of-thought or private scratch work.",
		defaultTemperature: 0.45,
	},
	code: {
		id: "@cf/qwen/qwen2.5-coder-32b-instruct",
		label: "Qwen 2.5 Coder 32B",
		description: "Implementation, debugging, and code review",
		systemPrompt:
			"You are 3aik in coding mode, an experienced software engineer. Prefer correct, maintainable solutions. Explain important tradeoffs, include complete code when requested, and use fenced Markdown code blocks with a language label.",
		defaultTemperature: 0.25,
	},
} as const;

export type TextMode = keyof typeof MODELS;

interface ValidChatPayload {
	messages: ChatMessage[];
	mode: TextMode;
	temperature: number;
	maxTokens: number;
	systemPrompt: string;
}

interface ValidImagePayload {
	prompt: string;
}

class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
		public code: string,
	) {
		super(message);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (url.pathname === "/api/health") {
				if (request.method !== "GET") return methodNotAllowed(["GET"]);
				return json({
					status: "ready",
					service: "3aik",
					version: "2.0",
					modes: Object.entries(MODELS).map(([id, model]) => ({
						id,
						label: model.label,
						description: model.description,
					})),
					image: { label: "FLUX.1 Schnell", available: true },
				});
			}

			if (url.pathname === "/api/chat") {
				if (request.method !== "POST") return methodNotAllowed(["POST"]);
				return await handleChat(request, env);
			}

			if (url.pathname === "/api/image") {
				if (request.method !== "POST") return methodNotAllowed(["POST"]);
				return await handleImage(request, env);
			}

			if (url.pathname.startsWith("/api/")) {
				return problem(404, "not_found", "That API route does not exist.");
			}

			const assetResponse = await env.ASSETS.fetch(request);
			return withSecurityHeaders(assetResponse);
		} catch (error) {
			if (error instanceof HttpError) {
				return problem(error.status, error.code, error.message);
			}

			console.error("[Worker] Unexpected request failure", error);
			return problem(500, "internal_error", "Something went wrong. Please try again.");
		}
	},
} satisfies ExportedHandler<Env>;

async function handleChat(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const payload = validateChatPayload(body);
	const model = MODELS[payload.mode];
	const systemPrompt = payload.systemPrompt
		? `${model.systemPrompt}\n\nAdditional instructions from the user:\n${payload.systemPrompt}`
		: model.systemPrompt;

	const messages: ChatMessage[] = [
		{ role: "system", content: systemPrompt },
		...payload.messages,
	];

	try {
		const result = await env.AI.run(model.id as keyof AiModels, {
			messages,
			stream: true,
			max_tokens: payload.maxTokens,
			temperature: payload.temperature,
		} as never);

		if (result instanceof ReadableStream) {
			return new Response(result, { headers: streamHeaders() });
		}

		if (result && typeof result === "object" && "getReader" in result) {
			return new Response(result as ReadableStream, { headers: streamHeaders() });
		}

		const content = extractText(result);
		if (!content) throw new Error("The model returned an empty response.");

		return new Response(toSse({ response: content, done: true }), {
			headers: streamHeaders(),
		});
	} catch (error) {
		console.error(`[Chat] ${payload.mode} model request failed`, error);
		return problem(
			502,
			"model_unavailable",
			"The selected model is temporarily unavailable. Try another mode in a moment.",
		);
	}
}

async function handleImage(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const { prompt } = validateImagePayload(body);

	try {
		const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
			prompt,
			steps: 4,
		});

		const bytes = await extractImageBytes(result);
		if (!bytes?.byteLength) throw new Error("The image model returned no data.");

		return new Response(bytes.buffer as ArrayBuffer, {
			headers: {
				"content-type": "image/png",
				"content-disposition": "inline; filename=3aik-image.png",
				"cache-control": "no-store",
				"x-content-type-options": "nosniff",
			},
		});
	} catch (error) {
		console.error("[Image] Generation failed", error);
		return problem(
			502,
			"image_unavailable",
			"Image generation is temporarily unavailable. Please try again shortly.",
		);
	}
}

export function validateChatPayload(input: unknown): ValidChatPayload {
	if (!isRecord(input)) {
		throw new HttpError(400, "Request body must be a JSON object.", "invalid_request");
	}

	const rawMessages = input.messages;
	if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
		throw new HttpError(400, "At least one message is required.", "invalid_messages");
	}
	if (rawMessages.length > MAX_MESSAGES) {
		throw new HttpError(400, `A maximum of ${MAX_MESSAGES} messages is supported.`, "too_many_messages");
	}

	let totalChars = 0;
	const messages: ChatMessage[] = rawMessages.map((message, index) => {
		if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant")) {
			throw new HttpError(400, `Message ${index + 1} has an invalid role.`, "invalid_message");
		}
		if (typeof message.content !== "string") {
			throw new HttpError(400, `Message ${index + 1} must contain text.`, "invalid_message");
		}

		const content = message.content.trim();
		if (!content || content.length > MAX_MESSAGE_CHARS) {
			throw new HttpError(
				400,
				`Each message must be between 1 and ${MAX_MESSAGE_CHARS.toLocaleString()} characters.`,
				"invalid_message_length",
			);
		}

		totalChars += content.length;
		return { role: message.role, content };
	});

	if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
		throw new HttpError(413, "The conversation is too large. Start a new thread and try again.", "conversation_too_large");
	}
	if (messages.at(-1)?.role !== "user") {
		throw new HttpError(400, "The final message must be from the user.", "invalid_messages");
	}

	const mode = typeof input.mode === "string" && input.mode in MODELS ? (input.mode as TextMode) : "chat";
	const temperature = clampNumber(input.temperature, MODELS[mode].defaultTemperature, 0, 1.2);
	const maxTokens = Math.round(clampNumber(input.maxTokens, 2_048, 256, 4_096));
	const systemPrompt = typeof input.systemPrompt === "string" ? input.systemPrompt.trim() : "";
	if (systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
		throw new HttpError(
			400,
			`Custom instructions cannot exceed ${MAX_SYSTEM_PROMPT_CHARS.toLocaleString()} characters.`,
			"system_prompt_too_large",
		);
	}

	return { messages, mode, temperature, maxTokens, systemPrompt };
}

export function validateImagePayload(input: unknown): ValidImagePayload {
	if (!isRecord(input) || typeof input.prompt !== "string") {
		throw new HttpError(400, "An image prompt is required.", "invalid_prompt");
	}

	const prompt = input.prompt.trim();
	if (!prompt || prompt.length > 2_000) {
		throw new HttpError(400, "Image prompts must be between 1 and 2,000 characters.", "invalid_prompt");
	}
	return { prompt };
}

async function readJson(request: Request): Promise<unknown> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		throw new HttpError(415, "Content-Type must be application/json.", "unsupported_media_type");
	}

	const contentLength = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
		throw new HttpError(413, "Request body is too large.", "payload_too_large");
	}

	try {
		return await request.json();
	} catch {
		throw new HttpError(400, "Request body contains invalid JSON.", "invalid_json");
	}
}

async function extractImageBytes(result: unknown): Promise<Uint8Array | null> {
	if (result instanceof Uint8Array) return result;
	if (result instanceof ArrayBuffer) return new Uint8Array(result);
	if (result instanceof ReadableStream) {
		return new Uint8Array(await new Response(result).arrayBuffer());
	}
	if (isRecord(result)) {
		const encoded = typeof result.image === "string" ? result.image : null;
		if (encoded) return base64ToBytes(encoded);
	}
	return null;
}

function base64ToBytes(value: string): Uint8Array {
	const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

function extractText(result: unknown): string {
	if (typeof result === "string") return result;
	if (!isRecord(result)) return "";
	if (typeof result.response === "string") return result.response;
	if (typeof result.result === "string") return result.result;
	return "";
}

function withSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("x-content-type-options", "nosniff");
	headers.set("x-frame-options", "DENY");
	headers.set("referrer-policy", "strict-origin-when-cross-origin");
	headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
	headers.set(
		"content-security-policy",
		"default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'; upgrade-insecure-requests",
	);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function streamHeaders(): HeadersInit {
	return {
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-store",
		connection: "keep-alive",
		"x-accel-buffering": "no",
		"x-content-type-options": "nosniff",
	};
}

function methodNotAllowed(allowed: string[]): Response {
	const response = problem(405, "method_not_allowed", "That method is not allowed for this route.");
	response.headers.set("allow", allowed.join(", "));
	return response;
}

function problem(status: number, code: string, message: string): Response {
	return json({ error: { code, message } }, status);
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function toSse(value: unknown): string {
	return `data: ${JSON.stringify(value)}\n\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}
