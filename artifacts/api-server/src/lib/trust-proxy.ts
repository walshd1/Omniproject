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
import { isTruthy } from "./env-config";

/** Resolve `TRUST_PROXY` to Express's `trust proxy` value: `false` (default/off), an explicit
 *  positive hop count, or `1` for a bare truthy value — never Express's unbounded `true`. */
export function resolveTrustProxy(raw: string | undefined): boolean | number {
  const v = raw?.trim().toLowerCase();
  if (!v || v === "0" || v === "false" || v === "off") return false;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return n; // an explicit hop count
  if (isTruthy(v)) return 1;
  return false; // unrecognised ⇒ fail closed, don't silently trust
}

/** The FIRST value in a comma-separated `X-Forwarded-*` header — trimmed, or undefined when absent/empty.
 *  For `X-Forwarded-Proto`/`-Host` the first entry is the ORIGINAL client's value (what secure-cookie and
 *  redirect-URI logic want). Do NOT use this for `X-Forwarded-For` client-IP selection: XFF is client-first
 *  and each proxy APPENDS, so the leftmost entry is fully attacker-controlled — use `forwardedForChain`
 *  with the trusted-hop count instead (see `clientIp`). */
export function firstForwardedValue(req: { headers: Record<string, unknown> }, headerName: string): string | undefined {
  const raw = req.headers[headerName];
  if (typeof raw !== "string") return undefined;
  return raw.split(",")[0]?.trim() || undefined;
}

/** All entries of a comma-separated `X-Forwarded-*` header, left-to-right, trimmed, empties dropped.
 *  For `X-Forwarded-For` the list is client-first: index 0 is what the client claimed and each proxy
 *  appended the peer it actually saw, so with N trusted hops the trustworthy address is the Nth from the
 *  right (`chain[chain.length - N]`). */
export function forwardedForChain(req: { headers: Record<string, unknown> }, headerName: string): string[] {
  const raw = req.headers[headerName];
  if (typeof raw !== "string") return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}
