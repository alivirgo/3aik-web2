import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { OpenAICompatibleClient } from "../src/index.js";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("local client lists models without contacting 3aik Cloud", async () => {
  const urls = [];
  const client = new OpenAICompatibleClient({
    baseUrl: "http://127.0.0.1:11434/v1/",
    model: "qwen-test",
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ data: [{ id: "qwen-test" }] });
    },
  });
  assert.deepEqual(await client.listModels(), [{ id: "qwen-test" }]);
  assert.deepEqual(urls, ["http://127.0.0.1:11434/v1/models"]);
  assert(!urls.some((url) => url.includes("3aik.com")));
});

test("local chat uses OpenAI-compatible streaming and optional bearer auth", async () => {
  let request;
  const client = new OpenAICompatibleClient({
    baseUrl: "http://localhost:1234/v1",
    model: "local-coder",
    apiKey: "local-key",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('data: {"choices":[{"delta":{"content":"local"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal(await client.chat({ messages: [{ role: "user", content: "hello" }] }), "local");
  assert.equal(request.url, "http://localhost:1234/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer local-key");
  assert.equal(request.options.redirect, "error");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, "local-coder");
  assert.equal(body.stream, true);
});

test("local prompt bodies are never forwarded through provider redirects", async (t) => {
  const forwardedBodies = [];
  const target = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      forwardedBodies.push(body);
      response.end("unexpected");
    });
  });
  const targetUrl = await listen(target);
  const redirector = createServer((_request, response) => {
    response.writeHead(307, { location: `${targetUrl}/capture` });
    response.end();
  });
  const redirectUrl = await listen(redirector);
  t.after(async () => {
    await Promise.all([
      new Promise((resolve) => target.close(resolve)),
      new Promise((resolve) => redirector.close(resolve)),
    ]);
  });
  const client = new OpenAICompatibleClient({ baseUrl: `${redirectUrl}/v1`, model: "local" });
  await assert.rejects(client.chat({ messages: [{ role: "user", content: "private prompt" }] }), { code: "network_error" });
  assert.deepEqual(forwardedBodies, []);
});

test("local agent consumes native tool calls and keeps execution client-side", async () => {
  let body;
  const client = new OpenAICompatibleClient({
    baseUrl: "http://localhost:8080/v1",
    model: "coder",
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({
        model: "coder",
        choices: [{ message: { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"src/a.js\"}" } }] } }],
      });
    },
  });
  const turn = await client.agentTurn({ messages: [{ role: "user", content: "inspect" }], tools: [{ type: "function", function: { name: "read_file" } }], systemPrompt: "safe" });
  assert.equal(turn.type, "tool_calls");
  assert.deepEqual(turn.calls[0].arguments, { path: "src/a.js" });
  assert.equal(body.tools[0].function.name, "read_file");
  assert.equal(body.messages[0].role, "system");
});

test("local client refuses chat when no model is selected", async () => {
  const client = new OpenAICompatibleClient({ baseUrl: "http://localhost:1234/v1", fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(client.chat({ messages: [{ role: "user", content: "hi" }] }), { code: "missing_model" });
});

test("local agent retries with the text-envelope protocol when native tools are unsupported", async () => {
  const requests = [];
  const client = new OpenAICompatibleClient({
    baseUrl: "http://localhost:8080/v1",
    model: "legacy-local",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      if (body.tools) return Response.json({ error: { message: "tools unsupported" } }, { status: 400 });
      return Response.json({ choices: [{ message: { content: "Final local answer" } }] });
    },
  });
  const turn = await client.agentTurn({ messages: [{ role: "user", content: "help" }], tools: [{ type: "function", function: { name: "read_file" } }], systemPrompt: "Use envelopes." });
  assert.equal(turn.content, "Final local answer");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].tools, undefined);
});
