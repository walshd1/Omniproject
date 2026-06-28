import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

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
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `Failed (${res.status})`);
  }
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
};
