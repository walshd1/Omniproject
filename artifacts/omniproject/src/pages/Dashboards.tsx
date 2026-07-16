import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCapabilities } from "@workspace/api-client-react";
import { canSurfaceEntity } from "../lib/capabilities-fields";
import { useFeatures, featureEnabled } from "../lib/features";
import {
  useDashboards,
  useSaveDashboards,
  availableWidgets,
  availablePresets,
  dashboardFromPreset,
  widgetDef,
  clampSpan,
  type Dashboard,
  type DashboardWidget,
} from "../lib/dashboards";
import { downloadDashboard, readDashboardFile } from "../lib/dashboard-file";
import { primitivesFor } from "../lib/primitive-store";
import { WidgetView } from "../components/dashboard/widgets";
import { DataState } from "../components/DataState";
import { useToast } from "@/hooks/use-toast";

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

/** Auto-refresh interval choices (ms). "Off" = 0. */
const REFRESH_OPTIONS: { ms: number; label: string }[] = [
  { ms: 0, label: "Off" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
  { ms: 300_000, label: "5m" },
];

function refreshLabel(ms: number | undefined): string {
  return REFRESH_OPTIONS.find((o) => o.ms === (ms ?? 0))?.label ?? `${Math.round((ms ?? 0) / 1000)}s`;
}

export function Dashboards() {
  const { data: features } = useFeatures();
  const enabled = featureEnabled(features, "dashboards");
  const { data: caps } = useGetCapabilities();
  const { data: dashboards, isLoading, isError, error, refetch } = useDashboards();
  const save = useSaveDashboards();
  const { toast } = useToast();

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
  // The add-widget picker is sourced from the ONE shared primitive store (the `component` family placeable
  // on a dashboard), intersected with the capability-available widgets so nothing a backend can't feed is
  // offered. Value is the widget's bare `sourceId` (the type addWidget expects).
  const widgetPrimitives = useMemo(() => {
    const available = new Map(catalogue.map((w) => [w.type, w.label]));
    return primitivesFor("dashboard").filter((p) => p.family === "component" && available.has(p.sourceId));
  }, [catalogue]);

  // Role-tailored "what needs me today" presets whose every widget this backend can surface.
  const presets = useMemo(
    () => availablePresets((entity) => canSurfaceEntity(caps, entity)),
    [caps],
  );

  const active = useMemo<Dashboard | null>(() => {
    if (editing && draft) return draft;
    const list = dashboards ?? [];
    if (list.length === 0) return null;
    return list.find((d) => d.id === activeId) ?? list[0]!;
  }, [dashboards, activeId, editing, draft]);

  // Real-time: when viewing (not editing) a dashboard with a refresh interval, re-read the mounted
  // widgets' data on that cadence. A client-side poll of the existing read model — no new write path.
  const qc = useQueryClient();
  const liveMs = !editing && active?.refreshMs ? active.refreshMs : 0;
  useEffect(() => {
    if (liveMs <= 0) return;
    const t = setInterval(() => { void qc.invalidateQueries({ refetchType: "active" }); }, liveMs);
    return () => clearInterval(t);
  }, [liveMs, qc]);

  function persist(next: Dashboard[], onSuccess: () => void = () => {}) {
    save.mutate(next, {
      onSuccess,
      onError: (e) => toast({ title: "Couldn't save dashboards", description: e instanceof Error ? e.message : "failed", variant: "destructive" }),
    });
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
    const savedId = draft.id;
    persist([...others, draft], () => {
      setEditing(false);
      setDraft(null);
      setActiveId(savedId);
    });
  }

  function deleteActive() {
    if (!active) return;
    persist((dashboards ?? []).filter((d) => d.id !== active.id), () => {
      setActiveId(null);
      cancelEdit();
    });
  }

  /** Apply a role-tailored preset — mint a fresh dashboard from it, persist, and select it. Uses the
   *  same save path as import/create; presets read through the existing read-model widgets only. */
  function applyPreset(presetId: string) {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    const dash: Dashboard = { ...dashboardFromPreset(preset), id: crypto.randomUUID() };
    persist([...(dashboards ?? []), dash], () => setActiveId(dash.id));
  }

  /** Import a dashboard file — validate, mint a fresh id, persist, and select it. */
  async function importFile(file: File | undefined) {
    setImportError(null);
    if (!file) return;
    try {
      const parsed = await readDashboardFile(file);
      const dash: Dashboard = { ...parsed, id: crypto.randomUUID() };
      persist([...(dashboards ?? []), dash], () => setActiveId(dash.id));
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
            {presets.length > 0 && (
              <select
                aria-label="Apply a preset"
                title="Apply a role-tailored “what needs me today” preset"
                className="border-2 border-foreground bg-background px-2 py-1 text-sm"
                value=""
                onChange={(e) => { if (e.target.value) { applyPreset(e.target.value); e.target.value = ""; } }}
              >
                <option value="">Apply a preset…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            {importError && <span role="alert" className="text-xs font-bold text-red-500">{importError}</span>}
            {liveMs > 0 && (
              <span data-testid="dashboard-live" className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-green-600">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live · {refreshLabel(liveMs)}
              </span>
            )}
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
              {widgetPrimitives.map((p) => (
                <option key={p.sourceId} value={p.sourceId}>{p.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              Auto-refresh
              <select aria-label="Auto-refresh interval" className="border-2 border-foreground bg-background px-2 py-1 text-xs"
                value={draft.refreshMs ?? 0}
                onChange={(e) => { const ms = Number(e.target.value); setDraft(ms > 0 ? { ...draft, refreshMs: ms } : (({ refreshMs: _drop, ...rest }) => rest)(draft)); }}>
                {REFRESH_OPTIONS.map((o) => <option key={o.ms} value={o.ms}>{o.label}</option>)}
              </select>
            </label>
            <button onClick={saveEdit} disabled={save.isPending} className="px-3 py-1 text-xs font-bold uppercase tracking-wider bg-foreground text-background disabled:opacity-50">Save</button>
            <button onClick={cancelEdit} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-foreground">Cancel</button>
            <button onClick={deleteActive} disabled={save.isPending} className="px-3 py-1 text-xs font-bold uppercase tracking-wider border-2 border-red-500 text-red-500 disabled:opacity-50">Delete</button>
            {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
          </div>
        )}
      </div>

      <div className="flex-1 p-8 overflow-auto">
        <DataState isLoading={isLoading} isError={isError} error={error} onRetry={refetch}>
          {!active ? (
            <div data-testid="dashboards-empty" className="max-w-3xl">
              <p className="text-sm text-muted-foreground">
                No dashboards yet. Start from a role-tailored <span className="font-bold">“what needs me today”</span> preset,
                or click <span className="font-bold">New</span> to build one from the widget catalogue.
              </p>
              {presets.length > 0 && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="preset-suggestions">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className="text-left border-2 border-foreground p-3 hover:bg-foreground hover:text-background transition-colors"
                    >
                      <span className="block text-sm font-black uppercase tracking-tight">{p.name}</span>
                      <span className="block mt-1 text-xs text-muted-foreground group-hover:text-background">{p.summary}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
