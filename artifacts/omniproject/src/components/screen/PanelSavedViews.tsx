import { useState } from "react";
import { useAuth, roleAtLeast, type Role } from "../../lib/auth";
import { useSettingsSlice } from "../../lib/settings-query";
import { usePanelViews, useSavePanelViews, viewsForPanel, panelViewId, type PanelView } from "../../lib/panel-views";
import type { ControlsState } from "../../lib/panel-controls";

/**
 * Saved-views bar for a controllable panel. Lets a user RECALL a previously-saved filtered/pivoted view
 * (apply its control state) and — subject to the `panelViews` edit-policy (default user-editable) — SAVE the
 * current control state under a name, or delete one. Views are scoped to this `screen`+`panel` and persisted
 * in the org's config store. Rendered only when a panel carries a screen scope (so read-only/legacy panels
 * and unit tests that don't wrap a query client are unaffected — the panels gate this on that scope).
 */
export function PanelSavedViews({ screen, panel, state, onApply }: {
  screen: string;
  panel: string;
  state: ControlsState;
  onApply: (next: ControlsState) => void;
}) {
  const { data: views } = usePanelViews();
  const save = useSavePanelViews();
  const { data: auth } = useAuth();
  const { data: policy } = useSettingsSlice((s) => {
    const map = (s["collectionEditRoles"] ?? {}) as Record<string, string>;
    return typeof map["panelViews"] === "string" ? map["panelViews"] : undefined;
  });
  const effective = (policy ?? "contributor") as Role | "readonly";
  const canEdit = effective !== "readonly" && roleAtLeast(auth?.role, effective as Role);

  const mine = viewsForPanel(views ?? [], screen, panel);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("");

  const apply = (id: string) => {
    setSelected(id);
    const v = mine.find((x) => x.id === id);
    if (v) onApply(v.state);
  };

  const doSave = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = panelViewId(screen, panel, trimmed);
    const entry: PanelView = { id, label: trimmed, screen, panel, state };
    // Upsert by id so re-saving the same name overwrites rather than duplicating.
    const next = [...(views ?? []).filter((v) => v.id !== id), entry];
    save.mutate(next);
    setLabel("");
    setSelected(id);
  };

  const doDelete = () => {
    if (!selected) return;
    save.mutate((views ?? []).filter((v) => v.id !== selected));
    setSelected("");
  };

  // Nothing to show for a viewer with no saved views yet.
  if (mine.length === 0 && !canEdit) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="panel-saved-views">
      {mine.length > 0 && (
        <label className="flex items-center gap-1 text-muted-foreground">
          View
          <select aria-label="Saved view" data-testid="saved-view-select" value={selected} onChange={(e) => apply(e.target.value)} className="h-7 border border-foreground bg-background px-1 font-bold">
            <option value="">Current</option>
            {mine.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
      )}
      {canEdit && (
        <>
          <input
            aria-label="New view name"
            data-testid="saved-view-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Save current as…"
            className="h-7 w-40 border border-border bg-background px-1"
          />
          <button type="button" data-testid="saved-view-save" onClick={doSave} disabled={!label.trim() || save.isPending} className="h-7 border border-foreground px-2 font-bold disabled:opacity-40">
            Save
          </button>
          {selected && (
            <button type="button" data-testid="saved-view-delete" onClick={doDelete} disabled={save.isPending} className="h-7 border border-border px-2 text-muted-foreground hover:text-foreground disabled:opacity-40">
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
}
