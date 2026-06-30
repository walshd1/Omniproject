import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProgrammesQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { featuresQueryKey, type FeatureScope, type FeatureStatus } from "../../lib/features";
import { FeatureGovernance } from "./FeatureGovernance";

function feat(over: Partial<FeatureStatus> = {}): FeatureStatus {
  return { id: "grid", kind: "module", label: "Grid", description: "Editable grid", enabled: true, loaded: true, needsRestart: false, ...over };
}

function seed(role: string, features: FeatureStatus[], scopes: FeatureScope[] = [{}]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, mode: "demo", role, user: { sub: "u", role } });
  for (const s of scopes) qc.setQueryData(featuresQueryKey(s), features);
  qc.setQueryData(getListProgrammesQueryKey(), [{ id: "prog-1", name: "Transformation" }]);
  qc.setQueryData(getListProjectsQueryKey(), [{ id: "p1", name: "Alpha", programmeId: "prog-1" }]);
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

describe("FeatureGovernance", () => {
  it("shows the org/programme/project tabs for an admin and renders feature rows", () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat(), feat({ id: "presence", label: "Presence", enabled: false, defaultOff: true, reason: "cost" })]) });
    expect(screen.getByTestId("feature-governance")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "org" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "programme" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "project" })).toBeInTheDocument();
    expect(screen.getByTestId("gov-row-grid")).toBeInTheDocument();
    expect(screen.getByTestId("gov-row-presence")).toHaveTextContent(/default-off \(cost\)/i);
  });

  it("groups reports and methodologies into their own sections", () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("admin", [
        feat(),
        feat({ id: "report:evm", kind: "report", label: "Earned Value" }),
        feat({ id: "methodology:prince2", kind: "methodology", label: "PRINCE2" }),
      ]),
    });
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Methodologies")).toBeInTheDocument();
    expect(screen.getByTestId("gov-row-report:evm")).toBeInTheDocument();
    expect(screen.getByTestId("gov-row-methodology:prince2")).toBeInTheDocument();
  });

  it("renders an inherited mandate as locked (not editable at a lower level)", () => {
    // presence is required at the org level → at programme scope it shows as locked.
    renderWithProviders(<FeatureGovernance />, {
      client: seed("pmo", [feat({ id: "presence", label: "Presence", enabled: true, locked: true, lockedBy: "org", policy: "require" })], [{}, { programmeId: "prog-1" }]),
    });
    // pmo only sees the programme tab; pick a programme, then the row is locked.
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "prog-1" } });
    expect(screen.getByTestId("gov-row-presence")).toHaveTextContent(/Required at org \(locked\)/i);
  });

  it("saves an org policy via the settings PATCH", async () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([url]) => String(url) === "/api/settings")).toBe(true);
  });
});
