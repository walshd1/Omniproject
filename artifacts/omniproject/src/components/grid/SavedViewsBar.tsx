import { useState } from "react";
import { useSavedViews, useSaveViews, type SavedView } from "../../lib/saved-views";

/**
 * Saved-views switcher for a surface (e.g. the grid): pick a saved view to apply, save the current
 * columns/sort as a new named view, or delete one. Views are shared customer-level config; saving
 * writes the full list back to /api/views (→ the config bundle).
 */
export function SavedViewsBar({
  scope,
  current,
  onApply,
}: {
  scope: string;
  current: { columns: string[]; sort: { field: string; dir: "asc" | "desc" } | null };
  onApply: (view: SavedView) => void;
}) {
  const { data: all } = useSavedViews();
  const save = useSaveViews();
  const views = (all ?? []).filter((v) => !v.scope || v.scope === scope);
  const [delSel, setDelSel] = useState("");

  function apply(id: string) {
    const view = views.find((v) => v.id === id);
    if (view) onApply(view);
  }
  function saveCurrent() {
    const name = window.prompt("Save view as…")?.trim();
    if (!name) return;
    const view: SavedView = {
      id: crypto.randomUUID(),
      name,
      scope,
      columns: current.columns,
      ...(current.sort ? { sort: current.sort } : {}),
    };
    save.mutate([...(all ?? []), view]);
  }
  function remove(id: string) {
    save.mutate((all ?? []).filter((v) => v.id !== id));
  }

  return (
    <div className="mb-3 flex items-center gap-2 text-xs" data-testid="saved-views-bar">
      <label className="font-bold uppercase tracking-wider">View</label>
      <select
        aria-label="Saved view"
        onChange={(e) => e.target.value && apply(e.target.value)}
        defaultValue=""
        className="border border-foreground bg-background px-1 py-0.5"
      >
        <option value="">— choose —</option>
        {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <button onClick={saveCurrent} disabled={save.isPending} className="border-2 border-foreground px-2 py-0.5 font-bold uppercase">
        Save view
      </button>
      {views.length > 0 && (
        <select
          aria-label="Delete saved view"
          value={delSel}
          onChange={(e) => {
            const id = e.target.value;
            setDelSel(""); // controlled + reset so re-picking the same view re-fires
            if (!id) return;
            const v = views.find((x) => x.id === id);
            // Shared, customer-level config — confirm before deleting for everyone.
            if (typeof window !== "undefined" && !window.confirm(`Delete the shared saved view "${v?.name ?? id}"? This removes it for everyone.`)) return;
            remove(id);
          }}
          className="border border-foreground bg-background px-1 py-0.5"
        >
          <option value="">delete…</option>
          {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
      {save.isError && <span role="alert" className="font-bold text-red-500">{(save.error as Error).message}</span>}
    </div>
  );
}
