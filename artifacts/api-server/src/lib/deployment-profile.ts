/**
 * Deployment profile — lets a deployment declare its CONTEXT so the gateway's defaults fit it,
 * and so enterprise-grade requirements can be relaxed BY EXPLICIT CHOICE where they would
 * otherwise break a small org. The whole product is opt-in-hardened (every advanced control is
 * off by default); the profile only adjusts the couplings that would otherwise be mandatory:
 *
 *   - TLS expectation (secure cookies + HSTS): "required" profiles assume HTTPS; "lan-ok"
 *     profiles can serve plain HTTP on a LAN without breaking sessions.
 *   - The no-IdP ("demo auth — every session is admin") finding's severity: a deliberate choice
 *     for a self-hoster, a blocker for an enterprise.
 *
 * Profiles (DEPLOYMENT_PROFILE), strict → relaxed:
 *   enterprise · business (default, = SME) · nonprofit · self-hosted · demo
 *
 * Nothing here weakens a control silently: a relaxation is either the profile's stated posture
 * or an explicit acknowledgement (e.g. ACCEPT_DEMO_AUTH=1 / PUBLIC_TLS=0), and both are
 * reported on the setup/profile surface so the choice is visible and auditable.
 */
import { isProductionLike } from "./dev-mode-guard";

export type DeploymentProfile = "enterprise" | "business" | "nonprofit" | "self-hosted" | "demo";
export const DEPLOYMENT_PROFILES: readonly DeploymentProfile[] = ["enterprise", "business", "nonprofit", "self-hosted", "demo"];

type Env = Record<string, string | undefined>;
const truthy = (v?: string): boolean => !!v && v !== "0" && v.toLowerCase() !== "false";

export interface PresetEnv { key: string; value?: string; why: string }
export interface ProfilePosture {
  label: string;
  /** Who this profile is for (shown in the setup picker). */
  audience: string;
  /** Does the profile assume the gateway is served over HTTPS? */
  tls: "required" | "lan-ok";
  /** Default severity of running without an IdP (demo auth = everyone admin). */
  demoAuthSeverity: "critical" | "warn" | "info";
  summary: string;
  /** What the profile relaxes vs the strict baseline (for the picker). */
  relaxes: string[];
  /** Suggested env to set for this customer type (the preset). */
  presetEnv: PresetEnv[];
  /** What we'd recommend an operator on this profile do next. */
  recommend: string[];
}

const POSTURE: Record<DeploymentProfile, ProfilePosture> = {
  enterprise: {
    label: "Enterprise",
    audience: "Large or regulated organisation, shared deployment, compliance obligations.",
    tls: "required",
    demoAuthSeverity: "critical",
    summary: "SSO + the full hardening surface expected.",
    relaxes: [],
    presetEnv: [
      { key: "OIDC_ISSUER_URL", why: "SSO via your IdP" },
      { key: "SCIM_TOKEN", why: "user provisioning/deprovisioning" },
      { key: "KMS_PROVIDER", value: "aws|azure", why: "BYOK envelope for keys" },
      { key: "IP_ALLOWLIST", why: "restrict to your networks" },
      { key: "DUAL_CONTROL_ACTIONS", value: "key.revoke,maintenance.engage", why: "four-eyes on sensitive ops" },
      { key: "AUDIT_HTTP_URL", why: "ship the tamper-evident audit to your SIEM" },
    ],
    recommend: ["OIDC SSO + SCIM", "KMS/BYOK", "IP allowlist", "Maker-checker", "Ship audit to a SIEM", "Serve over HTTPS"],
  },
  business: {
    label: "Business / SME",
    audience: "A company deployment reachable beyond a LAN.",
    tls: "required",
    demoAuthSeverity: "critical",
    summary: "SSO + HTTPS expected; advanced hardening optional.",
    relaxes: [],
    presetEnv: [
      { key: "OIDC_ISSUER_URL", why: "SSO (Google Workspace / Entra / Authentik…)" },
      { key: "PUBLIC_TLS", value: "1", why: "serve over HTTPS" },
      { key: "SESSION_SECRET", why: "signs cookies (required in prod)" },
      { key: "BROKER_PSK", why: "authenticate the gateway↔broker hop" },
    ],
    recommend: ["Configure OIDC SSO", "Serve over HTTPS", "Set SESSION_SECRET + BROKER_PSK"],
  },
  nonprofit: {
    label: "Non-profit / charity",
    audience: "Small team, often without a corporate IdP, cost-sensitive.",
    tls: "lan-ok",
    demoAuthSeverity: "warn",
    summary: "The bundled IdP gives real accounts; HTTP on a trusted network is acceptable by choice.",
    relaxes: ["Plain HTTP on a trusted LAN", "No corporate IdP required (use the bundled one)"],
    presetEnv: [
      { key: "SESSION_SECRET", why: "signs cookies" },
      { key: "OIDC_ISSUER_URL", value: "http://authentik/…", why: "the BUNDLED IdP — real staff accounts + roles, no cloud" },
    ],
    recommend: ["Use the bundled IdP (Authentik) for staff accounts + roles", "Enable HTTPS if reachable beyond the LAN", "Set a strong SESSION_SECRET"],
  },
  "self-hosted": {
    label: "Self-hosted / homelab",
    audience: "Individual or small self-hoster on a private network.",
    tls: "lan-ok",
    demoAuthSeverity: "warn",
    summary: "Minimal setup; HTTP-on-LAN and single-admin demo auth are accepted choices.",
    relaxes: ["Plain HTTP on a LAN", "Single-admin demo auth (no SSO needed)"],
    presetEnv: [
      { key: "SESSION_SECRET", why: "signs cookies" },
    ],
    recommend: ["Set a strong SESSION_SECRET", "Use the bundled IdP if more than one person needs access", "Put a TLS reverse proxy in front for remote access"],
  },
  demo: {
    label: "Demo / evaluation",
    audience: "Throwaway evaluation. Nothing to protect.",
    tls: "lan-ok",
    demoAuthSeverity: "info",
    summary: "No auth, sample data, nothing at rest.",
    relaxes: ["Everything — no auth, no TLS, sample data"],
    presetEnv: [],
    recommend: ["Switch to a real profile before storing anything that matters"],
  },
};

