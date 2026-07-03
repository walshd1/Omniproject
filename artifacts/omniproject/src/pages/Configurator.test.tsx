import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import type { SetupStatus } from "../lib/setup";
import { Configurator } from "./Configurator";

function status(over: Partial<SetupStatus> = {}): SetupStatus {
  return {
    configured: false,
    // PMO by default: passes the page's access gate (like the pre-existing "admin
    // action" gating, unaffected — isAdmin stays false, same as the old "viewer"
    // default) while these tests exercise the configurator's internal steps, not
    // the access gate itself — that gets its own describe block below.
    role: "pmo",
    broker: { configured: false, urlSet: false },
    auth: { mode: "demo" },
    ai: { provider: "none" },
    capabilities: null,
    ...over,
  };
}

// Seeds BOTH the session (which the page's access gate reads via useAuth()) and the
// PMO/admin-gated setup-status query, keeping their `role` in lockstep like a real
// session would — the gateway derives both from the same principal.
function seed(s: SetupStatus | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (s) {
    qc.setQueryData(["auth", "me"], { sub: "u1", role: s.role });
    qc.setQueryData(["setup", "status"], s);
  }
  return qc;
}

beforeEach(() => {
  window.localStorage.clear();
  // Child steps fetch config/backends in effects; return safe payloads.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/setup/export")) return new Response("# config", { status: 200 });
    if (url.includes("/api/setup/backends")) return new Response("[]", { status: 200 });
    if (url.includes("/api/setup/brokers")) return new Response("[]", { status: 200 });
    if (url.includes("/api/setup/outputs")) return new Response("[]", { status: 200 });
    if (url.includes("/api/setup/reports")) return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

describe("Configurator", () => {
  it("renders the configurator heading and intro from setup status", () => {
    renderWithProviders(<Configurator />, { client: seed(status()) });
    expect(screen.getByRole("heading", { level: 1, name: /configurator/i })).toBeInTheDocument();
    expect(screen.getByText(/get omniproject talking to the tools/i)).toBeInTheDocument();
  });

  it("defaults to Guided mode: shows the 3-step start-here box and hides advanced steps", () => {
    renderWithProviders(<Configurator />, { client: seed(status({ broker: { configured: true, urlSet: true } })) });
    expect(screen.getByTestId("setup-start-here")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /^status$/i })).not.toBeInTheDocument();
  });

  it("reveals the advanced steps in Guided mode via the 'show the rest' toggle", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Configurator />, { client: seed(status({ broker: { configured: true, urlSet: true } })) });
    await user.click(screen.getByRole("button", { name: /show the rest of the setup/i }));
    expect(screen.getByRole("heading", { level: 2, name: /^status$/i })).toBeInTheDocument();
  });

  it("shows every step with no start-here box in Technical mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Configurator />, { client: seed(status({ broker: { configured: true, urlSet: true } })) });
    await user.click(screen.getByRole("radio", { name: /technical/i }));
    expect(screen.queryByTestId("setup-start-here")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /^status$/i })).toBeInTheDocument();
  });

  it("renders an error state when setup status fails to load", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // PMO so the page's access gate passes and the internal query actually fires.
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "pmo" });
    const observer = qc.getQueryCache().build(qc, { queryKey: ["setup", "status"] });
    observer.setState({ status: "error", error: new Error("nope"), fetchStatus: "idle" } as never);
    renderWithProviders(<Configurator />, { client: qc });
    // DataState error path renders a retry affordance instead of the wizard.
    expect(screen.queryByRole("heading", { level: 1, name: /configurator/i })).not.toBeInTheDocument();
  });
});

describe("Configurator — access gate (PMO/admin only)", () => {
  const restricted: Array<SetupStatus["role"]> = ["viewer", "contributor", "manager"];
  for (const role of restricted) {
    it(`shows "Access restricted" instead of the configurator for role ${role}`, () => {
      renderWithProviders(<Configurator />, { client: seed(status({ role })) });
      expect(screen.getByRole("alert")).toHaveTextContent(/access restricted/i);
      expect(screen.queryByRole("heading", { level: 1, name: /configurator/i })).not.toBeInTheDocument();
      expect(screen.queryByTestId("setup-start-here")).not.toBeInTheDocument();
    });
  }

  for (const role of ["pmo", "admin"] as Array<SetupStatus["role"]>) {
    it(`renders the full configurator for role ${role}`, () => {
      renderWithProviders(<Configurator />, { client: seed(status({ role })) });
      expect(screen.getByRole("heading", { level: 1, name: /configurator/i })).toBeInTheDocument();
      expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
    });
  }
});
