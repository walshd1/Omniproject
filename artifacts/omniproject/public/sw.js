/*
 * OmniProject service worker — app-shell only.
 *
 * Policy (mirrors lib/pwa.ts isBypassed):
 *   • NEVER touch /api/*, /auth/*, /oauth* or any non-GET request — project data must
 *     never be cached at rest. Those always go straight to the network.
 *   • Navigations (HTML): network-first, falling back to the cached shell when offline,
 *     so a new deploy is picked up immediately and we never serve a stale index.html.
 *   • Static assets (Vite emits content-hashed, immutable files): stale-while-revalidate
 *     — instant from cache, refreshed in the background.
 * Bump CACHE to invalidate everything on the next visit.
 */
const CACHE = "omni-shell-v1";

self.addEventListener("install", (event) => {
  // Activate the new worker as soon as it's installed.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isBypassed(request) {
  if (request.method !== "GET") return true;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true; // third-party (fonts, etc.)
  const path = url.pathname.toLowerCase();
  return (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/auth" ||
    path.startsWith("/auth/") ||
    path.startsWith("/oauth")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (isBypassed(request)) return; // let the network handle it

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
    );
    return;
  }

  // Static assets: serve cached, refresh in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
