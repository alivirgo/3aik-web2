#!/usr/bin/env node

import { argv } from "node:process";

const baseUrl = new URL(argv.find((value) => /^https?:\/\//.test(value)) || "https://3aik.com");
const includeImage = argv.includes("--image");
const deviceId = `smoke-${crypto.randomUUID()}`;

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: "error",
    ...init,
    headers: { "x-3aik-device": deviceId, ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${path} returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response;
}

function textFromSse(source) {
  let value = "";
  for (const line of source.replace(/\r/g, "").split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      value += event.delta || event.response || event.content || event.choices?.[0]?.delta?.content || "";
    } catch {
      // Provider heartbeats are allowed, but at least one text delta is required below.
    }
  }
  return value.trim();
}

async function checkHealth() {
  const response = await request("/api/health", { headers: { accept: "application/json" } });
  const health = await response.json();
  if (health.version !== "3.0" || health.agent?.protocol !== "client-tools-v1") {
    throw new Error(`Unexpected health contract: ${JSON.stringify(health)}`);
  }
  return `${health.service} ${health.version}`;
}

async function checkPublicSurface() {
  const homeResponse = await request("/");
  const home = await homeResponse.text();
  if (!home.includes('id="composer-form"') || !home.includes("/og.png")) {
    throw new Error("Homepage is missing the v3 workspace or social metadata.");
  }
  if (!homeResponse.headers.get("content-security-policy")?.includes("default-src 'self'")) {
    throw new Error("Homepage security headers are missing.");
  }

  const privacyResponse = await request("/privacy");
  const privacy = await privacyResponse.text();
  if (!privacy.includes("NUC7 Studios") || !privacy.includes("Delete or export your data")) {
    throw new Error("The public privacy policy is missing or incomplete.");
  }
  return "homepage + privacy policy";
}

async function checkDownloads() {
  const response = await request("/api/downloads", { headers: { accept: "application/json" } });
  const payload = await response.json();
  if (payload.source !== "github_releases" || !Number.isSafeInteger(payload.total) || payload.total < 0) {
    throw new Error(`Unexpected download counter: ${JSON.stringify(payload)}`);
  }
  return `${payload.total} verified downloads`;
}

async function checkChat(mode) {
  const response = await request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode,
      messages: [{ role: "user", content: "Reply with exactly OK." }],
      maxTokens: 32,
      temperature: 0,
    }),
  });
  const text = textFromSse(await response.text());
  if (!text) throw new Error(`${mode} returned an empty stream.`);
  return `${response.headers.get("x-3aik-model") || "unknown model"}: ${text.slice(0, 80)}`;
}

async function checkAgent() {
  const response = await request("/api/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Do not call a tool. Reply with exactly OK." }],
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file in the local workspace. This smoke test does not execute it.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      }],
      maxTokens: 64,
    }),
  });
  const body = await response.json();
  if (body.type !== "message" && body.type !== "tool_calls") throw new Error("Agent response has an invalid type.");
  return `${body.model || "unknown model"}: ${body.type}`;
}

async function checkImage() {
  const response = await request("/api/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "A small green circle centered on a clean white background" }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.headers.get("content-type")?.startsWith("image/") || bytes.length < 1_000) {
    throw new Error("Image response is missing or invalid.");
  }
  return `${response.headers.get("content-type")}, ${bytes.length} bytes`;
}

const checks = [
  ["public", checkPublicSurface],
  ["health", checkHealth],
  ["downloads", checkDownloads],
  ["chat", () => checkChat("chat")],
  ["deep", () => checkChat("deep")],
  ["code", () => checkChat("code")],
  ["agent", checkAgent],
  ...(includeImage ? [["image", checkImage]] : []),
];

console.log(`3aik production smoke · ${baseUrl.origin}`);
for (const [name, check] of checks) {
  try {
    console.log(`✓ ${name}: ${await check()}`);
  } catch (error) {
    console.error(`✗ ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) console.error("One or more smoke checks failed.");
