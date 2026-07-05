import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { FeatureModulesAdmin } from "./FeatureModulesAdmin";

function feat(over: Partial<FeatureStatus> = {}): FeatureStatus {
  return { id: "grid", kind: "module", label: "Grid", description: "Editable grid", enabled: true, loaded: true, needsRestart: false, ...over };
}

function seed(features: FeatureStatus[], role: string = "admin"): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(featuresQueryKey(), features);
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role });
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

afterEach(resetFetchMock);

describe("FeatureModulesAdmin", () => {
  it("lists module-kind features only — reports and methodologies are governed elsewhere", () => {
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([
        feat({ id: "grid", label: "Grid" }),
        feat({ id: "report:evm", kind: "report", label: "Earned Value" }),
        feat({ id: "methodology:prince2", kind: "methodology", label: "PRINCE2" }),
      ]),
    });
    expect(screen.getByText("Grid")).toBeInTheDocument();
    expect(screen.queryByText("Earned Value")).not.toBeInTheDocument();
    expect(screen.queryByText("PRINCE2")).not.toBeInTheDocument();
  });

  it("renders nothing while the features list hasn't loaded yet", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", user: null, role: "admin" });
    renderWithProviders(<FeatureModulesAdmin />, { client: qc });
    expect(screen.queryByTestId("feature-modules")).not.toBeInTheDocument();
  });

  it("renders nothing for a non-admin session, mirroring the server's requireRole(\"admin\") on PATCH /api/settings", () => {
    renderWithProviders(<FeatureModulesAdmin />, { client: seed([feat()], "manager") });
    expect(screen.queryByTestId("feature-modules")).not.toBeInTheDocument();
  });

  it("shows the needs-restart notice for an enabled module pending a restart", () => {
    renderWithProviders(<FeatureModulesAdmin />, { client: seed([feat({ needsRestart: true })]) });
    expect(screen.getByText(/restart to load its code/i)).toBeInTheDocument();
  });

  it("hides the needs-restart notice for a module that's already loaded", () => {
    renderWithProviders(<FeatureModulesAdmin />, { client: seed([feat({ needsRestart: false })]) });
    expect(screen.queryByText(/restart to load its code/i)).not.toBeInTheDocument();
  });

  it("shows On/Off and aria-pressed reflecting each module's enabled state", () => {
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([feat({ id: "grid", label: "Grid", enabled: true }), feat({ id: "gantt", label: "Gantt", enabled: false })]),
    });
    expect(screen.getByRole("button", { name: "On" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggling an enabled module off PATCHes the full computed disabled set", async () => {
    const calls = mockFetchRouter({ "/api/settings": { ok: true, body: {} } });
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([feat({ id: "grid", label: "Grid", enabled: true }), feat({ id: "gantt", label: "Gantt", enabled: true })]),
    });
    fireEvent.click(screen.getAllByRole("button", { name: "On" })[0]!); // "grid"

    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/settings") && c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.url.endsWith("/api/settings") && c.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ disabledFeatures: ["grid"] });
  });

  it("toggling a disabled module back on removes it from the PATCHed disabled set", async () => {
    const calls = mockFetchRouter({ "/api/settings": { ok: true, body: {} } });
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([feat({ id: "grid", label: "Grid", enabled: false }), feat({ id: "gantt", label: "Gantt", enabled: true })]),
    });
    fireEvent.click(screen.getByRole("button", { name: "Off" }));

    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/settings") && c.init?.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.url.endsWith("/api/settings") && c.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init!.body))).toEqual({ disabledFeatures: [] });
  });

  it("disables every toggle button while a mutation is pending", async () => {
    // Only the PATCH to /api/settings hangs; every other fetch (BrandingProvider's own
    // mount-time call, the invalidateQueries refetch of /api/features) resolves immediately,
    // so nothing is left in flight when the test ends and unrelated providers aren't starved.
    let resolvePatch!: (v: Response) => void;
    const modules = [feat({ id: "grid", label: "Grid" }), feat({ id: "gantt", label: "Gantt" })];
    const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url), "http://localhost").pathname;
      if (path === "/api/settings" && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => { resolvePatch = resolve; });
      }
      if (path === "/api/features") return Promise.resolve(ok({ features: modules }));
      return Promise.resolve(ok());
    }));
    renderWithProviders(<FeatureModulesAdmin />, {
      client: seed([feat({ id: "grid", label: "Grid" }), feat({ id: "gantt", label: "Gantt" })]),
    });

    fireEvent.click(screen.getAllByRole("button", { name: "On" })[0]!);
    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "On" })[1]).toBeDisabled());

    resolvePatch(ok());
    await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "On" })[1]).toBeEnabled());
  });
});
