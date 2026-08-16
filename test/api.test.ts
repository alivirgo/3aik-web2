import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function environment(run: (model: string, input: unknown) => unknown | Promise<unknown>) {
  return {
    AI: { run: vi.fn(run) },
    ASSETS: { fetch: vi.fn(() => new Response("asset")) },
  } as never;
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://3aik.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("worker API", () => {
  it("serves the stable Play privacy-policy route with security headers", async () => {
    const env = environment(() => ({}));
    const response = await worker.fetch(new Request("https://3aik.test/privacy"), env);
    expect(response.status).toBe(200);
    expect((env as any).ASSETS.fetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://3aik.test/privacy/index.html" }));
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("reports the v3 capability contract without claiming a live model canary", async () => {
    const response = await worker.fetch(new Request("https://3aik.test/api/health"), environment(() => ({})));
    const body = await response.json() as Record<string, any>;
    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(body.version).toBe("3.0");
    expect(body.agent.protocol).toBe("client-tools-v1");
    expect(body.image.availability).toBe("checked_on_request");
    expect(body.image.label).toBe("FLUX.2 Klein 9B");
    expect(body.image.fallback).toBe("FLUX.1 Schnell");
  });

  it("falls back to a verified chat model and identifies it", async () => {
    const env = environment(async (model) => {
      if (model.includes("kimi")) throw new Error("paid model unavailable");
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"response":"hello"}\n\n'));
          controller.close();
        },
      });
    });
    const response = await worker.fetch(jsonRequest("/api/chat", {
      messages: [{ role: "user", content: "hello" }],
      mode: "chat",
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-3aik-model")).toBe("Llama 4 Scout");
    expect(await response.text()).toContain("hello");
  });

  it("rejects images outside Ask before invoking a text-only model", async () => {
    const env = environment(() => ({ response: "should not run" }));
    const response = await worker.fetch(jsonRequest("/api/chat", {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Read this screenshot" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
        ],
      }],
      mode: "deep",
    }), env);
    expect(response.status).toBe(400);
    expect((env as any).AI.run).not.toHaveBeenCalled();
  });

  it("serves only the bytes inside an image model's typed-array view", async () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02];
    const backing = new Uint8Array([0xaa, ...png, 0xbb]);
    const env = environment(() => backing.subarray(1, backing.length - 1));
    const response = await worker.fetch(jsonRequest("/api/image", { prompt: "A green square" }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-3aik-model")).toBe("FLUX.2 Klein 9B");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(png);
  });

  it("falls back to FLUX.1 when the current partner image model is unavailable", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const env = environment((model, input) => {
      if (model.includes("flux-2")) {
        expect((input as any).multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
        throw new Error("Partner model unavailable");
      }
      return png;
    });
    const response = await worker.fetch(jsonRequest("/api/image", { prompt: "A modern city at dawn" }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-3aik-model")).toBe("FLUX.1 Schnell");
    expect((env as any).AI.run).toHaveBeenCalledTimes(2);
  });

  it("normalizes OpenAI-shaped agent tool calls without executing them", async () => {
    const env = environment(() => ({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "call_42",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"README.md"}' },
          }],
        },
      }],
    }));
    const response = await worker.fetch(jsonRequest("/api/agent", {
      messages: [{ role: "user", content: "Inspect the readme" }],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a workspace file.",
          parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      }],
    }), env);
    const body = await response.json() as Record<string, any>;
    expect(body).toMatchObject({
      type: "tool_calls",
      model: "Kimi K2.7 Code",
      calls: [{ id: "call_42", name: "read_file", arguments: '{"path":"README.md"}' }],
    });
  });

  it("returns 429 before inference when a configured limiter denies the request", async () => {
    const env = {
      ...environment(() => ({ response: "should not run" })),
      CHAT_RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
    } as never;
    const response = await worker.fetch(jsonRequest("/api/chat", {
      messages: [{ role: "user", content: "hello" }],
    }, { "x-3aik-device": "device-test-1234" }), env);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect((env as any).AI.run).not.toHaveBeenCalled();
  });

  it("enforces streamed body limits even when Content-Length is absent", async () => {
    const request = new Request("https://3aik.test/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"padding":"${"x".repeat(2_000_050)}"}`));
          controller.close();
        },
      }),
      // Node requires this for streaming request bodies; Workers ignores the extension.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await worker.fetch(request, environment(() => ({ response: "should not run" })));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "payload_too_large" } });
  });
});
