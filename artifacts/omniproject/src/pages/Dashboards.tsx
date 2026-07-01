import { useMemo, useRef, useState } from "react";
import { useGetCapabilities } from "@workspace/api-client-react";
import { canSurfaceEntity } from "../lib/capabilities-fields";
import { useFeatures, featureEnabled } from "../lib/features";
import {
  useDashboards,
  useSaveDashboards,
  availableWidgets,
  widgetDef,
  clampSpan,
  type Dashboard,
  type DashboardWidget,
} from "../lib/dashboards";
import { downloadDashboard, readDashboardFile } from "../lib/dashboard-file";
import { WidgetView } from "../components/dashboard/widgets";
import { DataState } from "../components/DataState";

/**
 * Custom dashboards (the "dashboards" feature module). Build named dashboards from the widget
 * catalogue: add/remove/reorder widgets, set each one's column span, then Save — dashboards are
 * shared, customer-level config persisted to the bundle via /api/dashboards. Widgets read through
 * the existing read-model only; this surface adds no new write paths to project data.
 */

const SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

export function Dashboards() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "dashboards");
  const { data: caps } = useGetCapabilities();
  const { data: dashboards, isLoading, isError, error, refetch } = useDashboards();
  const save = useSaveDashboards();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // The working copy while editing (committed to the server on Save).
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const catalogue = useMemo(
    () => availableWidgets((entity) => canSurfaceEntity(caps, entity)),
    [caps],
  );

  const active = useMemo<Dashboard | null>(() => {
    if (editing && draft) return draft;
    const list = dashboards ?? [];
    if (list.length === 0) return null;
    return list.find((d) => d.id === activeId) ?? list[0]!;
  }, [dashboards, activeId, editing, draft]);

  function persist(next: Dashboard[]) {
    save.mutate(next);
  }

  function startNew() {
    const dash: Dashboard = { id: crypto.randomUUID(), name: "New dashboard", widgets: [] };
    setDraft(dash);
    setActiveId(dash.id);
    setEditing(true);
  }

  function startEdit() {
    if (active) {
      setDraft({ ...active, widgets: active.widgets.map((w) => ({ ...w })) });
      setEditing(true);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(null);
  }

  function saveEdit() {
    if (!draft) return;
    const others = (dashboards ?? []).filter((d) => d.id !== draft.id);
    persist([...others, draft]);
    setEditing(false);
    setDraft(null);
    setActiveId(draft.id);
  }

  function deleteActive() {
    if (!active) return;
    persist((dashboards ?? []).filter((d) => d.id !== active.id));
    setActiveId(null);
    cancelEdit();
  }

  /** Import a dashboard file — validate, mint a fresh id, persist, and select it. */
  async function importFile(file: File | undefined) {
    setImportError(null);
    if (!file) return;
    try {
      const parsed = await readDashboardFile(file);
      const dash: Dashboard = { ...parsed, id: crypto.randomUUID() };
      persist([...(dashboards ?? []), dash]);
      setActiveId(dash.id);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import that file.");
    }
  }

  // --- draft mutators (edit mode only) ---
  function addWidget(type: string) {
    if (!draft) return;
    const def = widgetDef(type);
    const widget: DashboardWidget = { id: crypto.randomUUID(), type, span: def?.defaultSpan ?? 1 };
    setDraft({ ...draft, widgets: [...draft.widgets, widget] });
  }
  function removeWidget(id: string) {
    if (!draft) return;
    setDraft({ ...draft, widgets: draft.widgets.filter((w) => w.id !== id) });
  }
  function move(id: string, dir: -1 | 1) {
    if (!draft) return;
    const i = draft.widgets.findIndex((w) => w.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= draft.widgets.length) return;
    const widgets = [...draft.widgets];
    [widgets[i], widgets[j]] = [widgets[j]!, widgets[i]!];
    setDraft({ ...draft, widgets });
  }
  function setSpan(id: string, span: 1 | 2 | 3) {
    if (!draft) return;
    setDraft({ ...draft, widgets: draft.widgets.map((w) => (w.id === id ? { ...w, span } : w)) });
  }

  if (!enabled) {
    return <div className="p-8 text-sm text-muted-foreground">The “Custom dashboards” module is not enabled.</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 py-4 border-b border-border bg-card shrink-0 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-black uppercase tracking-tighter">Dashboards</h1>

        {!editing && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Select dashboard"
              className="border-2 border-foreground bg-background px-2 py-1 text-sm font-bold"
              value={active?.id ?? ""}
              onChange={(e) => setActiveId(e.target.value)}
            >
              {(dashboards ?? []).length === 0 && <option value="">No dashboards yet</option>}
              {(dashboards ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {active && <button onClick={startEdit} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-foreground">Edit</button>}
            <button onClick={startNew} className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-foreground text-background">New</button>
            {active && <button onClick={() => downloadDashboard(active)} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-foreground">Export</button>}
            <button onClick={() => fileRef.current?.click()} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-foreground">Import</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import dashboard file"
              onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
            {importError && <span role="alert" className="text-xs font-bold text-red-500">{importError}</span>}
          </div>
        )}

        {editing && draft && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Dashboard name"
              className="border-2 border-foreground bg-background px-2 py-1 text-sm font-bold"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <select
              aria-label="Add widget"
              className="border-2 border-foreground bg-background px-2 py-1 text-sm"
              value=""
              onChange={(e) => { if (e.target.value) addWidget(e.target.value); }}
            >
              <option value="">+ Add widget…</option>
              {catalogue.map((w) => (
                <option key={w.type} value={w.type}>{w.label}</option>
              ))}
            </select>
            <button onClick={saveEdit} disabled={save.isPending} className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-foreground text-background disabled:opacity-50">Save</button>
            <button onClick={cancelEdit} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-foreground">Cancel</button>
            <button onClick={deleteActive} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-red-500 text-red-500">Delete</button>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-auto">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {!active ? (
            <p className="text-sm text-muted-foreground" data-testid="dashboards-empty">
              No dashboards yet. Click <span className="font-bold">New</span> to build one from the widget catalogue.
            </p>
          ) : active.widgets.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="dashboard-empty">
              This dashboard has no widgets. {editing ? "Use “Add widget” above." : "Edit it to add some."}
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-[minmax(8rem,auto)]" data-testid="dashboard-grid">
              {active.widgets.map((w) => (
                <div key={w.id} className={SPAN_CLASS[clampSpan(w.span)]}>
                  {editing && (
                    <div className="flex items-center gap-1 mb-1 text-xs">
                      <span className="font-bold uppercase tracking-wider mr-auto">{widgetDef(w.type)?.label ?? w.type}</span>
                      <button onClick={() => move(w.id, -1)} aria-label="Move up" className="px-1 border border-foreground">↑</button>
                      <button onClick={() => move(w.id, 1)} aria-label="Move down" className="px-1 border border-foreground">↓</button>
                      {([1, 2, 3] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setSpan(w.id, s)}
                          aria-label={`Span ${s}`}
                          aria-pressed={clampSpan(w.span) === s}
                          className={`px-1.5 border border-foreground ${clampSpan(w.span) === s ? "bg-foreground text-background" : ""}`}
                        >{s}</button>
                      ))}
                      <button onClick={() => removeWidget(w.id)} aria-label="Remove widget" className="px-1.5 border border-red-500 text-red-500">✕</button>
                    </div>
                  )}
                  <WidgetView type={w.type} />
                </div>
              ))}
            </div>
          )}
        </DataState>
      </div>
    </div>
  );
}
