/**
 * PWA service-worker registration.
 *
 * The worker (public/sw.js) caches ONLY the static app shell — hashed JS/CSS/icons —
 * and NEVER `/api/*` or any project data, so the stateless / zero-at-rest posture is
 * fully preserved (see public/sw.js for the matching runtime policy). This module just
 * decides whether to register and does so against the app's base path.
 */

/** Should we register a service worker in this environment? */
export function shouldRegister(env: { serviceWorker: boolean; isProd: boolean }): boolean {
  // Only in production builds, and only where the API exists. In dev the SW would
  // shadow Vite's HMR and serve stale chunks.
  return env.serviceWorker && env.isProd;
}

/** Is this request one the service worker must NEVER cache? (API + non-GET + auth.) */
export function isBypassed(url: string, method = "GET"): boolean {
  if (method.toUpperCase() !== "GET") return true;
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    return (
      path === "/api" ||
      path.startsWith("/api/") ||
      path === "/auth" ||
      path.startsWith("/auth/") ||
      path.startsWith("/oauth")
    );
  } catch {
    return true; // unparseable ⇒ be safe, don't cache
  }
}

/** Register the app-shell service worker (no-op when unsupported / in dev). */
export function registerServiceWorker(
  baseUrl: string,
  env: { serviceWorker: boolean; isProd: boolean } = {
    serviceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    isProd: import.meta.env.PROD,
  },
): void {
  if (!shouldRegister(env)) return;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  // Defer to load so registration never competes with first paint.
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* registration failed (insecure context / blocked) — the app still works online */
    });
  });
}
