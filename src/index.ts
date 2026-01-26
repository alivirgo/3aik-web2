/**
 * AI Chat + Image Application (Cloudflare Workers AI)
 *
 * Supports:
 * - Text chat via LLaMA
 * - Image generation via Stable Diffusion XL Base 1.0
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Models
const TEXT_MODEL_ID = "@cf/openai/gpt-oss-120b";
const IMAGE_MODEL_ID = "@cf/bytedance/stable-diffusion-xl-lightning";

// System prompt for chat
const SYSTEM_PROMPT =
  "You are a helpful, concise, and accurate assistant.";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
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
  env: Env
): Promise<Response> {
  try {
    const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };

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
 * Image generation handler (Stable Diffusion XL Base 1.0)
 */
async function handleImageRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const { prompt } = (await request.json()) as { prompt: string };

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // SD XL Base image generation parameters
    const result = await env.AI.run(IMAGE_MODEL_ID, {
      prompt,
      width: 1024,
      height: 1024,
      num_outputs: 1,
      guidance_scale: 7.5,       // Optional but recommended
      num_inference_steps: 30,   // Optional but recommended
    });

    // Convert returned binary to base64
    let base64Image: string | null = null;

    if (result?.image instanceof Uint8Array) {
      base64Image = btoa(String.fromCharCode(...result.image));
    } else if (Array.isArray(result?.images) && result.images[0] instanceof Uint8Array) {
      base64Image = btoa(String.fromCharCode(...result.images[0]));
    } else if (result?.result?.image instanceof Uint8Array) {
      base64Image = btoa(String.fromCharCode(...result.result.image));
    }

    if (!base64Image) {
      console.error("Unexpected image result:", result);
      return new Response(
        JSON.stringify({ error: "Image generation failed" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // Return stable JSON
    return new Response(
      JSON.stringify({ images: [base64Image] }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}