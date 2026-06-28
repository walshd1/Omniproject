import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Deployment-profile client. Reports the chosen profile (enterprise … self-hosted), what's
 * been relaxed by choice (TLS, demo auth), and which advanced hardening is on vs off — so an
 * admin can see, at a glance, that their small-org deployment is intentionally relaxed and what
 * they'd turn on to harden it.
 */
export interface ProfilePosture {
  label: string;
  tls: "required" | "lan-ok";
  demoAuthSeverity: "critical" | "warn" | "info";
  summary: string;
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
}

/** The deployment profile + posture + which hardening is engaged (admin). */
export function useDeploymentProfile() {
  return useQuery<DeploymentProfileView>({
    queryKey: ["deployment-profile"],
    queryFn: () => getJson("/api/setup/profile"),
    staleTime: 60_000,
  });
}

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
