import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const script = readFileSync(resolve(root, "public/chat.js"), "utf8");
const css = readFileSync(resolve(root, "public/style.css"), "utf8");
const serviceWorker = readFileSync(resolve(root, "public/sw.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "public/site.webmanifest"), "utf8"));
const privacyHtml = readFileSync(resolve(root, "public/privacy/index.html"), "utf8");

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

  it("states the local-history boundary and exposes portable clients", () => {
    expect(html).toContain("Prompts are processed by Cloudflare AI");
    expect(html).toContain("Get CLI &amp; desktop apps");
    expect(html).toContain("Ollama, LM Studio, and llama.cpp");
    expect(html).toContain("never falls back to 3aik Cloud");
    expect(html).not.toContain("prompts stay on your machine");
    expect(html).toContain("npm install --global");
    expect(html).toContain("verified GitHub release downloads");
    expect(html).toContain('id="sidebar-download-count"');
    expect(script).toContain('fetch("/api/downloads"');
    expect(script).toContain('data.source !== "github_releases"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('content="https://3aik.com/og.png"');
  });

  it("publishes a comprehensive, reachable privacy-policy document", () => {
    expect(privacyHtml).toContain("NUC7 Studios");
    expect(privacyHtml).toContain("Cloudflare Workers AI");
    expect(privacyHtml).toContain("Local-model clients");
    expect(privacyHtml).toContain("Delete or export your data");
    expect(privacyHtml).toContain("alivirgo123@live.com");
  });

  it("supports attachments, branching, and lossless workspace backups", () => {
    expect(html).toContain('id="attachment-input"');
    expect(html).toContain('id="branch-thread"');
    expect(html).toContain('id="export-workspace"');
    expect(script).toContain("buildApiMessages");
    expect(script).toContain('format: "3aik-workspace"');
    expect(script).toContain("replaceAllMedia");
    expect(script).toContain('"x-3aik-device": deviceId');
    expect(script).toContain("isSensitiveFilename");
    expect(html).not.toMatch(/accept="[^"]*\.env/i);
  });

  it("ships an installable shell without caching API responses", () => {
    expect(script).toContain('navigator.serviceWorker.register("/sw.js"');
    expect(serviceWorker).toContain('url.pathname.startsWith("/api/")');
    expect(serviceWorker).toContain('url.pathname.startsWith("/privacy/")');
    expect(serviceWorker).toContain("cache.put(new Request(new URL(fallbackPath");
    expect(serviceWorker).not.toContain("cache.put(request");
    const shellEntries = serviceWorker.match(/const SHELL_PATHS = new Set\(\[([\s\S]*?)\]\);/)?.[1];
    expect(shellEntries).not.toContain("/api/");
    expect(manifest.id).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest).not.toHaveProperty("display_override");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
    ]));
  });
});
