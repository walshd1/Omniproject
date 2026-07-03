import { productionSignals } from "./dev-mode-guard";

/**
 * The session-cookie signing secret's boot-time guard, factored out of app.ts so the
 * decision logic is pure and unit-testable (mirrors dev-mode-guard.ts's split of
 * evaluate/throw).
 *
 * A missing/default SESSION_SECRET signs every session with this PUBLIC, hardcoded
 * string — anyone who has read this (Apache-2.0) source can forge an AES-GCM-sealed,
 * correctly-HMAC-signed session cookie for ANY sub/email/role claim, with zero
 * interaction with the real IdP: no password, no MFA, no audit trail, no rate limit.
 * `NODE_ENV === "production"` alone is not a sufficient trigger for refusing that —
 * plenty of real deployments run with NODE_ENV unset, misspelled, or set to something
 * like "staging" while still pointing at a real IdP on a public hostname. So this also
 * refuses whenever `productionSignals` sees a real-looking deployment (real SSO, a
 * licence, a public hostname), regardless of the NODE_ENV string.
 */
export const DEV_SESSION_SECRET = "omniproject-dev-secret-change-in-production";

type Env = Record<string, string | undefined>;

export interface SessionSecretResult {
  /** The secret to use IF `ok` — callers must not use `secret` when `!ok`. */
  secret: string;
  /** Whether this environment looks like a production deployment. */
  looksProduction: boolean;
  /** The production signals found (empty if NODE_ENV is literally "production" — that
   *  alone is reason enough, no signal detail needed). */
  signals: string[];
  /** False when the environment looks like production but the secret is missing/default. */
  ok: boolean;
}

/** Evaluate the guard (pure). */
export function evaluateSessionSecret(env: Env): SessionSecretResult {
  const fromEnv = env["SESSION_SECRET"]?.trim();
  const isNodeProd = env["NODE_ENV"] === "production";
  const signals = isNodeProd ? [] : productionSignals(env);
  const looksProduction = isNodeProd || signals.length > 0;
  const weak = !fromEnv || fromEnv === DEV_SESSION_SECRET;
  return { secret: fromEnv || DEV_SESSION_SECRET, looksProduction, signals, ok: !(looksProduction && weak) };
}

/** Boot hook: evaluate the guard and throw (refuse to boot) when it fails. */
export function resolveSessionSecret(env: Env = process.env): string {
  const r = evaluateSessionSecret(env);
  if (!r.ok) {
    throw new Error(
      "SESSION_SECRET must be set to a strong, non-default value" +
        (r.signals.length > 0 ? ` — this looks like a production deployment (${r.signals.join("; ")})` : " in production") +
        " (the gateway refuses to boot otherwise so sessions can't be signed with a public key).",
    );
  }
  return r.secret;
}
