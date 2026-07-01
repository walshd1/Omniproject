import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, getListProjectsQueryKey, type Capabilities, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { Dashboards } from "./Dashboards";
import { featuresQueryKey, type FeatureStatus } from "../lib/features";
import { dashboardsQueryKey, type Dashboard } from "../lib/dashboards";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1", name: "Alpha", identifier: "ALP", source: "jira",
    issueCount: 3, completedCount: 1, memberCount: 2, updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seed(opts: { enabled?: boolean; dashboards?: Dashboard[]; projects?: Project[]; surfaceProgramme?: boolean } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(featuresQueryKey(), [
    { id: "dashboards", kind: "module", label: "Custom dashboards", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(getGetCapabilitiesQueryKey(), {
    mode: "n8n",
    entities: { programme: { surface: opts.surfaceProgramme ?? true, store: opts.surfaceProgramme ?? true } },
  } as unknown as Capabilities);
  qc.setQueryData(dashboardsQueryKey, opts.dashboards ?? []);
  qc.setQueryData(getListProjectsQueryKey(), opts.projects ?? []);
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ dashboards: [] }), { status: 200 })));
});

describe("Dashboards", () => {
  it("shows the not-enabled note when the module is off", () => {
    renderWithProviders(<Dashboards />, { client: seed({ enabled: false }) });
    expect(screen.getByText(/module is not enabled/i)).toBeInTheDocument();
  });

  it("shows the empty state when there are no dashboards", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    expect(screen.getByTestId("dashboards-empty")).toBeInTheDocument();
  });

  it("renders an existing dashboard's widgets in a grid", () => {
    const dash: Dashboard = {
      id: "d1", name: "Exec", widgets: [
        { id: "w1", type: "projectCount", span: 1 },
        { id: "w2", type: "statusBreakdown", span: 2 },
      ],
    };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash], projects: [project()] }) });
    expect(screen.getByTestId("dashboard-grid")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Status breakdown")).toBeInTheDocument();
  });

  it("renders a placeholder for an unknown widget type", () => {
    const dash: Dashboard = { id: "d1", name: "Legacy", widgets: [{ id: "w1", type: "goneWidget" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    expect(screen.getByText(/Unknown widget/i)).toBeInTheDocument();
  });

  it("can create a new dashboard, add a widget, reorder/span/remove it, and save", async () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    // Edit-mode controls appear.
    const nameInput = screen.getByLabelText(/dashboard name/i);
    fireEvent.change(nameInput, { target: { value: "My board" } });

    // Add a widget from the catalogue.
    fireEvent.change(screen.getByLabelText(/add widget/i), { target: { value: "projectCount" } });
    expect(screen.getByLabelText(/remove widget/i)).toBeInTheDocument();

    // Span + reorder controls exercise the draft mutators.
    fireEvent.click(screen.getByLabelText("Span 2"));
    fireEvent.click(screen.getByLabelText("Move down"));
    fireEvent.click(screen.getByLabelText("Move up"));

    // Save persists via the mutation (fetch is stubbed; fires asynchronously).
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/dashboards", expect.objectContaining({ method: "PUT" })),
    );
  });

  it("omits entity-gated widgets the backend can't surface", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [], surfaceProgramme: false }) });
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    const addSelect = screen.getByLabelText(/add widget/i) as HTMLSelectElement;
    const options = [...addSelect.options].map((o) => o.value);
    expect(options).toContain("projectCount");
    expect(options).not.toContain("programmeCount");
  });

  it("shows the Live badge when viewing a dashboard with a refresh interval", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [{ id: "d1", name: "Ops", widgets: [], refreshMs: 30000 }] }) });
    const badge = screen.getByTestId("dashboard-live");
    expect(badge).toHaveTextContent(/Live/);
    expect(badge).toHaveTextContent("30s");
  });

  it("offers an auto-refresh interval selector in edit mode", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(screen.getByLabelText("Auto-refresh interval")).toBeInTheDocument();
  });

  it("suggests role-tailored presets in the empty state and applies one", async () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    // The empty state surfaces one suggestion per role.
    const suggestions = screen.getByTestId("preset-suggestions");
    expect(suggestions).toBeInTheDocument();
    const applyBtn = screen.getByRole("button", { name: /Head of Projects/i });
    fireEvent.click(applyBtn);
    // Applying a preset persists a fresh dashboard via the existing save path.
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/dashboards", expect.objectContaining({ method: "PUT" })),
    );
  });

  it("offers an Apply-a-preset picker and applies the chosen preset", async () => {
    const dash: Dashboard = { id: "d1", name: "Ops", widgets: [{ id: "w1", type: "projectCount" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    const picker = screen.getByLabelText("Apply a preset") as HTMLSelectElement;
    const values = [...picker.options].map((o) => o.value);
    expect(values).toContain("project-manager-today");
    fireEvent.change(picker, { target: { value: "project-manager-today" } });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/dashboards", expect.objectContaining({ method: "PUT" })),
    );
  });

  it("hides presets that need an entity the backend can't surface", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [], surfaceProgramme: false }) });
    // Programme-manager preset uses programmeCount (requiresEntity: programme) → dropped.
    expect(screen.queryByRole("button", { name: /Programme Manager/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project Manager/i })).toBeInTheDocument();
  });
});
