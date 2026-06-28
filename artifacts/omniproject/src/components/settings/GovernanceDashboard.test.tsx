import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { GovernanceDashboard } from "./GovernanceDashboard";
import type { ResolvedCapability, CapabilityLogEntry } from "../../lib/tools";

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
});
