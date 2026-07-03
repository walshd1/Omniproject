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
    role: "viewer",
    broker: { configured: false, urlSet: false },
    auth: { mode: "demo" },
    ai: { provider: "none" },
    capabilities: null,
    ...over,
  };
}

function seed(s: SetupStatus | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (s) qc.setQueryData(["setup", "status"], s);
  return qc;
}

beforeEach(() => {
  window.localStorage.clear();
  // Child steps fetch config/backends in effects; return safe payloads.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/setup/export")) return new Response("# config", { status: 200 });
    if (url.includes("/api/setup/backends")) return new Response("[]", { status: 200 });
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
    const observer = qc.getQueryCache().build(qc, { queryKey: ["setup", "status"] });
    observer.setState({ status: "error", error: new Error("nope"), fetchStatus: "idle" } as never);
    renderWithProviders(<Configurator />, { client: qc });
    // DataState error path renders a retry affordance instead of the wizard.
    expect(screen.queryByRole("heading", { level: 1, name: /configurator/i })).not.toBeInTheDocument();
  });
});
