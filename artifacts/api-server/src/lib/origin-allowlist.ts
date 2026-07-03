/**
 * The set of origins this deployment trusts for cross-origin browser interaction — shared by
 * CORS (which cross-origin page's JS may read our responses) and, via CSRF_TRUSTED_ORIGINS, the
 * CSRF guard (which Origin/Referer a cookie-bearing mutation may announce). One shared list
 * avoids the two ever silently disagreeing about who's trusted.
 *
 * Same-origin browser calls never trigger CORS enforcement in the first place (browsers only
 * apply CORS to cross-origin requests), so an empty allowlist — the default — doesn't break the
 * common single-container/reverse-proxy deployment where the SPA and API share an origin; it
 * just means no OTHER origin's JS can read our API responses until explicitly trusted, which is
 * the secure default. `PUBLIC_URL` (this deployment's own origin) and `CORS_ALLOWED_ORIGINS` /
 * `CSRF_TRUSTED_ORIGINS` (explicit extras — e.g. a separately-hosted SPA build, a customer's own
 * dashboard) opt a deployment into cross-origin access.
 */
const normalize = (o: string): string => o.trim().replace(/\/+$/, "").toLowerCase();

export function configuredCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const out = new Set<string>();
  const pub = env["PUBLIC_URL"]?.trim();
  if (pub) out.add(normalize(pub));
  for (const raw of [env["CORS_ALLOWED_ORIGINS"], env["CSRF_TRUSTED_ORIGINS"]]) {
    for (const o of raw?.split(",") ?? []) {
      const n = normalize(o);
      if (n) out.add(n);
    }
  }
  return out;
}
