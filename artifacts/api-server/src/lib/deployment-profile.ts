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
export type DeploymentProfile = "enterprise" | "business" | "nonprofit" | "self-hosted" | "demo";
export const DEPLOYMENT_PROFILES: readonly DeploymentProfile[] = ["enterprise", "business", "nonprofit", "self-hosted", "demo"];

type Env = Record<string, string | undefined>;
const truthy = (v?: string): boolean => !!v && v !== "0" && v.toLowerCase() !== "false";

export interface ProfilePosture {
  label: string;
  /** Does the profile assume the gateway is served over HTTPS? */
  tls: "required" | "lan-ok";
  /** Default severity of running without an IdP (demo auth = everyone admin). */
  demoAuthSeverity: "critical" | "warn" | "info";
  summary: string;
  /** What we'd recommend an operator on this profile do next. */
  recommend: string[];
}

const POSTURE: Record<DeploymentProfile, ProfilePosture> = {
  enterprise: {
    label: "Enterprise",
    tls: "required",
    demoAuthSeverity: "critical",
    summary: "Shared/regulated deployment. SSO + the full hardening surface expected.",
    recommend: ["OIDC SSO + SCIM provisioning", "KMS/BYOK for keys", "IP allowlist", "Maker-checker on sensitive actions", "Ship audit to a SIEM", "Serve over HTTPS"],
  },
  business: {
    label: "Business / SME",
    tls: "required",
    demoAuthSeverity: "critical",
    summary: "A company deployment reachable beyond a LAN. SSO + HTTPS expected; advanced hardening optional.",
    recommend: ["Configure OIDC SSO", "Serve over HTTPS", "Set SESSION_SECRET + BROKER_PSK"],
  },
  nonprofit: {
    label: "Non-profit / charity",
    tls: "lan-ok",
    demoAuthSeverity: "warn",
    summary: "Small team, often without a corporate IdP. The bundled IdP gives real accounts; HTTP on a trusted network is acceptable by choice.",
    recommend: ["Use the bundled IdP (Authentik) for staff accounts + roles", "Enable HTTPS if reachable beyond the LAN", "Set a strong SESSION_SECRET"],
  },
  "self-hosted": {
    label: "Self-hosted / homelab",
    tls: "lan-ok",
    demoAuthSeverity: "warn",
    summary: "Individual or small self-hoster on a private network. Minimal setup; HTTP-on-LAN and single-admin demo auth are accepted choices.",
    recommend: ["Set a strong SESSION_SECRET", "Use the bundled IdP if more than one person needs access", "Put a TLS reverse proxy in front for remote access"],
  },
  demo: {
    label: "Demo / evaluation",
    tls: "lan-ok",
    demoAuthSeverity: "info",
    summary: "Throwaway evaluation. No auth, sample data, nothing to protect.",
    recommend: ["Switch to a real profile before storing anything that matters"],
  },
};

/** The active deployment profile (DEPLOYMENT_PROFILE), defaulting to "business" (SME). The
 *  default preserves the historical posture: TLS + secure cookies in production. */
export function deploymentProfile(env: Env = process.env): DeploymentProfile {
  const p = env["DEPLOYMENT_PROFILE"]?.trim().toLowerCase();
  return (DEPLOYMENT_PROFILES as readonly string[]).includes(p ?? "") ? (p as DeploymentProfile) : "business";
}

/** The posture for the active profile. */
export function profilePosture(env: Env = process.env): ProfilePosture {
  return POSTURE[deploymentProfile(env)];
}

/** Has the operator explicitly accepted no-IdP demo auth (everyone admin)? */
export function acceptDemoAuth(env: Env = process.env): boolean {
  return truthy(env["ACCEPT_DEMO_AUTH"]);
}

/**
 * Should the gateway treat itself as served over TLS (secure cookies + HSTS)? An explicit
 * PUBLIC_TLS wins; otherwise "lan-ok" profiles default to HTTP, and "required" profiles to
 * "secure in production" — so the default (business) profile keeps today's behaviour exactly,
 * while a self-hoster/charity can run production-stable on plain HTTP without breaking sessions.
 */
export function requireTls(env: Env = process.env): boolean {
  const explicit = env["PUBLIC_TLS"];
  if (explicit !== undefined && explicit.trim() !== "") return truthy(explicit);
  if (profilePosture(env).tls === "lan-ok") return false;
  return env["NODE_ENV"] === "production";
}

/** The severity of the no-IdP finding for this deployment: the profile's default, or "info"
 *  once the operator explicitly accepts it (so SECURITY_STRICT won't block a deliberate choice). */
export function demoAuthSeverity(env: Env = process.env): "critical" | "warn" | "info" {
  if (acceptDemoAuth(env)) return "info";
  return profilePosture(env).demoAuthSeverity;
}
