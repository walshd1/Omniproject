import { isSafeOutboundUrl } from "./url-safety";

/**
 * Validated, typed environment access — the zero-trust stance applied to configuration:
 * env vars are UNTRUSTED input too, so read them through typed accessors that enforce a rule
 * (presence, type, range, format) instead of scattering `process.env[X]` casts. `envFlag`
 * lives in lib/env; this adds the typed string/int/url/enum accessors and a boot-time check
 * of the SECURITY-CRITICAL vars so a misconfigured production deployment fails loudly, not
 * silently with a weak default.
 */

/** A trimmed string env var, or `fallback` (default undefined) when unset/empty. */
export function envStr(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : fallback;
}

/** An integer env var validated against an optional range; falls back when unset/invalid. */
export function envInt(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  if (opts.min !== undefined && n < opts.min) return fallback;
  if (opts.max !== undefined && n > opts.max) return fallback;
  return n;
}

/** One of a fixed set; falls back when unset or not in the set. */
export function envEnum<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const v = process.env[name]?.trim() as T | undefined;
  return v && (values as readonly string[]).includes(v) ? v : fallback;
}

/** An http(s) URL that passes the outbound-safety guard (no metadata/link-local), or undefined. */
export function envUrl(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && isSafeOutboundUrl(v) ? v : undefined;
}

/**
 * Validate the security-critical env at boot. Returns a list of issues (empty = OK). In
 * production, callers should treat a non-empty list as fatal. SESSION_SECRET strength is
 * ALREADY enforced (hard fail-fast) in app.ts, so it's intentionally not repeated here — this
 * covers the checks that weren't centralised, so they can't silently regress.
 */
export function checkRequiredEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const issues: string[] = [];
  const isProd = env["NODE_ENV"] === "production";
  if (!isProd) return issues; // dev/test may use defaults

  // If SCIM lifecycle is on, its bearer token must be strong (it can deprovision every user).
  const scimToken = env["SCIM_TOKEN"]?.trim();
  if (scimToken !== undefined && scimToken.length < 24) issues.push("SCIM_TOKEN must be at least 24 characters when SCIM is enabled");

  // Disabling rate limiting in production removes a key DoS/brute-force control.
  if (/^(1|true|on|yes)$/i.test(env["RATE_LIMIT_DISABLED"]?.trim() ?? "")) issues.push("RATE_LIMIT_DISABLED must not be set in production");

  return issues;
}
