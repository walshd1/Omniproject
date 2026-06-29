import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Login } from "./Login";

function clientWithAuth(auth: unknown, providers: unknown[] = []): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], auth);
  qc.setQueryData(["auth", "providers"], providers);
  return qc;
}

describe("Login", () => {
  it("renders the brand name, default heading and SSO button when OIDC is configured", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer" }),
    });
    expect(screen.getByRole("heading", { name: /omniproject/i })).toBeInTheDocument();
    expect(screen.getByText(/orchestration shell/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with sso/i })).toBeInTheDocument();
    // default footer text
    expect(screen.getByText(/secure\. fast\. keyboard driven\./i)).toBeInTheDocument();
  });

  it("shows the demo-mode button and OIDC hint when running in demo mode", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "demo", user: null, role: "viewer" }),
    });
    expect(screen.getByRole("button", { name: /enter \(demo mode\)/i })).toBeInTheDocument();
    expect(screen.getByText(/no oidc provider configured/i)).toBeInTheDocument();
  });

  it("renders one branded button per configured OIDC provider", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth(
        { authenticated: false, mode: "oidc", user: null, role: "viewer" },
        [{ id: "google", label: "Google", kind: "oidc" }, { id: "microsoft", label: "Microsoft 365", kind: "oidc" }],
      ),
    });
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with microsoft 365/i })).toBeInTheDocument();
    // The generic single SSO button is replaced by the per-provider buttons.
    expect(screen.queryByRole("button", { name: /sign in with sso/i })).not.toBeInTheDocument();
  });

  it("shows the short-name brand mark fallback (no logo)", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer" }),
    });
    // shortName fallback square when brand.logoUrl is empty (default branding)
    expect(screen.getByText("OP")).toBeInTheDocument();
  });
});
