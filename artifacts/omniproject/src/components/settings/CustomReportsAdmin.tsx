import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useAvailability } from "../../lib/availability";
import { reportCatalogue, type ReportDefinition } from "@workspace/backend-catalogue";
import { useLegacyCustomReports, useDrainLegacyCustomReports, customReportsQueryKey } from "../../lib/custom-reports-api";
import { useResolvedDefs, useImportDef, useUpdateDef, useDeleteDef } from "../../lib/defs";
import { taskDescriptor } from "../../lib/view-engine/task-descriptor";
import type { CustomReportDef, CustomReportMetric, CustomReportAgg } from "../../lib/custom-report";
import { downloadReportDef, downloadJson, readReportDefFile, uniqueReportId } from "../../lib/custom-report-file";
import { resolveReportRenderer } from "../reports/report-renderers";
import { useReportOverrides, useSaveReportOverrides, type ReportOverride } from "../../lib/report-overrides";
import type { Predicate, ConditionSet } from "../../lib/rate-card";
import { useDraftAdmin } from "../../hooks/use-draft-admin";
import { PredicateEditor } from "./PredicateEditor";
import { StyleEditor } from "../artifact/StyleEditor";
import { PrimitiveLibrary } from "../artifact/PrimitiveLibrary";

/** A one-line description of how a report is realised, from its `renderer`. */
function rendererLabel(def: ReportDefinition): string {
  const r = def.renderer;
  if (r.surfacedVia) return `surfaced via ${r.surfacedVia}`;
  if (r.engine === "custom") return "no-code engine";
  return resolveReportRenderer(def) ? `built-in · ${r.component}` : `built-in · ${r.component} (unregistered!)`;
}

/** Editable listing of the shipped (built-in) report files. Rendering is code (a registered renderer),
 *  so the renderer is shown read-only; the editable METADATA (label, order, visibility) is saved as a
 *  per-id override merged over the catalogue — a customer can rename/reorder/hide a built-in without a
 *  rebuild. Each file is also exportable as a JSON definition. */
