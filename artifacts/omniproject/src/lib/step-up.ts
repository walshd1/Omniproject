/**
 * Step-up re-authentication (client). Sensitive admin actions (key revocation,
 * governance/egress changes, the raw escape hatch) require a RECENT re-auth on top of
 * the admin role. Call stepUp() right before such an action:
 *  - demo mode confirms in place and resolves true → proceed;
 *  - OIDC mode returns a redirect URL; we navigate there (the IdP prompts for a fresh
 *    login) and resolve false → the caller stops, the action is retried after return.
 */
import { toast } from "@/hooks/use-toast";

/** Only follow a step-up redirect to a SAME-ORIGIN target. The gateway always returns a same-origin
 *  path (`/api/auth/step-up?returnTo=…`); the hop to the external IdP happens server-side. This blocks
 *  a protocol-relative `//host`, an absolute cross-origin URL, and `javascript:`/`data:` smuggled into
 *  the 409 body. Root-relative (starts with "/" but not "//") is same-origin by definition. */
function isSafeRedirect(raw: string): boolean {
  if (raw.startsWith("//")) return false;
  if (raw.startsWith("/")) return true;
  try { return new URL(raw, window.location.href).origin === window.location.origin; }
  catch { return false; }
}

export async function stepUp(returnTo: string = typeof window !== "undefined" ? window.location.pathname : "/"): Promise<boolean> {
  const res = await fetch("/api/auth/step-up", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnTo }),
  });
  if (res.ok) return true;
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    if (body.url && isSafeRedirect(body.url)) { window.location.href = body.url; return false; }
  }
  return false;
}

/** Run a sensitive mutation behind a step-up gate: re-auth first, then run `fn`. Returns
 *  `fn`'s result, or null if the step-up was declined/redirected or `fn` threw (callers that
 *  just refresh on success can ignore the result). Centralises the
 *  `if (!(await stepUp())) return; try { … } catch {}` boilerplate in admin handlers. */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!(await stepUp())) return null;
  try { return await fn(); }
  catch (err) {
    // A failed security-critical mutation (maintenance lock, key revoke, governance change) must
    // NOT be silent — previously the catch swallowed it, indistinguishable from a declined step-up.
    // Surface a destructive toast centrally so every call site gets feedback without hand-rolling it.
    toast({ title: "Action failed", description: err instanceof Error ? err.message : "The change could not be completed.", variant: "destructive" });
    return null;
  }
}

/** Did a gateway response demand a step-up (403 + code)? Lets callers retry after stepUp(). */
export async function isStepUpRequired(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try { return ((await res.clone().json()) as { code?: string }).code === "step_up_required"; }
  catch { return false; }
}
