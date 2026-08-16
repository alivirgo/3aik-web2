// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");

async function readBrowserStore(storeName: string, requestValue: (store: IDBObjectStore) => IDBRequest) {
  const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
    const request = indexedDB.open("3aik-media-v2", 2);
    request.onsuccess = () => resolveDatabase(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise<any>((resolveValue, reject) => {
    const request = requestValue(database.transaction(storeName).objectStore(storeName));
    request.onsuccess = () => resolveValue(request.result);
    request.onerror = () => reject(request.error);
  });
}

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/health")) {
    return new Response(JSON.stringify({ status: "ready" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (url.endsWith("/api/downloads")) {
    return new Response(JSON.stringify({ total: 1234, source: "github_releases" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (url.endsWith("/api/chat")) {
    return new Response('data: {"response":"Hello **world**, *fresh emphasis*, and ~~old text~~.\\n\\n| A | B |\\n| --- | ---: |\\n| one | two |\\n\\n- [x] Safe task\\n\\n---\\n\\n<img src=x onerror=alert(1)>"}\n\n', {
      headers: { "content-type": "text/event-stream", "x-3aik-model": "@cf/meta/llama-4-scout-17b-16e-instruct" },
    });
  }
  throw new Error(`Unexpected fetch: ${url}`);
});

beforeAll(async () => {
  document.open();
  document.write(
    html
      .replace(/<link rel="stylesheet"[^>]+>/, "")
      .replace(/<script src="\/chat\.js"[^>]*><\/script>/, ""),
  );
  document.close();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "confirm", { value: vi.fn(() => true), configurable: true });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = vi.fn();
  await import("../public/chat.js");
});

describe("workspace interactions", () => {
  it("switches modes across desktop and mobile navigation", () => {
    const deepButton = document.querySelector<HTMLButtonElement>('.mode-nav [data-mode="deep"]')!;
    deepButton.click();
    expect(document.querySelector("#mode-breadcrumb")?.textContent).toBe("Deep");
    expect(document.querySelector("#active-model")?.textContent).toBe("3aik Reasoning");
    expect(deepButton.getAttribute("aria-pressed")).toBe("true");

    document.querySelector<HTMLButtonElement>('.mobile-mode-nav [data-mode="code"]')!.click();
    expect(document.querySelector("#mode-breadcrumb")?.textContent).toBe("Code");
    expect(document.querySelector("#prompt-input")?.getAttribute("placeholder")).toMatch(/Paste code/);
  });

  it("opens settings, loads verified downloads, and changes theme", async () => {
    const dialog = document.querySelector<HTMLDialogElement>("#settings-dialog")!;
    document.querySelector<HTMLButtonElement>("#settings-button")!.click();
    expect(dialog.open).toBe(true);
    dialog.close();

    const before = document.documentElement.dataset.theme;
    document.querySelector<HTMLButtonElement>("#theme-toggle")!.click();
    expect(document.documentElement.dataset.theme).not.toBe(before);
    await vi.waitFor(() => expect(document.querySelector("#download-count")?.textContent).toMatch(/1.?234/));
    expect(document.querySelector("#sidebar-download-count")?.textContent).toMatch(/1.?234 verified/);
  });

  it("offers image attachments only in the advertised Ask vision mode", async () => {
    const input = document.querySelector<HTMLInputElement>("#attachment-input")!;
    document.querySelector<HTMLButtonElement>('.mode-nav [data-mode="deep"]')!.click();
    expect(input.accept).not.toContain(".png");
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1, 2, 3])], "screenshot.png", { type: "image/png" })],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector("#toast")?.textContent).toContain("only in Ask mode"));
    expect(document.querySelector("#attachment-tray")?.hasAttribute("hidden")).toBe(true);

    document.querySelector<HTMLButtonElement>('.mode-nav [data-mode="chat"]')!.click();
    expect(input.accept).toContain(".png");
  });

  it("blocks files whose names commonly contain secrets", async () => {
    const input = document.querySelector<HTMLInputElement>("#attachment-input")!;
    Object.defineProperty(input, "files", {
      value: [
        new File(["token=do-not-send"], "credentials.json", { type: "application/json" }),
        new File(["token=do-not-send"], ".dev.vars", { type: "text/plain" }),
        new File(["key"], "id_ecdsa", { type: "text/plain" }),
        new File(["key"], "upload.jks", { type: "application/octet-stream" }),
      ],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector("#toast")?.textContent).toContain("may contain secrets"));
    expect(document.querySelector("#attachment-tray")?.hasAttribute("hidden")).toBe(true);
  });

  it("keeps no-history attachments in memory and removes persistent browser copies", async () => {
    const input = document.querySelector<HTMLInputElement>("#attachment-input")!;
    Object.defineProperty(input, "files", {
      value: [new File(["notes"], "notes.txt", { type: "text/plain" })],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector("#attachment-tray")?.hasAttribute("hidden")).toBe(false));
    await vi.waitFor(async () => expect(await readBrowserStore("media", (store) => store.count())).toBe(1));

    document.querySelector<HTMLButtonElement>("#settings-button")!.click();
    const remember = document.querySelector<HTMLInputElement>("#remember-history")!;
    remember.checked = false;
    document.querySelector<HTMLButtonElement>("#save-settings")!.click();
    await vi.waitFor(async () => {
      expect(await readBrowserStore("media", (store) => store.count())).toBe(0);
      expect(await readBrowserStore("history", (store) => store.get("workspace"))).toBeUndefined();
    });
    expect(document.querySelector("#attachment-tray")?.hasAttribute("hidden")).toBe(false);

    document.querySelector<HTMLButtonElement>(".attachment-remove")!.click();
    document.querySelector<HTMLButtonElement>("#settings-button")!.click();
    remember.checked = true;
    document.querySelector<HTMLButtonElement>("#save-settings")!.click();
    await vi.waitFor(() => expect(localStorage.getItem("3aik:preferences:v2")).toContain('"rememberHistory":true'));
  });

  it("uses a suggestion, streams a response, and never renders model HTML", async () => {
    document.querySelector<HTMLButtonElement>('.mode-nav [data-mode="chat"]')!.click();
    const suggestion = document.querySelector<HTMLButtonElement>(".suggestion-button")!;
    suggestion.click();

    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-input")!;
    expect(prompt.value.length).toBeGreaterThan(0);
    document.querySelector<HTMLFormElement>("#composer-form")!.requestSubmit();

    await vi.waitFor(() => {
      expect(document.querySelector(".message-content strong")?.textContent).toBe("world");
    });
    expect(document.querySelector(".message-content img")).toBeNull();
    expect(document.querySelector(".message-content")?.textContent).toContain("<img src=x");
    expect(document.querySelector(".message-content del")?.textContent).toBe("old text");
    expect(document.querySelector(".message-content em")?.textContent).toBe("fresh emphasis");
    expect(document.querySelector(".message-content table")?.textContent).toContain("one");
    expect(document.querySelector<HTMLInputElement>(".message-content .task-item input")?.checked).toBe(true);
    expect(document.querySelector(".message-content hr")).not.toBeNull();
    expect(document.querySelector("#actual-model")?.textContent).toContain("llama-4-scout");
    expect(document.querySelectorAll(".thread-item").length).toBe(1);
    expect(localStorage.getItem("3aik:history:v2")).toContain("messages");
  });

  it("renames and branches a completed thread", async () => {
    document.querySelector<HTMLButtonElement>("#rename-thread")!.click();
    const rename = document.querySelector<HTMLInputElement>("#rename-input")!;
    rename.value = "A better thread name";
    document.querySelector<HTMLFormElement>("#rename-form")!.requestSubmit();
    expect(document.querySelector("#thread-title")?.textContent).toBe("A better thread name");

    let branchButton: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      branchButton = [...document.querySelectorAll<HTMLButtonElement>(".message.assistant .message-action")]
        .find((button) => button.textContent?.includes("Branch here"));
      expect(branchButton).toBeTruthy();
    });
    branchButton!.click();
    await vi.waitFor(() => expect(document.querySelectorAll(".thread-item").length).toBe(2));
    expect(document.querySelector("#thread-title")?.textContent).toContain("(branch)");
  });
});
