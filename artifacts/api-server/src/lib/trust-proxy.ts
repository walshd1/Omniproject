/**
 * How many reverse-proxy hops in front of this process to trust `X-Forwarded-*` from
 * (Express's `trust proxy` setting). Defaults to OFF (`false`) — X-Forwarded-For/-Proto/
 * -Host are otherwise just client-supplied strings, and trusting them unconditionally lets
 * a direct caller spoof `req.ip` (rate-limit/impossible-travel keying) and `req.protocol`/
 * `req.hostname` (secure-cookie detection, OAuth/OIDC redirect URIs). `TRUST_PROXY` must be
 * explicitly set — matching `.env.example`'s documented "only behind a trusted proxy" — to
 * opt in; a bare truthy value defaults to ONE hop (the common single-reverse-proxy case)
 * rather than Express's `true` (which trusts an unbounded chain of forwarded entries).
 */
export function resolveTrustProxy(raw: string | undefined): boolean | number {
  const v = raw?.trim().toLowerCase();
  if (!v || v === "0" || v === "false" || v === "off") return false;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return n; // an explicit hop count
  if (v === "1" || v === "true" || v === "on" || v === "yes") return 1;
  return false; // unrecognised ⇒ fail closed, don't silently trust
}

/** The FIRST value in a comma-separated `X-Forwarded-*` header (the chain runs
 *  furthest-hop-first, so the first entry is what the nearest trusted proxy actually saw) —
 *  trimmed, or undefined when the header is absent/empty. Only meaningful once the caller has
 *  already decided the immediate peer is a trusted proxy (see `resolveTrustProxy`); this is
 *  just the parsing, not the trust decision. */
export function firstForwardedValue(req: { headers: Record<string, unknown> }, headerName: string): string | undefined {
  const raw = req.headers[headerName];
  if (typeof raw !== "string") return undefined;
  return raw.split(",")[0]?.trim() || undefined;
}