const valid = (p?: string): p is DeploymentProfile => (DEPLOYMENT_PROFILES as readonly string[]).includes(p ?? "");

// The runtime profile chosen in the setup wizard + persisted in settings. When set it wins over
// the env default, so a fresh deployment can pick its context in-app. Settings pushes it here.
let runtimeOverride: DeploymentProfile | null = null;

/** Set the runtime (persisted) profile — called by the settings layer on load/change. */
export function setRuntimeProfile(p: string | null | undefined): void {
  runtimeOverride = valid(p ?? undefined) ? (p as DeploymentProfile) : null;
}

/**
 * Resolve the active profile. An EXPLICIT env object (tests / the boot security-check) is used
 * as-is; otherwise the persisted wizard choice wins, then DEPLOYMENT_PROFILE, then "business"
 * (the default preserves the historical posture: TLS + secure cookies in production).
 */
function resolve(env?: Env): DeploymentProfile {
  if (env) return valid(env["DEPLOYMENT_PROFILE"]?.trim().toLowerCase()) ? (env["DEPLOYMENT_PROFILE"]!.trim().toLowerCase() as DeploymentProfile) : "business";
  if (runtimeOverride) return runtimeOverride;
  const p = process.env["DEPLOYMENT_PROFILE"]?.trim().toLowerCase();
  return valid(p) ? (p as DeploymentProfile) : "business";
}

/** The active deployment profile. */
export function deploymentProfile(env?: Env): DeploymentProfile {
  return resolve(env);
}

/** The posture for the active profile. */
export function profilePosture(env?: Env): ProfilePosture {
  return POSTURE[resolve(env)];
}

/** Every profile's posture (the picker catalogue + per-customer-type presets). */
export function profileCatalogue(): Record<DeploymentProfile, ProfilePosture> {
  return POSTURE;
}

/** Has the operator explicitly accepted no-IdP demo auth (everyone admin)? */
export function acceptDemoAuth(env?: Env): boolean {
  return truthy((env ?? process.env)["ACCEPT_DEMO_AUTH"]);
}

/**
 * Should the gateway treat itself as served over TLS (secure cookies + HSTS)? An explicit
 * PUBLIC_TLS wins; otherwise "lan-ok" profiles default to HTTP (a deliberate, accepted posture —
 * a self-hoster/charity can run production-stable on plain HTTP without breaking sessions), and
 * "required" profiles (business/enterprise) default to true whenever this looks like a real
 * deployment.
 *
 * `NODE_ENV === "production"` alone is NOT a sufficient trigger for that last case: a "required"
 * deployment with real OIDC/SAML configured (or a licence, or a public hostname) but NODE_ENV
 * unset/misspelled/"staging" would otherwise silently serve the session + CSRF cookies WITHOUT
 * the Secure attribute — a browser will then happily send them over plain HTTP too, so any hop
 * that isn't fully HTTPS (a misconfigured proxy, a captive portal) can intercept them in the
 * clear. So this also treats `productionSignals` (the same detector `session-secret-guard.ts`
 * uses for the equivalent problem) as sufficient, regardless of the NODE_ENV string.
 */
export function requireTls(env?: Env): boolean {
  const e = env ?? process.env;
  const explicit = e["PUBLIC_TLS"];
  if (explicit !== undefined && explicit.trim() !== "") return truthy(explicit);
  if (POSTURE[resolve(env)].tls === "lan-ok") return false;
  return isProductionLike(e);
}

/** The severity of the no-IdP finding for this deployment: the profile's default, or "info"
 *  once the operator explicitly accepts it (so SECURITY_STRICT won't block a deliberate choice). */
export function demoAuthSeverity(env?: Env): "critical" | "warn" | "info" {
  if (acceptDemoAuth(env)) return "info";
  return POSTURE[resolve(env)].demoAuthSeverity;
}
