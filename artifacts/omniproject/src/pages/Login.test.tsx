import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Login } from "./Login";
import { login, samlLogin, oauth2Login, requestMagicLink } from "../lib/auth";

// Login only needs to prove it wires clicks/submits to the right navigation call with the
// right args — the navigation functions themselves (window.location.href assignment) have
// their own coverage, and re-exercising real browser navigation isn't reproducible in jsdom.
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    login: vi.fn(),
    samlLogin: vi.fn(),
    oauth2Login: vi.fn(),
    requestMagicLink: vi.fn(async () => ({ ok: true })),
  };
});

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

  it("renders the branded logo image instead of the short-name mark when branding sets a logoUrl", () => {
    const qc = clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer" });
    qc.setQueryData(["branding"], {
      appName: "Acme PM", shortName: "AP", logoUrl: "https://cdn.acme.example/logo.png", primaryColor: "", loginHeading: "Sign in",
      footerText: "", supportUrl: "", fontFamily: "", entitled: true, locked: false,
    });
    renderWithProviders(<Login />, { client: qc });
    expect(screen.getByRole("img", { name: "Acme PM" })).toHaveAttribute("src", "https://cdn.acme.example/logo.png");
    expect(screen.queryByText("AP")).not.toBeInTheDocument();
  });

  it("redirects to the dashboard when already authenticated", async () => {
    window.history.pushState({}, "", "/login");
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: true, mode: "oidc", user: { sub: "u1" }, role: "viewer" }),
    });
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("calls login() with the return path when the demo-mode button is clicked", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "demo", user: null, role: "viewer" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /enter \(demo mode\)/i }));
    expect(login).toHaveBeenCalledWith("/");
  });

  it("calls login() with the provider id when a specific provider's button is clicked", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth(
        { authenticated: false, mode: "oidc", user: null, role: "viewer" },
        [{ id: "google", label: "Google", kind: "oidc" }],
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
    expect(login).toHaveBeenCalledWith("/", "google");
  });

  it("renders and wires the SAML button when samlConfigured", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer", samlConfigured: true }),
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in with saml/i }));
    expect(samlLogin).toHaveBeenCalledWith("/");
  });

  it("renders and wires the OAuth2 button when oauth2Configured", () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer", oauth2Configured: true }),
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in with oauth2/i }));
    expect(oauth2Login).toHaveBeenCalledWith("/");
  });

  it("submits the typed email as a magic-link request and shows the sent confirmation", async () => {
    renderWithProviders(<Login />, {
      client: clientWithAuth({ authenticated: false, mode: "oidc", user: null, role: "viewer", magicLinkEnabled: true }),
    });
    fireEvent.change(screen.getByLabelText(/email for a sign-in link/i), { target: { value: "pm@acme.example" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith("pm@acme.example", "/"));
    expect(await screen.findByText(/if that address can sign in, a link is on its way/i)).toBeInTheDocument();
  });
});
