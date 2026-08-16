// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const now = Date.now();

function thread(id: string, title: string, content: string, attachment = false) {
  return {
    id,
    title,
    mode: "chat",
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `${id}-message`,
      role: "user",
      kind: "text",
      content,
      createdAt: now,
      ...(attachment ? {
        attachments: [{ id: `${id}-file`, name: "notes.txt", type: "text/plain", size: 5, kind: "text" }],
      } : {}),
    }],
  };
}

beforeAll(async () => {
  document.open();
  document.write(
    html
      .replace(/<link rel="stylesheet"[^>]+>/, "")
      .replace(/<script src="\/chat\.js"[^>]*><\/script>/, ""),
  );
  document.close();
  localStorage.clear();
  localStorage.setItem("3aik:preferences:v2", JSON.stringify({
    theme: "constructor",
    systemPrompt: { injected: true },
    temperature: 999,
    maxTokens: "not-a-number",
    rememberHistory: "false",
  }));
  localStorage.setItem("3aik:history:v2", JSON.stringify({
    mode: "__proto__",
    activeThreadId: "missing-thread",
    threads: [
      thread("thread-a", "Attachment thread", "stale attachment message", true),
      thread("thread-b", "Current thread", "current message"),
      { ...thread("bad-time", "Bad timestamp", "must not render"), updatedAt: Number.MAX_VALUE },
      { ...thread("bad-mode", "Bad mode", "must not render"), mode: "constructor" },
      { ...thread("bad-text", "Oversized", "x"), messages: [{ ...thread("x", "x", "x").messages[0], content: "x".repeat(1_000_001) }] },
    ],
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ status: "ready" }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/downloads")) return new Response(JSON.stringify({ total: 0, source: "github_releases" }), { headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  Object.defineProperty(window, "confirm", { value: vi.fn(() => true), configurable: true });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = vi.fn();
  await import("../public/chat.js");
});

describe("persisted workspace hardening", () => {
  it("drops corrupt records and rejects inherited mode names without crashing startup", () => {
    expect(document.querySelector("#mode-breadcrumb")?.textContent).toBe("Ask");
    expect(document.querySelectorAll(".thread-item")).toHaveLength(2);
    expect(document.querySelector("#thread-list")?.textContent).not.toContain("Bad timestamp");
    expect(document.querySelector("#thread-list")?.textContent).not.toContain("Bad mode");
    expect(document.querySelector("#thread-list")?.textContent).not.toContain("Oversized");
    expect(document.documentElement.dataset.theme).not.toBe("constructor");
    document.querySelector<HTMLButtonElement>("#settings-button")!.click();
    expect(document.querySelector<HTMLInputElement>("#remember-history")!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#max-tokens")!.value).toBe("4096");
    document.querySelector<HTMLDialogElement>("#settings-dialog")!.close();
  });

  it("does not append a stale async user message after another thread becomes active", async () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".thread-open")];
    buttons.find((button) => button.textContent?.includes("Attachment thread"))!.click();
    buttons.find((button) => button.textContent?.includes("Current thread"))!.click();

    await vi.waitFor(() => expect(document.querySelector(".user-bubble")?.textContent).toBe("current message"));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    expect([...document.querySelectorAll(".user-bubble")].map((node) => node.textContent)).toEqual(["current message"]);
  });

  it("rejects imported threads with invalid timestamps and oversized attachment metadata", async () => {
    const invalid = thread("imported", "Imported", "hello");
    invalid.messages[0].attachments = [{
      id: "huge-file",
      name: "notes.txt",
      type: "text/plain",
      size: 512 * 1024 + 1,
      kind: "text",
    }];
    const backup = new File([JSON.stringify({
      format: "3aik-workspace",
      version: 3,
      workspace: { mode: "chat", activeThreadId: "imported", threads: [invalid], draft: { content: "", attachments: [] } },
      media: [],
    })], "invalid.json", { type: "application/json" });
    const input = document.querySelector<HTMLInputElement>("#workspace-file")!;
    Object.defineProperty(input, "files", { value: [backup], configurable: true });
    input.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(document.querySelector("#toast")?.textContent).toMatch(/invalid/i));
    expect(document.querySelector("#thread-list")?.textContent).not.toContain("Imported");
  });
});
