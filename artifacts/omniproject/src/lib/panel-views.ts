import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { slug } from "./slug";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { ControlsState } from "./panel-controls";

/**
 * Org-saved PANEL VIEWS client. A user saves a filtered/pivoted view off a panel's control bar; it is stored
 * in the org's (encrypted) config via /api/panel-views, scoped to the screen+panel it came from, and offered
 * back on that panel to recall the view. Reads are a slice of the shared /api/settings query; writes replace
 * the whole list and follow the collection edit-policy server-side (default user-editable). Never project
 * data — this is presentation config that rides the config-bundle snapshot.
 */
export interface PanelView {
  id: string;
  label: string;
  screen: string;
  panel: string;
  state: ControlsState;
}

/** The full saved-view list for the deployment. */
export function usePanelViews() {
  return useSettingsSlice((s) => (Array.isArray(s["panelViews"]) ? (s["panelViews"] as PanelView[]) : []));
}

/** Persist the full panel-views list (CSRF attached by the global fetch patch). Edit-policy gated server-side. */
export function useSavePanelViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (panelViews: PanelView[]) => sendJson<unknown>("/api/panel-views", { panelViews }, "PUT", "Failed to save view"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}

/** The saved views scoped to one panel (a given screen + panel id), in insertion order. */
export function viewsForPanel(views: readonly PanelView[], screen: string, panel: string): PanelView[] {
  return views.filter((v) => v.screen === screen && v.panel === panel);
}

/** A stable-ish id for a new saved view. Derived from the scope + label so re-saving the same name upserts. */
export function panelViewId(screen: string, panel: string, label: string): string {
  return `${screen}:${panel}:${slug(label, "view")}`;
}
