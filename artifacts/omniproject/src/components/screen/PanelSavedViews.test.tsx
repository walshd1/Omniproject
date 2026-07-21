import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { settingsQueryKey } from "../../lib/settings-query";
import { PanelSavedViews } from "./PanelSavedViews";
import type { ControlsState } from "../../lib/panel-controls";
import type { PanelView } from "../../lib/panel-views";

/**
 * PanelSavedViews — the per-panel saved-view bar. It reads the org's panelViews (a slice of /api/settings),
 * lets an authorised user save the current control state under a name (PUT /api/panel-views) and recall a
 * saved view (apply its state). Gated by the panelViews edit-policy: a viewer can recall but not save.
 */
const STATE: ControlsState = { groupBy: "period:year", agg: "sum", filters: { currency: ["GBP"] } };

function seed(role: string | undefined, views: PanelView[] = [], editRoles: Record<string, string> = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(settingsQueryKey, { panelViews: views, collectionEditRoles: editRoles });
  return qc;
}

const savedView: PanelView = { id: "budget-plans:p1:by-year", label: "By year", screen: "budget-plans", panel: "p1", state: STATE };

afterEach(() => vi.restoreAllMocks());

describe("PanelSavedViews", () => {
  it("saves the current control state under a name (PUT /api/panel-views, upsert by scope)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const state: ControlsState = { groupBy: "currency", agg: "count", filters: {} };
    renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={state} onApply={() => {}} />, { client: seed("contributor") });
    fireEvent.change(screen.getByTestId("saved-view-label"), { target: { value: "By currency" } });
    fireEvent.click(screen.getByTestId("saved-view-save"));
    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => u === "/api/panel-views" && (i as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string) as { panelViews: PanelView[] };
    expect(body.panelViews).toHaveLength(1);
    expect(body.panelViews[0]).toMatchObject({ screen: "budget-plans", panel: "p1", label: "By currency", state });
    expect(body.panelViews[0]!.id).toBe("budget-plans:p1:by-currency");
  });

  it("recalls a saved view by applying its state", () => {
    const onApply = vi.fn();
    renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={STATE} onApply={onApply} />, { client: seed("contributor", [savedView]) });
    fireEvent.change(screen.getByTestId("saved-view-select"), { target: { value: savedView.id } });
    expect(onApply).toHaveBeenCalledWith(STATE);
  });

  it("only shows views scoped to this screen+panel", () => {
    const other: PanelView = { ...savedView, id: "other:p9:x", screen: "other", panel: "p9", label: "Elsewhere" };
    renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={STATE} onApply={() => {}} />, { client: seed("contributor", [savedView, other]) });
    const opts = Array.from(screen.getByTestId("saved-view-select").querySelectorAll("option")).map((o) => o.textContent);
    expect(opts).toContain("By year");
    expect(opts).not.toContain("Elsewhere");
  });

  it("a viewer may recall but not save", () => {
    renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={STATE} onApply={() => {}} />, { client: seed("viewer", [savedView]) });
    expect(screen.getByTestId("saved-view-select")).toBeInTheDocument();
    expect(screen.queryByTestId("saved-view-save")).not.toBeInTheDocument();
  });

  it("a read-only policy hides the save controls even for a manager", () => {
    renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={STATE} onApply={() => {}} />, { client: seed("manager", [savedView], { panelViews: "readonly" }) });
    expect(screen.queryByTestId("saved-view-save")).not.toBeInTheDocument();
  });

  it("renders nothing for a viewer with no saved views", () => {
    const { container } = renderWithProviders(<PanelSavedViews screen="budget-plans" panel="p1" state={STATE} onApply={() => {}} />, { client: seed("viewer") });
    expect(container.querySelector('[data-testid="panel-saved-views"]')).toBeNull();
  });
});
