import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("saves an org policy with a feature turned off", async () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/settings");
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabledFeatures: ["grid"], enabledFeatures: [], featureGovernance: { required: [], forbidden: [] } });
  });

  it("saves an org policy with a feature required", async () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByRole("radio", { name: "Require" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/settings");
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabledFeatures: [], enabledFeatures: [], featureGovernance: { required: ["grid"], forbidden: [] } });
  });

  it("saves an org policy with a feature forbidden", async () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByRole("radio", { name: "Forbid" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/settings");
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabledFeatures: [], enabledFeatures: [], featureGovernance: { required: [], forbidden: ["grid"] } });
  });

  it("saves an org policy with a default-off feature opted in", async () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("admin", [feat({ id: "presence", label: "Presence", enabled: false, defaultOff: true })]),
    });
    fireEvent.click(screen.getByRole("radio", { name: "On" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/settings");
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabledFeatures: [], enabledFeatures: ["presence"], featureGovernance: { required: [], forbidden: [] } });
  });

  it("saves a programme policy with a feature required", async () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("pmo", [feat()], [{}, { programmeId: "prog-1" }]) });
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "prog-1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Require" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/features/programme/prog-1");
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabled: [], required: ["grid"], forbidden: [] });
  });

  it("shows a no-role message for a user without any governance access", () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("viewer", [feat()]) });
    expect(screen.getByText(/don't have a role that can manage feature governance/i)).toBeInTheDocument();
    expect(screen.queryByTestId("feature-governance")).not.toBeInTheDocument();
  });

  it("switching level tabs resets the target and any pending edits", () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()], [{}, { programmeId: "prog-1" }]) });
    // Edit something at org level first.
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("tab", { name: "programme" }));
    expect(screen.getByTestId("governance-target")).toHaveValue("");
    // No table until a programme is picked.
    expect(screen.queryByTestId("gov-row-grid")).not.toBeInTheDocument();
  });

  it("selects a project target directly and derives its programme", () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("manager", [feat()], [{}, { programmeId: "prog-1", projectId: "p1" }]),
    });
    // A plain manager only sees the project tab.
    expect(screen.queryByRole("tab", { name: "org" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "project" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "p1" } });
    expect(screen.getByTestId("gov-row-grid")).toBeInTheDocument();
  });

  it("changing a feature's policy choice updates the selected radio", () => {
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByRole("radio", { name: "Require" }));
    expect(screen.getByRole("radio", { name: "Require" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "false");
  });

  it("saves a programme policy via PATCH", async () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("pmo", [feat()], [{}, { programmeId: "prog-1" }]),
    });
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "prog-1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Forbid" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url) === "/api/features/programme/prog-1");
    expect(call).toBeTruthy();
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabled: [], required: [], forbidden: ["grid"] });
  });

  it("saves a project policy via PATCH, including the derived programmeId", async () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("manager", [feat()], [{}, { programmeId: "prog-1", projectId: "p1" }]),
    });
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("radio", { name: "Disable" }));
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).toHaveTextContent(/saved/i));
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url).startsWith("/api/features/project/p1"));
    expect(call).toBeTruthy();
    expect(String(call![0])).toContain("programmeId=prog-1");
    expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ disabled: ["grid"], required: [], forbidden: [] });
  });

  it("shows an error message when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "denied" }), { status: 403 })));
    renderWithProviders(<FeatureGovernance />, { client: seed("admin", [feat()]) });
    fireEvent.click(screen.getByTestId("governance-save"));
    await waitFor(() => expect(screen.getByTestId("governance-msg")).not.toHaveTextContent(/saved/i));
    expect(screen.getByTestId("governance-msg")).toBeInTheDocument();
  });

  it("pre-selects the radio for a feature already governed at the current level", () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("admin", [
        feat({ id: "required-here", label: "Required here", locked: true, lockedBy: "org", policy: "require" }),
        feat({ id: "forbidden-here", label: "Forbidden here", locked: true, lockedBy: "org", policy: "forbid" }),
        feat({ id: "opted-in", label: "Opted in", enabled: true, defaultOff: true }),
        feat({ id: "disabled-here", label: "Disabled here", enabled: false, blockedAt: "org" }),
      ]),
    });
    expect(within(screen.getByTestId("gov-row-required-here")).getByRole("radio", { name: "Require" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("gov-row-forbidden-here")).getByRole("radio", { name: "Forbid" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("gov-row-opted-in")).getByRole("radio", { name: "On" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("gov-row-disabled-here")).getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });

  it("pre-selects the radio for a feature already governed at a non-org level", () => {
    renderWithProviders(<FeatureGovernance />, {
      client: seed("pmo", [
        feat({ id: "required-here", label: "Required here", locked: true, lockedBy: "programme", policy: "require" }),
        feat({ id: "forbidden-here", label: "Forbidden here", locked: true, lockedBy: "programme", policy: "forbid" }),
        feat({ id: "disabled-here", label: "Disabled here", enabled: false, blockedAt: "programme" }),
      ], [{}, { programmeId: "prog-1" }]),
    });
    fireEvent.change(screen.getByTestId("governance-target"), { target: { value: "prog-1" } });
    expect(within(screen.getByTestId("gov-row-required-here")).getByRole("radio", { name: "Require" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("gov-row-forbidden-here")).getByRole("radio", { name: "Forbid" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByTestId("gov-row-disabled-here")).getByRole("radio", { name: "Disable" })).toHaveAttribute("aria-checked", "true");
  });
});
