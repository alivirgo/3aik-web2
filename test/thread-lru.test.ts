// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const now = Date.now();

beforeAll(async () => {
  document.open();
  document.write(
    html
      .replace(/<link rel="stylesheet"[^>]+>/, "")
      .replace(/<script src="\/chat\.js"[^>]*><\/script>/, ""),
  );
  document.close();
  localStorage.clear();
  localStorage.setItem("3aik:history:v2", JSON.stringify({
    version: 3,
    mode: "chat",
    activeThreadId: "thread-29",
    threads: Array.from({ length: 30 }, (_, index) => ({
      id: `thread-${index}`,
      title: `Thread ${index}`,
      mode: "chat",
      createdAt: now - index * 100,
      updatedAt: now - index * 100,
      messages: [{ id: `message-${index}`, role: "user", kind: "text", content: `old ${index}`, createdAt: now - index * 100 }],
    })),
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/health")) return Response.json({ status: "ready" });
    if (url.endsWith("/api/downloads")) return Response.json({ total: 0, source: "github_releases" });
    if (url.endsWith("/api/chat")) {
      return new Response('data: {"response":"answer"}\n\n', { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  Object.defineProperty(window, "confirm", { value: vi.fn(() => true), configurable: true });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = vi.fn();
  await import("../public/chat.js");
});

describe("thread LRU retention", () => {
  it("keeps a just-used old conversation when the 31st thread is created", async () => {
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input")!;
    prompt.value = "refresh oldest";
    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
    await vi.waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("3aik:history:v2")!);
      expect(persisted.threads.find((thread: { id: string }) => thread.id === "thread-29").messages.at(-1).content).toBe("answer");
    });

    document.querySelector<HTMLButtonElement>("#new-thread")!.click();
    prompt.value = "brand new";
    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
    await vi.waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("3aik:history:v2")!);
      const active = persisted.threads.find((thread: { id: string }) => thread.id === persisted.activeThreadId);
      expect(active.messages.at(-1).content).toBe("answer");
    });

    const persisted = JSON.parse(localStorage.getItem("3aik:history:v2")!);
    const ids = persisted.threads.map((thread: { id: string }) => thread.id);
    expect(persisted.threads).toHaveLength(30);
    expect(ids).toContain("thread-29");
    expect(ids).not.toContain("thread-28");
  });
});
