/**
 * Step-up re-authentication (client). Sensitive admin actions (key revocation,
 * governance/egress changes, the raw escape hatch) require a RECENT re-auth on top of
 * the admin role. Call stepUp() right before such an action:
 *  - demo mode confirms in place and resolves true → proceed;
 *  - OIDC mode returns a redirect URL; we navigate there (the IdP prompts for a fresh
 *    login) and resolve false → the caller stops, the action is retried after return.
 */
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
    if (body.url) { window.location.href = body.url; return false; }
  }
  return false;
}

/** Did a gateway response demand a step-up (403 + code)? Lets callers retry after stepUp(). */
export async function isStepUpRequired(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try { return ((await res.clone().json()) as { code?: string }).code === "step_up_required"; }
  catch { return false; }
}
