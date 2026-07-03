import { useQuery } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";

/**
 * Deployment-profile client. Reports the chosen profile (enterprise … self-hosted), what's
 * been relaxed by choice (TLS, demo auth), and which advanced hardening is on vs off — so an
 * admin can see, at a glance, that their small-org deployment is intentionally relaxed and what
 * they'd turn on to harden it.
 */
export interface PresetEnv { key: string; value?: string; why: string }
export interface ProfilePosture {
  label: string;
  audience: string;
  tls: "required" | "lan-ok";
  demoAuthSeverity: "critical" | "warn" | "info";
  summary: string;
  relaxes: string[];
  presetEnv: PresetEnv[];
  recommend: string[];
}

export interface DeploymentProfileView {
  profile: string;
  posture: ProfilePosture;
  tls: { servedOverTls: boolean };
  demoAuth: { active: boolean; accepted: boolean; severity: "critical" | "warn" | "info" };
  hardening: {
    oidc: boolean; scim: boolean; ipAllowlist: boolean; sessionCap: boolean;
    kms: boolean; makerChecker: boolean; securityStrict: boolean; rateLimit: boolean;
    strongMfaAdminPmo: boolean;
  };
  profiles: string[];
  /** Every customer type's posture + preset (for the wizard picker). */
  catalogue?: Record<string, ProfilePosture>;
}

/** The deployment profile + posture + the picker catalogue + which hardening is engaged (admin). */
export function useDeploymentProfile() {
  return useQuery<DeploymentProfileView>({
    queryKey: ["deployment-profile"],
    queryFn: () => getJson("/api/setup/profile"),
    staleTime: 60_000,
  });
}

/** Choose the deployment profile in the setup wizard (admin). Persists it. */
export async function setDeploymentProfile(profile: string): Promise<void> {
  const res = await fetch("/api/setup/profile", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) {
    throw responseError(res, await safeJson(res));
  }
}

/** The result of applying the "We're a charity" one-click preset — what changed, so the
 *  wizard can show a plain-English confirmation instead of a silent success. */
export interface CharityOnboardingResult {
  profile: string;
  posture: ProfilePosture;
  dashboardsAdded: { id: string; name: string }[];
  nomenclature: { applied: boolean; backendId: string | null; reason: string };
}

/** Apply the "We're a charity" one-click onboarding preset (admin): selects the nonprofit
 *  deployment profile, mints the trustee-report + funder-report dashboards, and best-effort
 *  adopts the active backend's nomenclature preset. Idempotent — safe to click again. */
export async function applyCharityOnboarding(): Promise<CharityOnboardingResult> {
  const res = await fetch("/api/setup/charity-onboarding", { method: "POST", credentials: "same-origin" });
  if (!res.ok) {
    throw responseError(res, await safeJson(res));
  }
  return res.json();
}

/** Display order for the picker (strict → relaxed). */
export const PROFILE_ORDER = ["enterprise", "business", "nonprofit", "self-hosted", "demo"];

/** Friendly labels for the hardening toggles. */
export const HARDENING_LABELS: Record<string, string> = {
  oidc: "SSO (OIDC)",
  scim: "SCIM provisioning",
  ipAllowlist: "IP allowlist",
  sessionCap: "Concurrent-session cap",
  kms: "KMS / BYOK keys",
  makerChecker: "Maker-checker",
  securityStrict: "Strict boot checks",
  rateLimit: "Rate limiting",
  strongMfaAdminPmo: "Tamper-resistant MFA (pmo/admin)",
};
