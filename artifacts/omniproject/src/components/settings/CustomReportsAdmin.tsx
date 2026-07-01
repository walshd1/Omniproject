import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, roleAtLeast } from "../../lib/auth";
import { useAvailability } from "../../lib/availability";
import { useCustomReports, useSaveCustomReports } from "../../lib/custom-reports-api";
import type { CustomReportDef, CustomReportMetric, CustomReportAgg } from "../../lib/custom-report";
import { downloadReportDef, readReportDefFile, uniqueReportId } from "../../lib/custom-report-file";
import type { Predicate, ConditionSet } from "../../lib/rate-card";
import { PredicateEditor } from "./PredicateEditor";

/**
 * Report generator — the PMO builds bespoke reports without code: pick a scope, an optional filter
 * (predicate), a group-by field and aggregated metrics, and a viz. Saved as settings.customReports and
 * rendered through the generic CustomReport renderer on the Reports page. PMO-gated, mirroring the server.
 */

const AGGS: CustomReportAgg[] = ["sum", "avg", "count", "min", "max"];

export function CustomReportsAdmin() {
  const { data: auth } = useAuth();
  const { data: server } = useCustomReports();
  const { data: availability } = useAvailability();
  const save = useSaveCustomReports();
  const [draft, setDraft] = useState<CustomReportDef[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (server) setDraft(structuredClone(server)); }, [server]);

  if (!roleAtLeast(auth?.role, "pmo")) return null;
  if (!draft) return null;

  const fields = availability?.available ?? [];
  const patch = (i: number, r: CustomReportDef) => setDraft(draft.map((x, j) => (j === i ? r : x)));
  const dirty = JSON.stringify(draft) !== JSON.stringify(server);

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

  return (
    <section className="space-y-4" data-testid="custom-reports-admin">
      <div>
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Report generator</h2>
        <p className="text-xs text-muted-foreground">
          Build your own reports — filter, group by a field, and aggregate metrics. They render on the Reports
          page (project or portfolio). No code; the definition travels in your config bundle.
        </p>
      </div>

      {draft.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-4" data-testid="custom-reports-empty">No bespoke reports yet — add one.</p>
      )}

      {draft.map((r, i) => (
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
              </select>
            </label>
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Chart</span>
              <select aria-label={`Report ${i + 1} viz`} className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs"
                value={r.viz} onChange={(e) => patch(i, { ...r, viz: e.target.value as CustomReportDef["viz"] })}>
                <option value="table">Table</option>
                <option value="bar">Bar</option>
              </select>
            </label>
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" aria-label={`Export report ${i + 1}`}
              onClick={() => downloadReportDef({ ...r, id: r.id || uniqueReportId(r, []) })}>Export</Button>
            <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Remove</Button>
          </div>

          <label className="text-xs flex items-center gap-2">
            <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Group by</span>
            <select aria-label={`Report ${i + 1} group by`} className="rounded-none border border-border bg-background px-2 py-1 text-xs"
              value={r.groupBy ?? ""} onChange={(e) => { const { groupBy: _d, ...rest } = r; patch(i, e.target.value ? { ...rest, groupBy: e.target.value } : rest); }}>
              <option value="">(no grouping — single total)</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

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
                  {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <Input aria-label={`Report ${i + 1} metric ${mi + 1} label`} placeholder="label (optional)" className="w-40 rounded-none border border-border text-xs"
                  value={m.label ?? ""} onChange={(e) => patchMetric(i, mi, { label: e.target.value })} />
                <Button variant="ghost" className="rounded-none text-xs px-2" aria-label={`Remove metric ${mi + 1} from report ${i + 1}`}
                  onClick={() => patch(i, { ...r, metrics: r.metrics.length > 1 ? r.metrics.filter((_, j) => j !== mi) : r.metrics })}>✕</Button>
              </div>
            ))}
            <Button variant="outline" className="rounded-none border border-border text-xs"
              onClick={() => patch(i, { ...r, metrics: [...r.metrics, { id: `m${r.metrics.length + 1}`, field: fields[0] ?? "budget", agg: "sum" }] })}>+ metric</Button>
          </div>

          <div className="pl-2 border-l-2 border-border">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Filter (all of) — optional</p>
            <PredicateEditor idPrefix={`creport-${i}`} fieldOptions={fields}
              value={r.filter?.all ?? []}
              onChange={(preds: Predicate[]) => { const { filter: _d, ...rest } = r; const filter: ConditionSet = { all: preds }; patch(i, preds.length ? { ...rest, filter } : rest); }} />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={addReport}>+ report</Button>
        <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => fileRef.current?.click()}>Import file…</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Import report definition"
          onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {draft.length > 0 && (
          <Button variant="outline" className="rounded-none border-2 border-foreground font-bold uppercase text-xs" onClick={() => downloadReportDef(draft)}>Export all</Button>
        )}
        <Button className="rounded-none border-2 border-foreground font-bold uppercase tracking-wider" onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save reports"}
        </Button>
        {dirty && <Button variant="ghost" className="rounded-none text-xs" onClick={() => server && setDraft(structuredClone(server))}>Reset</Button>}
        {importError && <span role="alert" className="text-xs font-bold text-red-500">{importError}</span>}
        {save.isError && <span role="alert" className="text-xs font-bold text-red-500">{(save.error as Error).message}</span>}
      </div>
    </section>
  );
}
