import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { IdpStep } from "./IdpStep";
import type { IdpStatus } from "../../lib/idp";

const base: IdpStatus = {
  mode: "demo",
  issuer: "",
  issuerOrigin: "",
  bundled: false,
  callbackUrl: "https://app.local/api/auth/callback",
  roleGroups: [
    { role: "admin", groups: [] },
    { role: "viewer", groups: [] },
  ],
  suggestedGroups: { admin: "omni-admins", pmo: "omni-pmo", manager: "omni-managers", contributor: "omni-contributors", viewer: "omni-viewers" },
  presets: [
    { id: "google", kind: "oidc", label: "Google Workspace", audience: "Charities/SMEs on Google.", issuerTemplate: "https://accounts.google.com", scope: "openid email profile", groupsClaimNote: "Map by domain.", envKeys: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"], consoleUrl: "https://console.cloud.google.com", notes: [] },
    { id: "github", kind: "oauth2", label: "GitHub (OAuth2)", audience: "Teams on GitHub.", issuerTemplate: "", endpoints: { authUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", userInfoUrl: "https://api.github.com/user" }, scope: "read:user", groupsClaimNote: "No roles.", envKeys: ["OAUTH2_AUTH_URL"], consoleUrl: "https://github.com/settings/developers", notes: [] },
  ],
  profile: "nonprofit",
};

function seed(idp: IdpStatus): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["setup-idp"], idp);
  return qc;
}

describe("IdpStep", () => {
  it("demo mode: guides the bundled-IdP path with the role→group map and callback URL", () => {
    renderWithProviders(<IdpStep />, { client: seed(base) });
    expect(screen.getByTestId("idp-step")).toBeInTheDocument();
    expect(screen.getByText(/bundled identity/i)).toBeInTheDocument();
    // falls back to the suggested group names when nothing is configured yet
    expect(screen.getByTestId("idp-rolemap")).toHaveTextContent("omni-admins");
    // The redirect URI appears in the bundled-IdP guidance and the preset cards.
    expect(screen.getAllByText(/api\/auth\/callback/).length).toBeGreaterThan(0);
    // The Workspace-login presets are surfaced (incl. the GitHub OAuth2 preset).
    expect(screen.getByTestId("idp-presets")).toHaveTextContent("Google Workspace");
    expect(screen.getByTestId("idp-presets")).toHaveTextContent("GitHub (OAuth2)");
  });

  it("oidc mode: tells you to create users in the IdP + shows the live mapping", () => {
    renderWithProviders(<IdpStep />, {
      client: seed({ ...base, mode: "oidc", issuer: "https://authentik.local/application/o/omniproject/", issuerOrigin: "https://authentik.local", bundled: true, roleGroups: [{ role: "admin", groups: ["omni-admins"] }] }),
    });
    expect(screen.getByText(/SSO is active/i)).toBeInTheDocument();
    expect(screen.getByTestId("idp-rolemap")).toHaveTextContent("omni-admins");
  });
});
