// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/health")) {
    return new Response(JSON.stringify({ status: "ready" }), {
      headers: { "content-type": "application/json" },
    });
  }
  if (url.endsWith("/api/chat")) {
    return new Response('data: {"response":"Hello **world**. <img src=x onerror=alert(1)>"}\n\n', {
      headers: { "content-type": "text/event-stream" },
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
    expect(document.querySelector("#active-model")?.textContent).toBe("GPT OSS 120B");
    expect(deepButton.getAttribute("aria-pressed")).toBe("true");

    document.querySelector<HTMLButtonElement>('.mobile-mode-nav [data-mode="code"]')!.click();
    expect(document.querySelector("#mode-breadcrumb")?.textContent).toBe("Code");
    expect(document.querySelector("#prompt-input")?.getAttribute("placeholder")).toMatch(/Paste code/);
  });

  it("opens settings and changes theme", () => {
    const dialog = document.querySelector<HTMLDialogElement>("#settings-dialog")!;
    document.querySelector<HTMLButtonElement>("#settings-button")!.click();
    expect(dialog.open).toBe(true);
    dialog.close();

    const before = document.documentElement.dataset.theme;
    document.querySelector<HTMLButtonElement>("#theme-toggle")!.click();
    expect(document.documentElement.dataset.theme).not.toBe(before);
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
    expect(document.querySelectorAll(".thread-item").length).toBe(1);
    expect(localStorage.getItem("3aik:history:v2")).toContain("messages");
  });
});
