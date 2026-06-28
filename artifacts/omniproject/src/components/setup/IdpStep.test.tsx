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
    expect(screen.getByText(/api\/auth\/callback/)).toBeInTheDocument();
  });

  it("oidc mode: tells you to create users in the IdP + shows the live mapping", () => {
    renderWithProviders(<IdpStep />, {
      client: seed({ ...base, mode: "oidc", issuer: "https://authentik.local/application/o/omniproject/", issuerOrigin: "https://authentik.local", bundled: true, roleGroups: [{ role: "admin", groups: ["omni-admins"] }] }),
    });
    expect(screen.getByText(/SSO is active/i)).toBeInTheDocument();
    expect(screen.getByTestId("idp-rolemap")).toHaveTextContent("omni-admins");
  });
});
