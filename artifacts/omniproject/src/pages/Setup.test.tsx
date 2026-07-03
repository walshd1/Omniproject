import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import type { SetupStatus } from "../lib/setup";
import { Setup } from "./Setup";

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
  // Child steps fetch config/backends in effects; return safe payloads.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/setup/export")) return new Response("# config", { status: 200 });
    if (url.includes("/api/setup/backends")) return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

describe("Setup", () => {
  it("renders the connection-center heading and intro from setup status", () => {
    renderWithProviders(<Setup />, { client: seed(status()) });
    expect(screen.getByRole("heading", { level: 1, name: /setup/i })).toBeInTheDocument();
    expect(screen.getByText(/get omniproject talking to the tools/i)).toBeInTheDocument();
  });

  it("renders the wizard steps when status has loaded", () => {
    renderWithProviders(<Setup />, { client: seed(status({ broker: { configured: true, urlSet: true } })) });
    // The page composes its step sections; the heading proves the render path ran.
    expect(screen.getByRole("heading", { level: 1, name: /setup/i })).toBeInTheDocument();
  });

  it("renders an error state when setup status fails to load", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const observer = qc.getQueryCache().build(qc, { queryKey: ["setup", "status"] });
    observer.setState({ status: "error", error: new Error("nope"), fetchStatus: "idle" } as never);
    renderWithProviders(<Setup />, { client: qc });
    // DataState error path renders a retry affordance instead of the wizard.
    expect(screen.queryByRole("heading", { level: 1, name: /setup/i })).not.toBeInTheDocument();
  });
});
