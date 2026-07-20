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

/*
 * Web Push (roadmap 2.5 slice 3). The server sends an encrypted payload
 * ({title, body?, url?, tag?}); we render a notification. Clicking it focuses an
 * existing app window (or opens one) and navigates to the payload's url. Payload
 * is best-effort JSON — a push with no decipherable body still shows a fallback.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "OmniProject", body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "OmniProject";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: typeof data.url === "string" ? data.url : "/" },
    icon: "/icons/app-icon.svg",
    badge: "/icons/app-icon.svg",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        // Focus an already-open window and route it to the target.
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client && target) client.navigate(target).catch(() => {});
          return undefined;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
