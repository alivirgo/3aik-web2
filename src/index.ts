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
const IMAGE_MODEL_ID = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

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
    const aiResult = await env.AI.run(IMAGE_MODEL_ID, {
      prompt,
      width: 1024,
      height: 1024,
      num_outputs: 1,
      guidance_scale: 7.5,
      num_inference_steps: 30,
    });

    // Cast to any to handle various response shapes from different AI models
    const result = aiResult as any;

    // Helper: convert Uint8Array to base64 in chunks
    function uint8ToBase64(u8: unknown): string | null {
      if (!(u8 instanceof Uint8Array)) return null;
      const CHUNK_SIZE = 0x8000;
      let index = 0;
      let resultStr = "";
      while (index < u8.length) {
        const slice = u8.subarray(index, Math.min(index + CHUNK_SIZE, u8.length));
        resultStr += String.fromCharCode.apply(null, slice as any);
        index += CHUNK_SIZE;
      }
      return btoa(resultStr);
    }

    // Normalize many possible return shapes from Workers AI
    const images: Array<{ b64?: string }> = [];

    // Direct Uint8Array
    if (result?.image instanceof Uint8Array) images.push({ b64: uint8ToBase64(result.image) });
    if (Array.isArray(result?.images)) {
      for (const img of result.images) {
        if (img instanceof Uint8Array) images.push({ b64: uint8ToBase64(img) });
      }
    }

    // Common AI output shapes
    const maybeOutputs = result?.output || result?.outputs || result?.result || result?.outputs?.[0] || null;

    if (Array.isArray(maybeOutputs)) {
      for (const out of maybeOutputs) {
        if (typeof out?.b64_json === "string") images.push({ b64: out.b64_json });
        if (out?.image instanceof Uint8Array) images.push({ b64: uint8ToBase64(out.image) });
      }
    } else if (maybeOutputs && typeof maybeOutputs === "object") {
      if (typeof (maybeOutputs as any).b64_json === "string") images.push({ b64: (maybeOutputs as any).b64_json });
      if ((maybeOutputs as any).image instanceof Uint8Array) images.push({ b64: uint8ToBase64((maybeOutputs as any).image) });
    }

    // Fallback: if result contains base64 string fields
    if (!images.length && typeof result?.b64_json === "string") images.push({ b64: result.b64_json });

    // Validate and respond
    const valid = images.filter((i) => i?.b64);
    if (!valid.length) {
      console.error("Unexpected image result:", result);
      return new Response(
        JSON.stringify({ error: "Image generation failed" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // Return standardized JSON: images array of objects { b64, mime }
    return new Response(JSON.stringify({ images: valid.map((i) => ({ b64: i.b64, mime: "image/png" })) }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}