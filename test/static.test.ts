import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const script = readFileSync(resolve(root, "public/chat.js"), "utf8");
const css = readFileSync(resolve(root, "public/style.css"), "utf8");

describe("browser application contract", () => {
  it("contains every statically referenced element", () => {
    const references = [...script.matchAll(/querySelector\("#([a-z0-9-]+)"\)/g)].map((match) => match[1]);
    for (const id of new Set(references)) expect(html, `missing #${id}`).toContain(`id="${id}"`);
  });

  it("ships without third-party browser dependencies", () => {
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//i);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:\/\//i);
    expect(script).not.toContain("marked.parse");
    expect(script).not.toContain("innerHTML = message");
  });

  it("contains no common mojibake sequences", () => {
    expect(`${html}\n${script}\n${css}`).not.toMatch(/[âðÂÃ]/);
  });

  it("provides accessibility and responsive fallbacks", () => {
    expect(html).toContain("Skip to workspace");
    expect(html).toContain("aria-live=\"polite\"");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("@media (max-width: 900px)");
  });
});
