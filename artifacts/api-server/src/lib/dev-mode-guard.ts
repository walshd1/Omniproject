/**
 * Dev-mode production guard — the hard safety interlock that stops a developer/
 * debug instance from running where it could do harm.
 *
 * Dev mode grants dangerous powers (user impersonation, entitlement override, the
 * debug bundle, trace/capture of real data). Gating those on `NODE_ENV` alone is
 * not enough, because the operator sets `NODE_ENV` — someone could run a dev build
 * on a real box. This guard refuses to boot when dev mode is active AND the
 * environment shows PRODUCTION SIGNALS (real SSO, a licence, or a public hostname):
 * the combination that means "this is probably a real deployment".
 *
 * It is deliberately fail-closed and NOT tied to SECURITY_STRICT — dev-mode-in-prod
 * is too dangerous to be opt-in. A narrow, explicit acknowledgement
 * (`OMNI_DEV_MODE_ACK_INSECURE=1`) downgrades the refusal to a loud warning for the
 * rare legitimate case (e.g. local testing against real OIDC); it never silences it.
 */

type Env = Record<string, string | undefined>;

const set = (v: string | undefined) => !!v?.trim();

/** Dev mode computed purely from an env map (mirrors lib/dev-mode.isDevMode). */
export function devModeActive(env: Env): boolean {
  if (env["NODE_ENV"] === "production") return false;
  return env["OMNI_DEV_MODE"] === "1" || set(env["DEV_PERSIST_FILE"]) || env["BROKER_TRACE"] === "1" || set(env["BROKER_CAPTURE"]);
}

/** Does this environment look like production — literally, or via `productionSignals`? */
export function isProductionLike(env: Env): boolean {
  return env["NODE_ENV"] === "production" || productionSignals(env).length > 0;
}

/** Production signals that must not coexist with dev mode. */
export function productionSignals(env: Env): string[] {
  const signals: string[] = [];
  if (set(env["OIDC_ISSUER_URL"])) signals.push("OIDC_ISSUER_URL is set (real SSO is configured)");
  if (set(env["LICENSE_KEY"]) || set(env["LICENSE_TOKEN"])) signals.push("a licence is configured (LICENSE_KEY/LICENSE_TOKEN)");
  const pub = env["PUBLIC_URL"]?.trim();
  if (pub) {
    let host = "";
    try { host = new URL(pub).hostname.toLowerCase(); } catch { /* not a URL — ignore */ }
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local") || host.endsWith(".localhost");
    if (host && !local) signals.push(`PUBLIC_URL points at a non-local host (${host})`);
  }
  return signals;
}

export interface DevModeGuardResult {
  devMode: boolean;
  signals: string[];
  acknowledged: boolean;
  /** True when the gateway must refuse to boot. */
  refuse: boolean;
}

/** Evaluate the guard (pure). */
export function evaluateDevModeGuard(env: Env): DevModeGuardResult {
  const devMode = devModeActive(env);
  const signals = devMode ? productionSignals(env) : [];
  const acknowledged = env["OMNI_DEV_MODE_ACK_INSECURE"] === "1";
  return { devMode, signals, acknowledged, refuse: devMode && signals.length > 0 && !acknowledged };
}

export interface Logger {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}

/**
 * Boot hook: evaluate the guard, log loudly, and THROW (refuse to boot) when dev
 * mode collides with production signals. Returns the result for tests/diagnostics.
 */
export function runDevModeGuard(env: Env, logger: Logger): DevModeGuardResult {
  const r = evaluateDevModeGuard(env);
  if (!r.devMode) return r;

  if (r.refuse) {
    logger.error({ signals: r.signals }, "[dev-mode] REFUSING TO BOOT");
    throw new Error(
      "DEV MODE is active but this looks like a PRODUCTION environment (" +
        r.signals.join("; ") + "). Dev mode can impersonate users and toggle paid features, so it must not run here. " +
        "Remove the dev flags (OMNI_DEV_MODE/DEV_PERSIST_FILE/BROKER_TRACE/BROKER_CAPTURE) for a real deployment, " +
        "or, only if you understand the risk on a non-production box, set OMNI_DEV_MODE_ACK_INSECURE=1.",
    );
  }
  if (r.signals.length > 0) {
    logger.warn({ signals: r.signals }, "[dev-mode] running with production signals present — ACKNOWLEDGED via OMNI_DEV_MODE_ACK_INSECURE. This is unsafe outside local testing.");
  } else {
    logger.info({}, "[dev-mode] active — debug surfaces are armed. Never expose this instance.");
  }
  return r;
}
