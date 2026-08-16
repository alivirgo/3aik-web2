"use strict";

const CACHE_NAME = "3aik-shell-v3";
const SHELL_PATHS = new Set([
  "/",
  "/chat.js",
  "/style.css",
  "/privacy",
  "/privacy.css",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/site.webmanifest",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([...SHELL_PATHS]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  const isNavigation = request.mode === "navigate";
  if (!isNavigation && !SHELL_PATHS.has(url.pathname)) return;

  const navigationFallback = url.pathname === "/privacy" || url.pathname.startsWith("/privacy/") ? "/privacy" : "/";
  event.respondWith(networkFirst(request, isNavigation ? navigationFallback : url.pathname));
});

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      // Normalize navigation/query variants to the finite shell allowlist so
      // crafted URLs cannot grow the local cache without bound.
      await cache.put(new Request(new URL(fallbackPath, self.location.origin)), response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(fallbackPath);
    if (cached) return cached;
    return new Response("3aik is offline and this page has not been cached yet.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}
