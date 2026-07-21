import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, getListProjectsQueryKey, type Capabilities, type Project } from "@workspace/api-client-react";
import { renderWithProviders, mockBlobDownload, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { Dashboards } from "./Dashboards";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { dashboardsQueryKey, type Dashboard } from "../../lib/dashboards";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1", name: "Alpha", identifier: "ALP", source: "jira",
    issueCount: 3, completedCount: 1, memberCount: 2, updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seed(opts: { enabled?: boolean; dashboards?: Dashboard[]; imported?: Dashboard[]; projects?: Project[]; surfaceProgramme?: boolean; role?: string } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (opts.role) qc.setQueryData(["auth", "me"], { sub: "u1", role: opts.role });
  qc.setQueryData(featuresQueryKey(), [
    { id: "dashboards", kind: "module", label: "Custom dashboards", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(getGetCapabilitiesQueryKey(), {
    mode: "n8n",
    entities: { programme: { surface: opts.surfaceProgramme ?? true, store: opts.surfaceProgramme ?? true } },
  } as unknown as Capabilities);
  qc.setQueryData(dashboardsQueryKey, opts.dashboards ?? []);
  // The importer-authored (X.10) dashboards the resolve-by-kind seam returns.
  qc.setQueryData(["defs", "resolved", "dashboard", null, null], (opts.imported ?? []).map((d, i) => ({
    id: `user~imp-${i}`, kind: "dashboard", name: d.name, payload: d,
    createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
  })));
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

  it("renders an importer-authored (definition) dashboard, editable via the importer (X.10)", () => {
    const imported: Dashboard = { id: "exec", name: "Imported Exec", widgets: [{ id: "w1", type: "projectCount", span: 1 }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [], imported: [imported], projects: [project()] }) });
    // It's selectable (under the Definitions group) and renders its widgets…
    expect(screen.getByRole("option", { name: "Imported Exec" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-grid")).toBeInTheDocument();
    // …and it's a def, so it's NOT a legacy-settings dashboard and Edit is available (writes go via the importer).
    expect(screen.queryByTestId("dashboard-legacy-badge")).toBeNull();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("authors a NEW dashboard through the importer (POST /api/defs), not the settings bundle (X.10)", async () => {
    const calls = mockFetchRouter({
      "POST /api/defs": { ok: true, status: 201, body: { id: "user~new-1", kind: "dashboard", name: "New dashboard", payload: {}, rowVersion: 1 } },
    });
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    // A storage target picker appears for a new def; default is Personal (user scope).
    expect(screen.getByTestId("dashboard-storage")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/defs") && (c.init?.method ?? "GET") === "POST")).toBe(true));
    // The def write carries the dashboard kind + chosen storage — and nothing was PUT to /api/dashboards.
    const post = calls.find((c) => c.url.includes("/api/defs") && c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ kind: "dashboard", storage: "user" });
    expect(calls.some((c) => c.url.includes("/api/dashboards") && c.init?.method === "PUT")).toBe(false);
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

    // Add two widgets from the catalogue so reordering actually swaps something.
    fireEvent.change(screen.getByLabelText(/add widget/i), { target: { value: "projectCount" } });
    fireEvent.change(screen.getByLabelText(/add widget/i), { target: { value: "statusBreakdown" } });
    expect(screen.getAllByLabelText(/remove widget/i)).toHaveLength(2);

    // Span + reorder controls exercise the draft mutators.
    fireEvent.click(screen.getAllByLabelText("Span 2")[0]!);
    fireEvent.click(screen.getAllByLabelText("Move down")[0]!);
    fireEvent.click(screen.getAllByLabelText("Move up")[1]!);

    // Save persists through the importer (POST /api/defs) — the single write path (X.10).
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/defs", expect.objectContaining({ method: "POST" })),
    );
  });

  it("lets an admin migrate legacy settings dashboards into the def store, then clears the slice (X.10 3b)", async () => {
    const calls = mockFetchRouter({
      "POST /api/defs": { ok: true, status: 201, body: { id: "org~m-1", kind: "dashboard", name: "Ops", payload: {}, rowVersion: 1 } },
      "PUT /api/dashboards": { ok: true, body: {} },
    });
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [{ id: "d1", name: "Ops", widgets: [] }], role: "admin" }) });
    fireEvent.click(screen.getByTestId("dashboard-migrate"));
    // Each legacy dashboard is re-authored as an ORG def through the importer…
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/defs") && c.init?.method === "POST")).toBe(true));
    const post = calls.find((c) => c.url.includes("/api/defs") && c.init?.method === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ kind: "dashboard", storage: "org", name: "Ops" });
    // …then the settings slice is cleared to empty (the parallel store is drained).
    await waitFor(() => {
      const put = calls.find((c) => c.url.includes("/api/dashboards") && c.init?.method === "PUT");
      expect(put && JSON.parse(String(put.init!.body))).toEqual({ dashboards: [] });
    });
  });

  it("does not offer the legacy migration to a non-admin", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [{ id: "d1", name: "Ops", widgets: [] }], role: "manager" }) });
    expect(screen.queryByTestId("dashboard-migrate")).toBeNull();
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
    // Applying a preset authors a fresh dashboard through the importer.
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/defs", expect.objectContaining({ method: "POST" })),
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
      expect(fetch).toHaveBeenCalledWith("/api/defs", expect.objectContaining({ method: "POST" })),
    );
  });

  it("hides presets that need an entity the backend can't surface", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [], surfaceProgramme: false }) });
    // Programme-manager preset uses programmeCount (requiresEntity: programme) → dropped.
    expect(screen.queryByRole("button", { name: /Programme Manager/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project Manager/i })).toBeInTheDocument();
  });

  it("edits an existing dashboard, then Cancel discards the draft", () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "projectCount" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText(/dashboard name/i)).toHaveValue("Exec");

    fireEvent.change(screen.getByLabelText(/dashboard name/i), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Back to view mode, unsaved rename discarded.
    expect(screen.queryByLabelText(/dashboard name/i)).toBeNull();
    expect(screen.getByRole("option", { name: "Exec" })).toBeInTheDocument();
  });

  it("deletes the active dashboard", async () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/dashboards", expect.objectContaining({ method: "PUT" })),
    );
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "/api/dashboards" && (c[1] as RequestInit).method === "PUT",
    );
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ dashboards: [] });
  });

  it("removes a widget from the draft", () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "projectCount" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText("Remove widget")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove widget"));
    expect(screen.queryByLabelText("Remove widget")).toBeNull();
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
  });

  it("switching the dashboard selector shows the other dashboard's widgets", () => {
    const dashes: Dashboard[] = [
      { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "projectCount" }] },
      { id: "d2", name: "Ops", widgets: [] },
    ];
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: dashes }) });
    expect(screen.getByTestId("dashboard-grid")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Select dashboard"), { target: { value: "d2" } });
    expect(screen.getByTestId("dashboard-empty")).toBeInTheDocument();
  });

  it("exports the active dashboard as a downloaded JSON file", () => {
    const { click, restore } = mockBlobDownload();
    try {
      const dash: Dashboard = { id: "d1", name: "Exec", widgets: [] };
      renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
      fireEvent.click(screen.getByRole("button", { name: /^export$/i }));
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("sets and clears the auto-refresh interval in the draft, showing/hiding the Live badge", () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const refresh = screen.getByLabelText("Auto-refresh interval");
    fireEvent.change(refresh, { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    // Cancel discards the draft change — no live badge since the saved dashboard has no refreshMs.
    expect(screen.queryByTestId("dashboard-live")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText("Auto-refresh interval"), { target: { value: "60000" } });
    fireEvent.change(screen.getByLabelText("Auto-refresh interval"), { target: { value: "0" } });
    expect((screen.getByLabelText("Auto-refresh interval") as HTMLSelectElement).value).toBe("0");
  });

  it("polls (invalidates active queries) on the dashboard's refresh cadence while live", () => {
    vi.useFakeTimers();
    try {
      const dash: Dashboard = { id: "d1", name: "Ops", widgets: [{ id: "w1", type: "projectCount" }], refreshMs: 30_000 };
      const client = seed({ dashboards: [dash], projects: [project()] });
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");
      renderWithProviders(<Dashboards />, { client });
      expect(invalidateSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30_000);
      expect(invalidateSpy).toHaveBeenCalledWith({ refetchType: "active" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an alert when saving a LEGACY dashboard fails (settings path retained pre-migration)", async () => {
    mockFetchRouter({ "PUT /api/dashboards": { ok: false, status: 500, body: { message: "boom" } } });
    try {
      // A pre-existing settings-bundle dashboard still saves via the legacy path until migrated.
      renderWithProviders(<Dashboards />, { client: seed({ dashboards: [{ id: "d1", name: "Legacy", widgets: [] }] }) });
      fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    } finally {
      resetFetchMock();
    }
  });

  it("imports a valid dashboard file and selects it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    // The visible "Import" button forwards the click to the hidden file input.
    fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
    const file = new File(
      [JSON.stringify({ name: "Imported", widgets: [] })],
      "dash.json",
      { type: "application/json" },
    );
    await user.upload(screen.getByLabelText(/import dashboard file/i), file);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/defs", expect.objectContaining({ method: "POST" })),
    );
  });

  it("shows a friendly error for an invalid dashboard file", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [] }) });
    const file = new File(["not json"], "dash.json", { type: "application/json" });
    await user.upload(screen.getByLabelText(/import dashboard file/i), file);
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid json/i);
  });

  it("formats a non-standard refresh interval in the Live badge (refreshLabel fallback)", () => {
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [{ id: "d1", name: "Ops", widgets: [], refreshMs: 45_000 }] }) });
    // 45000ms isn't one of the preset options → the label falls back to a computed "45s".
    expect(screen.getByTestId("dashboard-live")).toHaveTextContent("45s");
  });

  it("labels an unknown widget by its raw type in edit mode", () => {
    const dash: Dashboard = { id: "d1", name: "Legacy", widgets: [{ id: "w1", type: "goneWidget" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // widgetDef(type)?.label ?? type — the unknown type has no def, so the raw type is shown.
    expect(screen.getByText("goneWidget")).toBeInTheDocument();
  });

  it("ignores the placeholder options in the add-widget and preset selects", () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [{ id: "w1", type: "projectCount" }] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    // Selecting the empty preset placeholder is a no-op (guarded onChange).
    fireEvent.change(screen.getByLabelText("Apply a preset"), { target: { value: "" } });
    expect(screen.getByTestId("dashboard-grid")).toBeInTheDocument();
    // In edit mode, re-selecting the "+ Add widget…" placeholder adds nothing.
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/add widget/i), { target: { value: "" } });
    expect(screen.getAllByLabelText(/remove widget/i)).toHaveLength(1);
  });

  it("no-ops a reorder at the list boundary", () => {
    const dash: Dashboard = { id: "d1", name: "Exec", widgets: [
      { id: "w1", type: "projectCount", span: 1 },
      { id: "w2", type: "statusBreakdown", span: 1 },
    ] };
    renderWithProviders(<Dashboards />, { client: seed({ dashboards: [dash] }) });
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // Moving the first widget up (j = -1) and the last widget down (j >= length) both return early.
    fireEvent.click(screen.getAllByLabelText("Move up")[0]!);
    fireEvent.click(screen.getAllByLabelText("Move down")[1]!);
    // Both widgets survive, order untouched.
    expect(screen.getAllByLabelText(/remove widget/i)).toHaveLength(2);
  });
});
