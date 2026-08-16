import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, ThreeAikClient, parseSseStream } from "../src/index.js";

test("SSE parser supports split data fields and a final event without a blank line", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: {\"delta\":\"hel"));
      controller.enqueue(new TextEncoder().encode("lo\"}\n\ndata: [DONE]"));
      controller.close();
    },
  });
  const events = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  assert.deepEqual(events, ['{"delta":"hello"}', "[DONE]"]);
});

test("3aik chat streams deltas and sends the device header", async () => {
  let request;
  const client = new ThreeAikClient({
    apiBase: "https://example.test/",
    headers: { "x-3aik-device": "device-test-123456" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('data: {"delta":"Hello"}\n\ndata: {"response":" world"}\n\n', { headers: { "content-type": "text/event-stream" } });
    },
  });
  const content = await client.chat({ messages: [{ role: "user", content: "Hi" }] });
  assert.equal(content, "Hello world");
  assert.equal(request.url, "https://example.test/api/chat");
  assert.equal(request.options.headers["x-3aik-device"], "device-test-123456");
  assert.equal(request.options.redirect, "error");
  assert.equal(JSON.parse(request.options.body).mode, "code");
});

test("native agent calls are normalized and use /api/agent", async () => {
  const client = new ThreeAikClient({
    apiBase: "https://example.test",
    fetchImpl: async (url) => {
      assert.equal(url, "https://example.test/api/agent");
      return Response.json({ type: "tool_calls", calls: [{ id: "x", name: "read_file", arguments: { path: "x" } }], model: "test" });
    },
  });
  const turn = await client.agentTurn({ messages: [{ role: "user", content: "read" }], tools: [] });
  assert.equal(turn.calls[0].name, "read_file");
});

test("agent route falls back to the streamed code endpoint when unavailable", async () => {
  const urls = [];
  const client = new ThreeAikClient({
    apiBase: "https://example.test",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith("/api/agent")) return new Response("missing", { status: 404 });
      return new Response('data: {"response":"fallback"}\n\n', { headers: { "content-type": "text/event-stream" } });
    },
  });
  const result = await client.agentTurn({ messages: [{ role: "user", content: "hello" }], tools: [], systemPrompt: "agent" });
  assert.equal(result.content, "fallback");
  assert.equal(result.fallback, true);
  assert.deepEqual(urls, ["https://example.test/api/agent", "https://example.test/api/chat"]);
});

test("API failures expose status and server error codes", async () => {
  const client = new ThreeAikClient({
    apiBase: "https://example.test",
    fetchImpl: async () => Response.json({ error: { code: "limited", message: "Slow down" } }, { status: 429 }),
  });
  await assert.rejects(client.chat({ messages: [{ role: "user", content: "Hi" }] }), (error) => {
    assert(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "limited");
    return true;
  });
});
