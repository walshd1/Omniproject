import { describe, it, expect, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { GovernanceDashboard } from "./GovernanceDashboard";
import type { ResolvedCapability, CapabilityLogEntry } from "../../lib/tools";

afterEach(() => resetFetchMock());

/**
 * The admin dashboard surfaces what's on and the live activity trail; hidden for
 * non-admins; default "no AI" shows the nothing-enabled state.
 */
const offCap = (id: string, kind: ResolvedCapability["kind"]): ResolvedCapability => ({
  id, kind, label: id, description: "", supportedStates: ["user-defined", "public"], surfaceAware: true,
  options: ["off", "user-defined", "public"], state: "off", endpoint: null, surfaces: {},
});

function seed(role: string | undefined, caps: ResolvedCapability[], entries: CapabilityLogEntry[], autonomous?: { level: string; source: string; relax: string; grants: unknown[]; aiKill?: boolean }): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["governance"], { capabilities: caps, surfaces: [] });
  qc.setQueryData(["governance-log"], { entries });
  qc.setQueryData(["autonomous-grants"], autonomous ?? { level: "public", source: "off", relax: "public", grants: [], aiKill: false });
  return qc;
}

describe("GovernanceDashboard", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<GovernanceDashboard />, { client: seed("viewer", [offCap("provider:openai", "ai-provider")], []) });
    expect(screen.queryByTestId("governance-dashboard")).not.toBeInTheDocument();
  });

  it("shows the no-AI default state when nothing is enabled", () => {
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], []) });
    expect(screen.getByTestId("governance-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("nothing-enabled")).toBeInTheDocument();
  });

  it("lists what's enabled and the recent activity, incl. blocks", () => {
    const caps = [{ ...offCap("provider:openai", "ai-provider"), state: "public" as const }];
    const entries: CapabilityLogEntry[] = [
      { ts: "t", action: "blocked", capability: "provider:anthropic", kind: "ai-provider", surface: "finance", state: "off", actor: "a@b.c" },
      { ts: "t", action: "use", capability: "provider:openai", kind: "ai-provider", surface: null, state: "public", actor: "u@b.c" },
    ];
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", caps, entries) });
    // Appears under "Enabled now" and in the activity feed.
    expect(screen.getAllByText("provider:openai").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("nothing-enabled")).not.toBeInTheDocument();
    expect(screen.getByTestId("activity-log")).toBeInTheDocument();
    expect(screen.getByText("blocked")).toBeInTheDocument();
    expect(screen.getByText(/on finance/)).toBeInTheDocument();
  });

  it("surfaces full containment by default and default-deny when there are no grants", () => {
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], { level: "public", source: "off", relax: "public", grants: [] }) });
    expect(screen.getByTestId("autonomous-posture")).toHaveTextContent("Full containment");
    expect(screen.getByTestId("no-grants")).toBeInTheDocument();
  });

  it("lists active autonomous write grants with their scope", () => {
    const autonomous = { level: "local", source: "local", relax: "off", grants: [{ actorId: "health-watch", actions: ["update_issue"], projects: ["P1"], fields: ["status"], maxWrites: 5 }], aiKill: false };
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], autonomous) });
    const list = screen.getByTestId("grant-list");
    expect(list).toHaveTextContent("health-watch");
    expect(list).toHaveTextContent("update_issue");
    expect(list).toHaveTextContent("P1");
    expect(list).toHaveTextContent("≤5 writes");
  });

  it("shows the break-glass kill switch (and its engaged state)", () => {
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], { level: "public", source: "off", relax: "public", grants: [], aiKill: false }) });
    expect(screen.getByTestId("ai-kill-toggle")).toHaveTextContent("Kill AI");
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], { level: "public", source: "off", relax: "public", grants: [], aiKill: true }) });
    expect(screen.getAllByTestId("ai-kill-toggle").some((b) => /AI KILLED/.test(b.textContent ?? ""))).toBe(true);
  });

  it("relaxing the containment floor steps up and PUTs the new level", async () => {
    const autonomous = { level: "public", source: "off", relax: "public", grants: [], aiKill: false };
    const calls = mockFetchRouter({
      "POST /api/auth/step-up": { ok: true },
      "PUT /api/governance/containment": { ok: true },
      "/api/governance/autonomous": { ok: true, body: autonomous },
    });
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], autonomous) });
    fireEvent.change(screen.getByTestId("relax-select"), { target: { value: "remote" } });
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/governance/containment"));
      expect(call).toBeTruthy();
      expect(call!.init?.method).toBe("PUT");
      expect(JSON.parse(String(call!.init?.body)).level).toBe("remote");
    });
    // Step-up ran first.
    expect(calls.some((c) => c.url.includes("/api/auth/step-up"))).toBe(true);
  });

  it("engaging the kill switch confirms, steps up, and PUTs the kill request", async () => {
    const autonomous = { level: "public", source: "off", relax: "public", grants: [], aiKill: false };
    const calls = mockFetchRouter({
      "POST /api/auth/step-up": { ok: true },
      "PUT /api/governance/ai-kill": { ok: true },
      "/api/governance/autonomous": { ok: true, body: autonomous },
    });
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], autonomous) });
    fireEvent.click(screen.getByTestId("ai-kill-toggle")); // open the confirm dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /kill ai/i }));
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/governance/ai-kill"));
      expect(call).toBeTruthy();
      expect(call!.init?.method).toBe("PUT");
      expect(JSON.parse(String(call!.init?.body)).engage).toBe(true);
    });
  });

  it("releasing the kill switch (already engaged) PUTs engage:false", async () => {
    const autonomous = { level: "public", source: "off", relax: "public", grants: [], aiKill: true };
    const calls = mockFetchRouter({
      "POST /api/auth/step-up": { ok: true },
      "PUT /api/governance/ai-kill": { ok: true },
      "/api/governance/autonomous": { ok: true, body: autonomous },
    });
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], autonomous) });
    fireEvent.click(screen.getByTestId("ai-kill-toggle"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^release$/i }));
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/api/governance/ai-kill"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call!.init?.body)).engage).toBe(false);
    });
  });

  it("renders the full grant scope (surfaces, projects, fields, expiry) and an empty-actions grant", () => {
    const autonomous = {
      level: "local", source: "local", relax: "off", aiKill: false,
      grants: [{ actorId: "planner", actions: [], surfaces: ["board"], fields: ["dueDate"], notAfter: Date.parse("2027-01-01T00:00:00Z") }],
    };
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [offCap("provider:openai", "ai-provider")], [], autonomous) });
    const list = screen.getByTestId("grant-list");
    expect(list).toHaveTextContent("planner");
    expect(list).toHaveTextContent("surfaces: board");
    expect(list).toHaveTextContent("fields: dueDate");
    expect(list).toHaveTextContent(/until/);
    // Empty action list renders the em-dash placeholder.
    expect(list).toHaveTextContent("may —");
  });

  it("hides the autonomous-posture block entirely when there is no autonomous data", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    qc.setQueryData(["auth", "me"], { sub: "u1", role: "admin" });
    qc.setQueryData(["governance"], { capabilities: [offCap("provider:openai", "ai-provider")], surfaces: [] });
    qc.setQueryData(["governance-log"], { entries: [] });
    // Deliberately leave ["autonomous-grants"] unset → undefined.
    renderWithProviders(<GovernanceDashboard />, { client: qc });
    expect(screen.getByTestId("governance-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("autonomous-posture")).not.toBeInTheDocument();
  });

  it("tags an enabled capability that carries screen overrides", () => {
    const cap: ResolvedCapability = {
      ...offCap("mcp:filesystem", "mcp"), state: "public",
      surfaces: { finance: "off", board: "public" },
    };
    renderWithProviders(<GovernanceDashboard />, { client: seed("admin", [cap], []) });
    expect(screen.getByText(/\+2 screen overrides/)).toBeInTheDocument();
  });
});
