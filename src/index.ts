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
// Try multiple image models (some may not be available in all accounts)
const IMAGE_MODELS = [
  "@cf/stabilityai/stable-diffusion-3-large-turbo",
  "@cf/black-forest-labs/flux-1-schnell",
  "@cf/stabilityai/stable-diffusion-xl-base-1.0",
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
    const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };

    if (!messages.some((m) => m.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    console.log(`[Chat] Streaming text response for ${messages.length} messages`);

    const stream = await env.AI.run(TEXT_MODEL_ID, {
      messages,
      stream: true,
      max_tokens: 1024,
    });

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
    const { prompt } = (await request.json()) as { prompt: string };

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    console.log(`[Image Gen] Starting generation with prompt: "${prompt}"`);

    let lastError: Error | null = null;
    let result: any = null;
    let usedModel = "";

    // Try each image model until one succeeds
    for (const modelId of IMAGE_MODELS) {
      try {
        console.log(`[Image Gen] Trying model: ${modelId}`);
        const aiResult = await env.AI.run(modelId, {
          prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1,
          guidance_scale: 7.5,
          num_inference_steps: 30,
        });
        console.log(`[Image Gen] ${modelId} success!`);
        result = aiResult;
        usedModel = modelId;
        lastError = null;
        break;
      } catch (err) {
        console.warn(`[Image Gen] ${modelId} failed:`, err);
        lastError = err as Error;
        continue;
      }
    }

    if (!result) {
      throw new Error(
        `All image models failed. Last error: ${lastError?.message || "unknown error"}`
      );
    }

    console.log(`[Image Gen] Used model: ${usedModel}`);
    console.log(`[Image Gen] Response type:`, typeof result);
    console.log(`[Image Gen] Response is ReadableStream:`, result instanceof ReadableStream);
    
    // Helper: convert Uint8Array to base64 in chunks
    function uint8ToBase64(u8: unknown): string | undefined {
      if (!(u8 instanceof Uint8Array)) return undefined;
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

    // Handle ReadableStream response (some models stream the response)
    if (result instanceof ReadableStream) {
      console.log("[Image Gen] Converting ReadableStream to Uint8Array");
      const chunks: Uint8Array[] = [];
      const reader = result.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const buffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }
      const b64 = uint8ToBase64(buffer);
      if (b64) {
        return new Response(
          JSON.stringify({ images: [{ b64, mime: "image/png" }] }),
          { headers: { "content-type": "application/json" } }
        );
      }
    }

    // Normalize many possible return shapes from Workers AI
    const images: Array<{ b64?: string }> = [];

    // Direct Uint8Array
    if (result?.image instanceof Uint8Array) {
      const b64 = uint8ToBase64(result.image);
      if (b64) images.push({ b64 });
    }
    
    // Array of images
    if (Array.isArray(result?.images)) {
      for (const img of result.images) {
        if (img instanceof Uint8Array) {
          const b64 = uint8ToBase64(img);
          if (b64) images.push({ b64 });
        }
      }
    }

    // Alternative output formats
    const maybeOutputs =
      result?.output || result?.outputs || result?.result || result?.outputs?.[0] || null;

    if (Array.isArray(maybeOutputs)) {
      for (const out of maybeOutputs) {
        if (typeof out?.b64_json === "string") images.push({ b64: out.b64_json });
        if (out?.image instanceof Uint8Array) {
          const b64 = uint8ToBase64(out.image);
          if (b64) images.push({ b64 });
        }
      }
    } else if (maybeOutputs && typeof maybeOutputs === "object") {
      if (typeof (maybeOutputs as any).b64_json === "string")
        images.push({ b64: (maybeOutputs as any).b64_json });
      if ((maybeOutputs as any).image instanceof Uint8Array) {
        const b64 = uint8ToBase64((maybeOutputs as any).image);
        if (b64) images.push({ b64 });
      }
    }

    // Fallback: if result contains base64 string fields
    if (
      !images.length &&
      typeof result?.b64_json === "string"
    )
      images.push({ b64: result.b64_json });

    // Validate and respond
    const valid = images.filter((i) => i?.b64);

    console.log(`[Image Gen] Found ${valid.length} valid images`);

    if (!valid.length) {
      console.error("[Image Gen] No valid image data found. Result structure:", {
        hasImage: !!result?.image,
        hasImages: !!result?.images,
        hasOutput: !!result?.output,
        hasOutputs: !!result?.outputs,
        hasResult: !!result?.result,
        hasB64json: !!result?.b64_json,
        resultKeys: Object.keys(result || {}),
      });
      return new Response(
        JSON.stringify({
          error: "Image generation returned no valid data",
          hint: "Check if the model is available in your Cloudflare account",
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    console.log(`[Image Gen] Success - returning ${valid.length} image(s)`);

    // Return standardized JSON
    return new Response(
      JSON.stringify({ images: valid.map((i) => ({ b64: i.b64, mime: "image/png" })) }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error("[Image Gen] Critical error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}