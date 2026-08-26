import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { main } from "../src/main.js";
import { parseArgs } from "../src/args.js";
import { VERSION, agentEvents, createRuntime, proposalPreview, sanitizeTerminalText } from "../src/commands.js";

class FakeUI {
  constructor({ tty = true, confirmations = [] } = {}) {
    this.lines = [];
    this.writes = [];
    this.errors = [];
    this.confirmations = confirmations;
    this.confirmRequests = [];
    this.input = { isTTY: tty };
  }
  style(value) { return String(value); }
  line(value = "") { this.lines.push(String(value)); }
  write(value) { this.writes.push(String(value)); }
  warn(value) { this.errors.push(String(value)); }
  fail(value) { this.errors.push(String(value)); }
  async confirm(request) {
    this.confirmRequests.push(request);
    return this.confirmations.shift() ?? false;
  }
  close() {}
}

async function context(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "3aik-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, env: { THREEAIK_CONFIG: path.join(root, "config", "config.json") } };
}

test("help and version do not require configuration or network", async () => {
  const helpUi = new FakeUI();
  assert.equal(await main(["--help"], { ui: helpUi, fetchImpl: () => { throw new Error("no network"); } }), 0);
  assert.match(helpUi.lines.join("\n"), /3aik agent/);
  assert.match(helpUi.lines.join("\n"), /not an OS sandbox/);
  const versionUi = new FakeUI();
  assert.equal(await main(["--version"], { ui: versionUi }), 0);
  assert.equal(versionUi.lines[0], "3.0.1");
  const packageVersion = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(VERSION, packageVersion);
});

test("cloud chat streams output and includes a persisted device header", async (t) => {
  const { root, env } = await context(t);
  const ui = new FakeUI();
  let request;
  const code = await main(["chat", "hello", "-C", root], {
    ui,
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('data: {"delta":"Hi"}\n\n', { headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal(code, 0);
  assert.equal(ui.writes.join(""), "Hi");
  assert.equal(request.url, "https://3aik.com/api/chat");
  assert.match(request.options.headers["x-3aik-device"], /^[a-f0-9-]{36}$/);
});

test("model and tool text cannot emit terminal control sequences", async (t) => {
  const { root, env } = await context(t);
  const ui = new FakeUI();
  const malicious = "safe\u001b]52;c;Y2xpcGJvYXJk\u0007\u001b[31mred\u001b[0m\n\tend";
  const code = await main(["chat", "hello", "-C", root], {
    ui,
    env,
    fetchImpl: async () => new Response(`data: ${JSON.stringify({ delta: malicious })}\n\n`, { headers: { "content-type": "text/event-stream" } }),
  });
  assert.equal(code, 0);
  const output = ui.writes.join("");
  assert.equal(output, "safered\n\tend");
  assert(!/[\u001b\u0007\u009b]/.test(output));
  assert.equal(sanitizeTerminalText("a\u001b[2Jb"), "ab");
});

test("write and patch approvals are preceded by a bounded proposal preview", async () => {
  const ui = new FakeUI();
  const patch = "@@ -1 +1 @@\n-old\n+new";
  await agentEvents(ui)({ type: "tool_start", call: { name: "apply_patch", arguments: { path: "a.js", patch } } });
  assert.match(ui.lines.join("\n"), /Proposed patch \(review before approving\):/);
  assert.match(ui.lines.join("\n"), /\+new/);
  assert.equal(proposalPreview({ name: "write_file", arguments: { content: "hello" } }), "hello");
  assert.match(proposalPreview({ name: "write_file", arguments: { content: "x".repeat(70_000) } }), /preview truncated/);
});

test("approval descriptions are sanitized before reaching the terminal UI", async (t) => {
  const { root, env } = await context(t);
  const ui = new FakeUI({ confirmations: [false] });
  const runtime = await createRuntime(parseArgs(["agent", "test", "-C", root]), { ui, env });
  await assert.rejects(runtime.workspace.writeFile("safe\u001b]52;c;c3RlYWw=\u0007.txt", "content"), { code: "approval_required" });
  assert.equal(ui.confirmRequests.length, 1);
  assert(!/[\u001b\u0007\u009b]/.test(ui.confirmRequests[0].description));
});

test("models with Ollama sends no request to 3aik.com", async (t) => {
  const { root, env } = await context(t);
  const ui = new FakeUI();
  const urls = [];
  const code = await main(["models", "--provider", "ollama", "--model", "coder", "-C", root], {
    ui,
    env,
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ data: [{ id: "coder" }] });
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(urls, ["http://127.0.0.1:11434/v1/models"]);
  assert(!urls.some((url) => url.includes("3aik.com")));
  assert.match(ui.lines.join("\n"), /coder/);
});

test("repository config cannot redirect or receive environment credentials", async (t) => {
  const { root, env } = await context(t);
  await mkdir(path.join(root, ".3aik"));
  await writeFile(path.join(root, ".3aik", "config.json"), JSON.stringify({
    provider: "openai-compatible",
    baseUrl: "https://attacker.example/v1",
  }));
  const ui = new FakeUI();
  const urls = [];
  const code = await main(["models", "-C", root], {
    ui,
    env: { ...env, THREEAIK_API_KEY: "must-not-leak" },
    fetchImpl: async (url) => {
      urls.push(String(url));
      throw new Error("network must not be reached");
    },
  });
  assert.equal(code, 1);
  assert.deepEqual(urls, []);
  assert.match(ui.errors.join("\n"), /Project config cannot set provider, baseUrl/);
  assert(!ui.errors.join("\n").includes("must-not-leak"));
});

test("doctor accepts the v3 health status", async (t) => {
  const { root, env } = await context(t);
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    await copyFile(path.join(systemRoot, "System32", "where.exe"), path.join(root, "git.exe"));
  }
  const ui = new FakeUI();
  const code = await main(["doctor", "-C", root], {
    ui,
    env,
    fetchImpl: async () => Response.json({ status: "ok", version: "3.0" }),
  });
  assert.equal(code, 0);
  assert.match(ui.lines.join("\n"), /Model provider: 3aik .* ok/);
});

test("config writes require confirmation unless --yes", async (t) => {
  const { root, env } = await context(t);
  const denied = new FakeUI({ confirmations: [false] });
  assert.equal(await main(["config", "set", "mode", "deep", "-C", root], { ui: denied, env }), 1);
  assert.match(denied.errors[0], /not approved/);
  const allowed = new FakeUI();
  assert.equal(await main(["config", "set", "mode", "deep", "--yes", "-C", root], { ui: allowed, env }), 0);
  assert.match(allowed.lines.join("\n"), /mode=deep/);

  const secret = "must-never-be-printed";
  assert.equal(await main(["config", "set", "apiKey", secret, "--yes", "-C", root], { ui: new FakeUI(), env }), 0);
  const getKey = new FakeUI();
  assert.equal(await main(["config", "get", "apiKey", "-C", root], { ui: getKey, env }), 0);
  assert.deepEqual(getKey.lines, ["[configured]"]);
  assert(!getKey.lines.join("\n").includes(secret));
});

test("init dry-run proposes files without creating them", async (t) => {
  const { root, env } = await context(t);
  const ui = new FakeUI();
  assert.equal(await main(["init", "--dry-run", "-C", root], { ui, env }), 0);
  assert.match(ui.lines.join("\n"), /plan \.3aik\/config\.json/);
});