function BuiltInReportFiles() {
  const reports = reportCatalogue();
  const { data: server } = useReportOverrides();
  const save = useSaveReportOverrides();
  const [draft, setDraft] = useState<Record<string, ReportOverride>>({});

  useEffect(() => { if (server) setDraft(Object.fromEntries(server.map((o) => [o.id, o]))); }, [server]);

  const patch = (id: string, o: Partial<ReportOverride>) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], id, ...o } }));

  // Only send overrides that actually change something (a non-empty label/order/hidden).
  const effective = Object.values(draft).filter((o) => (o.label && o.label.trim()) || o.order != null || o.hidden);
  const dirty = JSON.stringify(effective.sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify([...(server ?? [])].sort((a, b) => a.id.localeCompare(b.id)));

  return (
    <details className="border border-border" data-testid="builtin-report-files">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
        Built-in report files ({reports.length})
      </summary>
      <div className="divide-y divide-border/60">
        {reports.map((r) => {
          const o = draft[r.id] ?? { id: r.id };
          const hidden = o.hidden ?? false;
          return (
            <div key={r.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs ${hidden ? "opacity-50" : ""}`} data-testid={`builtin-report-${r.id}`}>
              <Input aria-label={`${r.id} label`} className="flex-1 min-w-40 h-7 rounded-none border border-border text-xs"
                placeholder={r.label} value={o.label ?? ""} onChange={(e) => patch(r.id, { label: e.target.value })} />
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">{r.kind}</span>
              <span className="text-muted-foreground font-mono">{rendererLabel(r)}</span>
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                order
                <Input aria-label={`${r.id} order`} type="number" className="w-16 h-7 rounded-none border border-border text-xs"
                  value={o.order ?? r.order} onChange={(e) => patch(r.id, { order: Number(e.target.value) })} />
              </label>
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                <input type="checkbox" aria-label={`Hide ${r.id}`} checked={hidden} onChange={(e) => patch(r.id, { hidden: e.target.checked })} />
                hide
              </label>
              <Button variant="ghost" className="rounded-none text-[11px] px-2" aria-label={`Export ${r.label} definition`}
                onClick={() => downloadJson(r, `report-${r.id}.json`)}>Export</Button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 px-3 py-2 border-t border-border">
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider text-xs"
          onClick={() => save.mutate(effective)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save overrides"}
        </Button>
        <span className="text-[11px] text-muted-foreground">Rename, reorder or hide a built-in report — merged over the catalogue, no rebuild.</span>
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </details>
  );
}

/**
 * Report generator — the PMO builds bespoke reports without code: pick a scope, an optional filter
 * (predicate), a group-by field and aggregated metrics, and a viz. Saved as settings.customReports and
 * rendered through the generic CustomReport renderer on the Reports page. PMO-gated, mirroring the server.
 */

const AGGS: CustomReportAgg[] = ["sum", "avg", "count", "min", "max"];

export function CustomReportsAdmin() {
  const { data: auth } = useAuth();
  const { data: availability } = useAvailability();
  // Report defs are ARTIFACTS in the def store; edit the ORG-scoped `report` defs through the importer.
  // Memoised so the derived arrays keep a stable identity across renders (useDraftAdmin re-syncs on change).
  const { data: defs } = useResolvedDefs<CustomReportDef>("report");
  const orgReportDefs = useMemo(() => (Array.isArray(defs) ? defs : []).filter((d) => d.id.startsWith("org~")), [defs]);
  const scopedIdByReportId = useMemo(() => new Map(orgReportDefs.map((d) => [(d.payload as CustomReportDef).id, d.id])), [orgReportDefs]);
  const server = useMemo(() => orgReportDefs.map((d) => d.payload as CustomReportDef), [orgReportDefs]);
  const importDef = useImportDef();
  const updateDef = useUpdateDef();
  const deleteDef = useDeleteDef();
  const qc = useQueryClient();
  const { data: legacy } = useLegacyCustomReports();
  const drain = useDrainLegacyCustomReports();
  const savingReports = importDef.isPending || updateDef.isPending || deleteDef.isPending || drain.isPending;
  const { draft, setDraft, dirty, reset } = useDraftAdmin<CustomReportDef[], CustomReportDef[]>(server, structuredClone);
  const [importError, setImportError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  const fields = availability?.available ?? [];
  // Task reports report over the GTD task entity, so their field options come from the task
  // descriptor (same field catalog the view builder uses) rather than the issue/project superset.
  const taskFields = taskDescriptor.fields.map((f) => f.key);
  const fieldsForScope = (scope: CustomReportDef["scope"]) => (scope === "tasks" ? taskFields : fields);
  const patch = (i: number, r: CustomReportDef) => setDraft(draft.map((x, j) => (j === i ? r : x)));

  function addReport() {
    setDraft([...draft!, { id: `report-${draft!.length + 1}`, label: `Report ${draft!.length + 1}`, scope: "project", metrics: [{ id: "m1", field: fields[0] ?? "budget", agg: "count" }], viz: "table" }]);
  }
  function patchMetric(ri: number, mi: number, m: Partial<CustomReportMetric>) {
    const r = draft![ri]!;
    patch(ri, { ...r, metrics: r.metrics.map((x, j) => (j === mi ? { ...x, ...m } : x)) });
  }
  /** Import report definition file(s) — validate each and append with a collision-safe id. */
  async function importFile(file: File | undefined) {
    setImportError(null);
    if (!file) return;
    try {
      const incoming = await readReportDefFile(file);
      const next = [...draft!];
      for (const def of incoming) next.push({ ...def, id: uniqueReportId(def, next.map((d) => d.id)) });
      setDraft(next);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not import that file.");
    }
  }

  // A save is a per-def upsert against the loaded org report defs: PUT an existing report's def in place, POST
  // a new one, DELETE a removed one — all through the importer choke point.
  const legacyReports = legacy ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: customReportsQueryKey });
  const onSaveReports = async () => {
    if (!draft) return;
    setSaveError(null);
    try {
      const draftIds = new Set(draft.map((r) => r.id));
      for (const r of draft) {
        const scopedId = scopedIdByReportId.get(r.id);
        if (scopedId) await updateDef.mutateAsync({ id: scopedId, name: r.label ?? r.id, payload: r });
        else await importDef.mutateAsync({ kind: "report", storage: "org", name: r.label ?? r.id, payload: r });
      }
      for (const d of orgReportDefs) if (!draftIds.has((d.payload as CustomReportDef).id)) await deleteDef.mutateAsync(d.id);
      await invalidate();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save reports.");
    }
  };
  // One-shot migration of any pre-convergence `settings.customReports` into the def store, then drain the slice.
  const migrateLegacy = async () => {
    setSaveError(null);
    try {
      for (const r of legacyReports) if (!scopedIdByReportId.has(r.id)) await importDef.mutateAsync({ kind: "report", storage: "org", name: r.label ?? r.id, payload: r });
      await drain.mutateAsync();
      await invalidate();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not migrate legacy reports.");
    }
  };

  return (
    <section className="space-y-4" data-testid="custom-reports-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Report generator</h2>
        <p className="text-xs text-muted-foreground">
          Build your own reports — filter, group by a field (optionally a second level for a pivot), and
          aggregate metrics, or trend a metric by month. They render on the Reports page (project or
          portfolio). No code; the definition travels in your config bundle.
        </p>
      </div>

      <BuiltInReportFiles />

      <details className="border border-border rounded-md p-2">
        <summary className="text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer">Primitive library — what you can build from</summary>
        <div className="mt-3">
          <PrimitiveLibrary />
        </div>
      </details>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="custom-reports-empty">No bespoke reports yet — add one.</p>
      )}

      {draft.map((r, i) => {
        const rf = fieldsForScope(r.scope);
        return (
        <div key={i} className="border-2 border-foreground p-3 space-y-3" data-testid={`custom-report-edit-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label={`Report ${i + 1} label`} placeholder="Report name" className="flex-1 min-w-44 rounded-none border-2 border-foreground"
              value={r.label} onChange={(e) => patch(i, { ...r, label: e.target.value })} />
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Scope</span>
              <select aria-label={`Report ${i + 1} scope`} className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs"
                value={r.scope} onChange={(e) => patch(i, { ...r, scope: e.target.value as CustomReportDef["scope"] })}>
                <option value="project">Project</option>
                <option value="portfolio">Portfolio</option>
                <option value="tasks">Tasks</option>
              </select>
            </label>
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Chart</span>
              <select aria-label={`Report ${i + 1} viz`} className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs"
                value={r.viz} onChange={(e) => patch(i, { ...r, viz: e.target.value as CustomReportDef["viz"] })}>
                <option value="table">Table</option>
                <option value="bar">Bar</option>
                <option value="line">Line (trend)</option>
                <option value="area">Area (trend)</option>
                <option value="pie">Pie (share)</option>
              </select>
            </label>
            {r.viz !== "table" && (
              <>
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={r.chart?.legend !== false} onChange={(e) => patch(i, { ...r, chart: { ...r.chart, legend: e.target.checked } })} aria-label={`Report ${i + 1} show legend`} />
                  <span className="text-muted-foreground">Legend</span>
                </label>
                {(r.viz === "bar" || r.viz === "area") && (
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={r.chart?.stacked === true} onChange={(e) => patch(i, { ...r, chart: { ...r.chart, stacked: e.target.checked } })} aria-label={`Report ${i + 1} stacked`} />
                    <span className="text-muted-foreground">Stacked</span>
                  </label>
                )}
              </>
            )}
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" aria-label={`Export report ${i + 1}`}
              onClick={() => downloadReportDef({ ...r, id: r.id || uniqueReportId(r, []) })}>Export</Button>
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove</Button>
          </div>

          {r.viz === "line" || r.viz === "area" ? (
            <label className="text-xs flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Date field (bucketed by month)</span>
              <select aria-label={`Report ${i + 1} date field`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                value={r.dateField ?? ""} onChange={(e) => { const { dateField: _d, ...rest } = r; patch(i, e.target.value ? { ...rest, dateField: e.target.value } : rest); }}>
                <option value="">(choose a date field)</option>
                {rf.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="text-xs flex items-center gap-2">
                <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Group by</span>
                <select aria-label={`Report ${i + 1} group by`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                  value={r.groupBy ?? ""} onChange={(e) => { const { groupBy: _d, groupBy2: _d2, ...rest } = r; patch(i, e.target.value ? { ...rest, groupBy: e.target.value } : rest); }}>
                  <option value="">(no grouping — single total)</option>
                  {rf.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              {r.groupBy && (
                <label className="text-xs flex items-center gap-2">
                  <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Then by (pivot columns) — optional</span>
                  <select aria-label={`Report ${i + 1} group by 2`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                    value={r.groupBy2 ?? ""} onChange={(e) => { const { groupBy2: _d, ...rest } = r; patch(i, e.target.value ? { ...rest, groupBy2: e.target.value } : rest); }}>
                    <option value="">(single level)</option>
                    {rf.filter((f) => f !== r.groupBy).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              )}
            </>
          )}

          <div className="pl-2 border-l-2 border-border space-y-1.5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Metrics</p>
            {r.metrics.map((m, mi) => (
              <div key={mi} className="flex flex-wrap items-center gap-2" data-testid={`custom-report-${i}-metric-${mi}`}>
                <select aria-label={`Report ${i + 1} metric ${mi + 1} agg`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                  value={m.agg} onChange={(e) => patchMetric(i, mi, { agg: e.target.value as CustomReportAgg })}>
                  {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <span className="text-[10px] text-muted-foreground">of</span>
                <select aria-label={`Report ${i + 1} metric ${mi + 1} field`} className="rounded-none border border-border bg-background px-2 py-1 text-xs" disabled={m.agg === "count"}
                  value={m.field} onChange={(e) => patchMetric(i, mi, { field: e.target.value })}>
                  {rf.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <Input aria-label={`Report ${i + 1} metric ${mi + 1} label`} placeholder="label (optional)" className="w-40 rounded-none border border-border text-xs"
                  value={m.label ?? ""} onChange={(e) => patchMetric(i, mi, { label: e.target.value })} />
                <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Remove metric ${mi + 1} from report ${i + 1}`}
                  onClick={() => patch(i, { ...r, metrics: r.metrics.length > 1 ? r.metrics.filter((_, j) => j !== mi) : r.metrics })}>✕</Button>
              </div>
            ))}
            <Button variant="outline" className="rounded-none border border-border text-xs"
              onClick={() => patch(i, { ...r, metrics: [...r.metrics, { id: `m${r.metrics.length + 1}`, field: rf[0] ?? "budget", agg: "sum" }] })}>+ metric</Button>
          </div>

          <div className="pl-2 border-l-2 border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Filter (all of) — optional</p>
            <PredicateEditor idPrefix={`creport-${i}`} fieldOptions={rf}
              value={r.filter?.all ?? []}
              onChange={(preds: Predicate[]) => { const { filter: _d, ...rest } = r; const filter: ConditionSet = { all: preds }; patch(i, preds.length ? { ...rest, filter } : rest); }} />
          </div>

          <div className="pl-2 border-l-2 border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Style — optional</p>
            <StyleEditor idPrefix={`creport-${i}-style`} value={r.style}
              onChange={(style) => { const { style: _d, ...rest } = r; patch(i, style ? { ...rest, style } : rest); }} />
          </div>
        </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addReport}>+ report</Button>
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => fileRef.current?.click()}>Import file…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import report definition"
          onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {draft.length > 0 && (
          <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => downloadReportDef(draft)}>Export all</Button>
        )}
        {legacyReports.length > 0 && (
          <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={migrateLegacy} disabled={savingReports} data-testid="reports-migrate-legacy">
            Migrate {legacyReports.length} legacy report{legacyReports.length === 1 ? "" : "s"}
          </Button>
        )}
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={onSaveReports} disabled={!dirty || savingReports}>
          {savingReports ? "Saving…" : "Save reports"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={reset}>Reset</Button>}
        {importError && <span role="alert" className="text-xs font-bold text-red-500">{importError}</span>}
        {saveError && <span role="alert" className="text-xs font-bold text-red-500">{saveError}</span>}
      </div>
    </section>
  );
}
