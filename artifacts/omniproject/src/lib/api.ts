/** Fetch + parse JSON from a same-origin API endpoint. The one place the SPA's
 *  read helper lives, so query functions don't each re-declare it. On a non-OK
 *  response it throws the server's `error` (via `responseError`) instead of trying
 *  to `.json()` an error/HTML body and surfacing an opaque parse failure. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw responseError(res, await safeJson(res));
  return res.json();
}

/** Send to a mutation endpoint (PUT by default) and parse the JSON reply. The write-side companion
 *  to `getJson`: same step-up-aware error handling, and CSRF is attached by the global fetch patch
 *  (lib/csrf). The one place the SPA's write helper lives, so mutations don't re-declare it.
 *
 *  - `body` is optional — omit it for a bodyless method (e.g. DELETE), which then sends no
 *    Content-Type/body.
 *  - Tolerates an empty / 204 reply: resolves to `undefined` instead of throwing on an empty body,
 *    so void-returning callers (`Promise<void>`) work without a bespoke helper.
 *  - `fallback` is the error message used when a failed response carries no `error` field. */
export async function sendJson<T = void>(
  url: string,
  body?: unknown,
  method: "PUT" | "PATCH" | "POST" | "DELETE" = "PUT",
  fallback?: string,
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw responseError(res, await safeJson(res), fallback);
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => undefined)) as T;
}

/** Best-effort parse of a (possibly empty/non-JSON) response body — never throws, so it's
 *  safe on an error response. The one place the `res.json().catch(() => ({}))` idiom lives. */
export async function safeJson<T = Record<string, never>>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

/** Build a step-up-aware Error from a failed response + its parsed body. Surfaces the
 *  server's `error`, but maps the `step_up_required` code to that exact message so callers
 *  can detect it and retry after a re-auth. `fallback` is the message when the body is empty. */
export function responseError(res: Response, body: { error?: string; code?: string }, fallback?: string): Error {
  if (body.code === "step_up_required") return new Error("step_up_required");
  return new Error(body.error ?? fallback ?? `Failed (${res.status})`);
}
