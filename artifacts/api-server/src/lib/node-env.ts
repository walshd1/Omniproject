/**
 * The SINGLE source of truth for "is this a production environment?".
 *
 * Dev/debug surfaces (impersonation, entitlement override, broker trace/capture,
 * stateful persistence, the debug bundle, the dev watermark) are all gated off in
 * production. Historically that decision was a bare `process.env.NODE_ENV === "production"`
 * scattered across half a dozen modules — every copy with the same two blind spots:
 *   1. Case / whitespace: `"Production"`, `"PRODUCTION"`, `" production "` are NOT
 *      `=== "production"`, so a mis-cased NODE_ENV silently reads as NON-production and
 *      could arm dev surfaces on a real box.
 *   2. Drift: N independent copies can diverge as the triggers evolve.
 *
 * This helper closes both. It is deliberately FAIL-SAFE — it answers "production"
 * for anything that isn't an EXPLICIT, recognised non-production value:
 *   - `"development"` / `"test"` (any case, trimmed)      → NOT production (dev-capable)
 *   - unset / empty                                        → NOT production (the CI / local /
 *                                                            `node --test` default; every real
 *                                                            deployment sets NODE_ENV=production
 *                                                            explicitly, so this only ever
 *                                                            affects dev/test machines)
 *   - ANY other non-empty value ("staging", "prod", a
 *     mis-cased "Production", a typo)                      → PRODUCTION (dev surfaces OFF)
 *
 * So dev mode can only activate when the environment EXPLICITLY declares development or
 * test; a staging box, a mis-cased production value, or any unknown label all fail closed.
 * The dev-mode BOOT guard (lib/dev-mode-guard.runDevModeGuard) is the second, independent
 * net for the unset case: it refuses to boot a dev-flagged instance the moment real
 * production signals (SSO / licence / public host) are present, regardless of NODE_ENV.
 */

type Env = Record<string, string | undefined>;

/** The only NODE_ENV values recognised as non-production. Everything else fails closed to prod. */
const NON_PRODUCTION_ENVS = new Set(["development", "test"]);

/**
 * True when this looks like a production environment. Fail-safe: only an explicit
 * `development`/`test` (or an unset/empty NODE_ENV — the dev/CI default) reads as
 * non-production; every other value is treated as production so dev surfaces stay off.
 */
export function isProductionEnv(env: Env = process.env): boolean {
  const raw = (env["NODE_ENV"] ?? "").trim().toLowerCase();
  if (raw === "") return false; // unset/empty — the local / CI / `node --test` default (real deploys set it)
  return !NON_PRODUCTION_ENVS.has(raw);
}
