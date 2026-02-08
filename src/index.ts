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
// Models
const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const POLLINATIONS_API_KEY = "pk_smed4cvxkQtCxNFz";

const ALLOWED_TEXT_MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/openai/gpt-oss-120b",
  "@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/qwen/qwq-32b-preview",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "pollinations-chat",
  "pollinations-code"
];

const ALLOWED_IMAGE_MODELS = [
  "@cf/black-forest-labs/flux-1-schnell",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
  "@cf/leonardoai/phoenix-1.0",
  "@cf/stabilityai/stable-diffusion-3-large-turbo",
  "@cf/bytedance/sdxl-lightning",
  "pollinations-flux",
  "pollinations-any",
  "pollinations-dream",
  "pollinations-pixart",
  "pollinations-portrait",
  "video-seedance",
  "video-veo",
  "video-grok-video",
  "gif-animate"
];

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
 * Text chat handler (LLaMA with streaming)
 */
async function handleChatRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const {
      messages = [],
      model = DEFAULT_TEXT_MODEL,
      temperature = 0.7,
      max_tokens = 1024,
      systemPrompt = ""
    } = (await request.json()) as {
      messages: ChatMessage[],
      model?: string,
      temperature?: number,
      max_tokens?: number,
      systemPrompt?: string
    };

    // Safety check for model ID
    const modelToUse = ALLOWED_TEXT_MODELS.includes(model) ? model : DEFAULT_TEXT_MODEL;

    // Sanitize messages: only keep role and content to prevent token bloating from metadata
    const sanitizedMessages = messages.map(m => ({
      role: m.role,
      content: m.content || ""
    }));

    if (!sanitizedMessages.some((m) => m.role === "system")) {
      sanitizedMessages.unshift({ role: "system", content: systemPrompt || SYSTEM_PROMPT });
    }

    console.log(`[Chat] Request: model=${modelToUse}, temp=${temperature}, tokens=${max_tokens} | History count: ${sanitizedMessages.length}`);

    // Pollinations Chat Logic
    if (modelToUse.startsWith("pollinations-")) {
      const pModel = modelToUse === "pollinations-code" ? "qwen-coder" : "openai";
      const pRes = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${POLLINATIONS_API_KEY}`
        },
        body: JSON.stringify({
          messages: sanitizedMessages,
          stream: true,
          model: pModel
        })
      });

      if (!pRes.ok) throw new Error(`Pollinations API failed: ${pRes.status} ${pRes.statusText}`);

      return new Response(pRes.body, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    let stream: any;
    try {
      // Validate/Sanitize Params
      const safeTemp = Math.max(0, Math.min(1, temperature));
      const safeTokens = Math.max(1, Math.min(4000, max_tokens));

      stream = await env.AI.run(modelToUse as any, {
        messages: sanitizedMessages,
        stream: true,
        max_tokens: safeTokens,
        temperature: safeTemp,
      });
    } catch (apiErr: any) {
      console.error(`[Chat] Cloudflare AI.run failed for ${modelToUse}:`, apiErr);
      throw new Error(`AI Model Error (${modelToUse}): ${apiErr.message || "Unknown error"}`);
    }

    // Handle both ReadableStream and direct return
    let responseStream = stream;
    if (stream instanceof ReadableStream) {
      console.log("[Chat] Result is ReadableStream");
      responseStream = stream;
    } else if (stream && typeof stream === "object" && "getReader" in stream) {
      console.log("[Chat] Result has getReader method");
      responseStream = stream as ReadableStream;
    } else {
      console.log("[Chat] Result type:", typeof stream);
      // If not a stream, wrap it
      responseStream = new ReadableStream({
        start(controller) {
          if (typeof stream === "string") {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: stream })}\n\n`));
          } else {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(stream)}\n\n`));
          }
          controller.close();
        },
      });
    }

    return new Response(responseStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[Chat] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}

/**
 * Image generation handler (Multiple models with fallback)
 */
async function handleImageRequest(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const { prompt, model = DEFAULT_IMAGE_MODEL, width = 1024, height = 1024 } = (await request.json()) as {
      prompt: string,
      model?: string,
      width?: number,
      height?: number
    };

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const modelToUse = ALLOWED_IMAGE_MODELS.includes(model) ? model : DEFAULT_IMAGE_MODEL;
    console.log(`[Image Gen] Prompt: "${prompt}" | Model: ${modelToUse}`);

    // Pollinations / Video / GIF Logic - Optimized to return URL directly
    if (modelToUse.startsWith("pollinations-") || modelToUse.startsWith("video-") || modelToUse.startsWith("gif-")) {
      const seed = Math.floor(Math.random() * 10000000);
      let pUrl = "";

      if (modelToUse.startsWith("pollinations-")) {
        const pModel = modelToUse.split("-")[1];
        pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${pModel}&nologo=true&enhance=true&seed=${seed}&key=${POLLINATIONS_API_KEY}`;
      } else if (modelToUse.startsWith("video-")) {
        const pModel = modelToUse.split("-")[1];
        pUrl = `https://gen.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${pModel}&seed=${seed}&key=${POLLINATIONS_API_KEY}`;
      } else if (modelToUse.startsWith("gif-")) {
        pUrl = `https://gen.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=animate&seed=${seed}&key=${POLLINATIONS_API_KEY}`;
      }

      console.log(`[Media Gen] Returning direct URL with key: ${pUrl}`);

      let mime = "image/png";
      if (modelToUse.startsWith("video-")) mime = "video/mp4";
      if (modelToUse.startsWith("gif-")) mime = "image/gif";

      return new Response(JSON.stringify({ images: [{ url: pUrl, mime }] }), {
        headers: { "content-type": "application/json" },
      });
    }

    let lastError: Error | null = null;
    let result: any = null;
    let usedModel = modelToUse;

    try {
      result = await env.AI.run(modelToUse as any, { prompt, width, height });
    } catch (err) {
      console.warn(`[Image Gen] Model ${modelToUse} failed, falling back...`);
      lastError = err as Error;
      // Filter out pollinations models for CF fallback
      const cfFallbacks = ALLOWED_IMAGE_MODELS.filter(m => !m.startsWith("pollinations-"));

      for (const fallbackModel of cfFallbacks) {
        if (fallbackModel === modelToUse) continue;
        try {
          console.log(`[Image Gen] Trying fallback: ${fallbackModel}`);
          result = await env.AI.run(fallbackModel as any, { prompt, width, height });
          usedModel = fallbackModel;
          break;
        } catch (fErr) {
          console.warn(`[Image Gen] ${fallbackModel} failed`);
        }
      }
    }

    if (!result) {
      throw new Error(`All models failed. Last error: ${lastError?.message || "unknown"}`);
    }

    let b64: string | undefined;

    // Detection logic
    if (result instanceof Uint8Array) {
      b64 = u8ToBase64(result);
    } else if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((acc, c) => acc + c.length, 0);
      const combined = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }
      b64 = u8ToBase64(combined);
    } else if (typeof result === "object") {
      const data = result.image || result.images?.[0] || result.output || result.result;
      if (data instanceof Uint8Array) {
        b64 = u8ToBase64(data);
      } else if (typeof data === "string") {
        b64 = data.includes(",") ? data.split(",")[1] : data;
      } else if (data && typeof data === "object" && (data.b64 || data.b64_json)) {
        b64 = data.b64 || data.b64_json;
      } else if (typeof result.b64_json === "string") {
        b64 = result.b64_json;
      }
    }

    if (b64) {
      return new Response(JSON.stringify({ images: [{ b64, mime: "image/png" }] }), {
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Failed to extract image data from ${usedModel} response.`);
  } catch (err) {
    console.error("[Image Gen] Error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

/**
 * Utility: Convert Uint8Array to Base64 efficiently
 */
function u8ToBase64(u8: any): string | undefined {
  if (!u8) return undefined;
  const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  // Use TextDecoder with latin1 for near-native performance binary conversion
  const decoder = new TextDecoder('latin1');
  const binary = decoder.decode(bytes);
  return btoa(binary);
}
