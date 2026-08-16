// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const now = Date.now();

async function readIndexedHistory() {
  const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
    const request = indexedDB.open("3aik-media-v2", 2);
    request.onsuccess = () => resolveDatabase(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise<any>((resolveRecord, reject) => {
    const request = database.transaction("history").objectStore("history").get("workspace");
    request.onsuccess = () => resolveRecord(request.result);
    request.onerror = () => reject(request.error);
  });
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
  localStorage.setItem("3aik:history:v2", JSON.stringify({
    mode: "chat",
    activeThreadId: "long-thread",
    threads: [{
      id: "long-thread",
      title: "Long conversation",
      mode: "chat",
      createdAt: now,
      updatedAt: now,
      messages: Array.from({ length: 200 }, (_, index) => ({
        id: `message-${index}`,
        role: index % 2 ? "assistant" : "user",
        kind: "text",
        content: `old ${index}`,
        createdAt: now + index,
      })),
    }],
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/health")) return Response.json({ status: "ready" });
    if (url.endsWith("/api/downloads")) return Response.json({ total: 0, source: "github_releases" });
    if (url.endsWith("/api/chat")) {
      const request = JSON.parse(String(options?.body || "{}"));
      const prompt = request.messages?.at(-1)?.content;
      if (prompt === "hold generation") {
        return await new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
        });
      }
      return new Response('data: {"response":"new answer"}\n\n', {
        headers: { "content-type": "text/event-stream", "x-3aik-model": "test-model" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  Object.defineProperty(window, "confirm", { value: vi.fn(() => true), configurable: true });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = vi.fn();
  await import("../public/chat.js");
});

describe("thread lifecycle bounds", () => {
  it("caps live conversations so a valid thread is not discarded on reload", async () => {
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input")!;
    prompt.value = "new question";
    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
    await vi.waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("3aik:history:v2")!);
      const thread = persisted.threads.find((candidate: { id: string }) => candidate.id === persisted.activeThreadId);
      expect(thread.messages.at(-1).content).toBe("new answer");
    });
    const history = JSON.parse(localStorage.getItem("3aik:history:v2")!);
    const active = history.threads.find((thread: { id: string }) => thread.id === history.activeThreadId);
    expect(active.messages.length).toBeLessThanOrEqual(200);
    expect(active.messages.at(-1).content).toBe("new answer");
    expect(active.messages.some((message: { content: string }) => message.content === "new question")).toBe(true);
  });

  it("persists through IndexedDB when localStorage quota is exceeded", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key: string, value: string) {
      if (key === "3aik:history:v2") throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });
    try {
      const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input")!;
      prompt.value = "quota fallback";
      document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
      await vi.waitFor(async () => {
        const persisted = await readIndexedHistory();
        expect(persisted.threads.find((thread: { id: string }) => thread.id === persisted.activeThreadId).messages.at(-1).content).toBe("new answer");
      });
    } finally {
      setItem.mockRestore();
    }
  });

  it("blocks destructive clear, delete, and import operations while generation is active", async () => {
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input")!;
    prompt.value = "hold generation";
    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector("#send-button")?.classList.contains("is-stopping")).toBe(true));

    const clear = document.querySelector<HTMLButtonElement>("#clear-threads")!;
    const remove = document.querySelector<HTMLButtonElement>(".thread-delete")!;
    expect(clear.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    clear.click();
    expect(document.querySelectorAll(".thread-item")).toHaveLength(1);

    const backup = new File(["{}"], "workspace.json", { type: "application/json" });
    const input = document.querySelector<HTMLInputElement>("#workspace-file")!;
    Object.defineProperty(input, "files", { value: [backup], configurable: true });
    input.dispatchEvent(new Event("change"));
    expect(document.querySelector("#toast")?.textContent).toContain("Stop generation");

    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector("#send-button")?.classList.contains("is-stopping")).toBe(false));
    expect(document.querySelectorAll(".thread-item")).toHaveLength(1);
  });
});
