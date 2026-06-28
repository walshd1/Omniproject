/**
 * CSRF double-submit on the client: attach the `X-CSRF-Token` header (read from the
 * non-httpOnly `omni_csrf` cookie the gateway sets) to every same-origin mutating
 * request, so the server's csrfGuard accepts our browser-driven calls. Cross-site
 * code can neither read our cookie nor set this header, so it stays blocked.
 *
 * Installed once at bootstrap by wrapping window.fetch — no per-call-site plumbing,
 * and it covers fetches added later.
 */
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_COOKIE = "omni_csrf";

/** Read a cookie value by name from document.cookie (browser only). The name is
 *  regex-escaped so a metacharacter can't alter the match. */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${safe}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Is this request URL same-origin (so our cookie/token should ride along)? */
function isSameOrigin(url: string): boolean {
  if (url.startsWith("/")) return true; // relative → same origin
  try { return new URL(url, window.location.href).origin === window.location.origin; }
  catch { return false; }
}

/** Wrap window.fetch once to inject the CSRF token on same-origin mutations. */
export function installCsrf(): void {
  if (typeof window === "undefined" || (window as { __omniCsrf?: boolean }).__omniCsrf) return;
  (window as { __omniCsrf?: boolean }).__omniCsrf = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    if (UNSAFE.has(method) && isSameOrigin(url)) {
      const token = readCookie(CSRF_COOKIE);
      if (token) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", token);
        return original(input, { ...init, headers });
      }
    }
    return original(input, init);
  };
}
