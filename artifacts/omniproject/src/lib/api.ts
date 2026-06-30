/** Fetch + parse JSON from a same-origin API endpoint. The one place the SPA's
 *  read helper lives, so query functions don't each re-declare it. On a non-OK
 *  response it throws the server's `error` (via `responseError`) instead of trying
 *  to `.json()` an error/HTML body and surfacing an opaque parse failure. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw responseError(res, await safeJson(res));
  return res.json();
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
