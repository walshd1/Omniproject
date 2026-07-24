/**
 * Deployment profile — lets a deployment declare its CONTEXT so the gateway's defaults fit it, and so
 * enterprise-grade requirements can be relaxed BY EXPLICIT CHOICE where they would otherwise break a small
 * org. The whole product is opt-in-hardened (every advanced control is off by default); the profile only
 * adjusts the couplings that would otherwise be mandatory:
 *
 *   - TLS expectation (secure cookies + HSTS): "required" profiles assume HTTPS; "lan-ok" profiles can serve
 *     plain HTTP on a LAN without breaking sessions.
 *   - The no-IdP ("demo auth — every session is admin") finding's severity: a deliberate choice for a
 *     self-hoster, a blocker for an enterprise.
 *
 * The profile TYPES + their postures are DATA, not code: authored as JSON under
 * lib/backend-catalogue/assets/deployment-profiles/ and read via the backend-catalogue's
 * deployment-profile-catalogue (DEPLOYMENT_PROFILE_IDS / getProfilePosture / …). So a new profile type ships
 * as an editable JSON file — no code change here. This module only carries the RUNTIME behaviour (resolve the
 * active profile from env / the wizard choice, and derive the TLS + demo-auth couplings from its posture).
 *
 * Nothing here weakens a control silently: a relaxation is either the profile's stated posture or an explicit
 * acknowledgement (e.g. ACCEPT_DEMO_AUTH=1 / PUBLIC_TLS=0), both reported on the setup/profile surface so the
 * choice is visible and auditable.
 */
import { isProductionLike } from "./dev-mode-guard";
import {
  DEPLOYMENT_PROFILE_IDS, getProfilePosture, defaultDeploymentProfile, isDeploymentProfile,
  profilePostureCatalogue, type ProfilePosture, type PresetEnv,
} from "@workspace/backend-catalogue";

export type { ProfilePosture, PresetEnv };
/** A deployment profile id — a runtime string now (the set is JSON-driven, see the catalogue). */
export type DeploymentProfile = string;
/** The shipped profile ids, in display order — sourced from the JSON catalogue (was a code constant). */
export const DEPLOYMENT_PROFILES: readonly string[] = DEPLOYMENT_PROFILE_IDS;

type Env = Record<string, string | undefined>;
const truthy = (v?: string): boolean => !!v && v !== "0" && v.toLowerCase() !== "false";

// The runtime profile chosen in the setup wizard + persisted in settings. When set it wins over the env
// default, so a fresh deployment can pick its context in-app. Settings pushes it here.
let runtimeOverride: string | null = null;

/** Set the runtime (persisted) profile — called by the settings layer on load/change. */
export function setRuntimeProfile(p: string | null | undefined): void {
  runtimeOverride = isDeploymentProfile(p) ? (p as string) : null;
}

/**
 * Resolve the active profile. An EXPLICIT env object (tests / the boot security-check) is used as-is;
 * otherwise the persisted wizard choice wins, then DEPLOYMENT_PROFILE, then the catalogue's default (which
 * preserves the historical posture: TLS + secure cookies in production).
 */
function resolve(env?: Env): string {
  if (env) {
    const p = env["DEPLOYMENT_PROFILE"]?.trim().toLowerCase();
    return isDeploymentProfile(p) ? (p as string) : defaultDeploymentProfile();
  }
  if (runtimeOverride) return runtimeOverride;
  const p = process.env["DEPLOYMENT_PROFILE"]?.trim().toLowerCase();
  return isDeploymentProfile(p) ? (p as string) : defaultDeploymentProfile();
}

/** The active deployment profile. */
export function deploymentProfile(env?: Env): DeploymentProfile {
  return resolve(env);
}

/** The posture for the active profile (always defined — `resolve` returns a shipped id or the default). */
export function profilePosture(env?: Env): ProfilePosture {
  return getProfilePosture(resolve(env))!;
}

/** Every profile's posture keyed by id (the picker catalogue + per-customer-type presets). */
export function profileCatalogue(): Record<string, ProfilePosture> {
  return profilePostureCatalogue();
}

/** Has the operator explicitly accepted no-IdP demo auth (everyone admin)? */
export function acceptDemoAuth(env?: Env): boolean {
  return truthy((env ?? process.env)["ACCEPT_DEMO_AUTH"]);
}

/**
 * Should the gateway treat itself as served over TLS (secure cookies + HSTS)? An explicit PUBLIC_TLS wins;
 * otherwise "lan-ok" profiles default to HTTP (a deliberate, accepted posture — a self-hoster/charity can run
 * production-stable on plain HTTP without breaking sessions), and "required" profiles (business/enterprise)
 * default to true whenever this looks like a real deployment.
 *
 * `NODE_ENV === "production"` alone is NOT a sufficient trigger for that last case: a "required" deployment
 * with real OIDC/SAML configured (or a licence, or a public hostname) but NODE_ENV unset/misspelled/"staging"
 * would otherwise silently serve the session + CSRF cookies WITHOUT the Secure attribute — a browser will then
 * happily send them over plain HTTP too, so any hop that isn't fully HTTPS (a misconfigured proxy, a captive
 * portal) can intercept them in the clear. So this also treats `productionSignals` (the same detector
 * `session-secret-guard.ts` uses for the equivalent problem) as sufficient, regardless of the NODE_ENV string.
 */
export function requireTls(env?: Env): boolean {
  const e = env ?? process.env;
  const explicit = e["PUBLIC_TLS"];
  if (explicit !== undefined && explicit.trim() !== "") return truthy(explicit);
  if (profilePosture(env).tls === "lan-ok") return false;
  return isProductionLike(e);
}

/** The severity of the no-IdP finding for this deployment: the profile's default, or "info" once the operator
 *  explicitly accepts it (so SECURITY_STRICT won't block a deliberate choice). */
export function demoAuthSeverity(env?: Env): "critical" | "warn" | "info" {
  if (acceptDemoAuth(env)) return "info";
  return profilePosture(env).demoAuthSeverity;
}
