import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { DeploymentProfile } from "./DeploymentProfile";
import type { DeploymentProfileView } from "../../lib/deployment-profile";

const VIEW: DeploymentProfileView = {
  profile: "self-hosted",
  posture: { label: "Self-hosted / homelab", audience: "Homelab", tls: "lan-ok", demoAuthSeverity: "warn", summary: "Small self-hoster on a private network.", relaxes: [], presetEnv: [], recommend: ["Set a strong SESSION_SECRET"] },
  tls: { servedOverTls: false },
  demoAuth: { active: true, accepted: false, severity: "warn" },
  hardening: { oidc: false, scim: false, ipAllowlist: false, sessionCap: false, kms: false, makerChecker: false, securityStrict: false, rateLimit: true, strongMfaAdminPmo: false },
  profiles: ["enterprise", "business", "nonprofit", "self-hosted", "demo"],
};

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["deployment-profile"], VIEW);
  return qc;
}

describe("DeploymentProfile", () => {
  it("is hidden for a non-admin", () => {
    renderWithProviders(<DeploymentProfile />, { client: seed("viewer") });
    expect(screen.queryByTestId("deployment-profile")).not.toBeInTheDocument();
  });

  it("shows the profile, the relaxed-by-choice items, and hardening state", () => {
    renderWithProviders(<DeploymentProfile />, { client: seed("admin") });
    expect(screen.getByTestId("profile-label")).toHaveTextContent("Self-hosted / homelab");
    expect(screen.getByText(/Relaxed by choice/i)).toBeInTheDocument();
    expect(screen.getByText(/Plain HTTP/i)).toBeInTheDocument();
    expect(screen.getByText(/No SSO/i)).toBeInTheDocument();
    expect(screen.getByText("SSO (OIDC)")).toBeInTheDocument(); // a hardening row
  });
});
