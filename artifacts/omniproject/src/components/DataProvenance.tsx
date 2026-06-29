import { Database, Download } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ProvenanceBadge } from "./ProvenanceBadge";
import {
  fieldCompleteness,
  overallCompleteness,
  sourceBreakdown,
  isPresent,
  toCsv,
  downloadText,
  LINEAGE_COLUMNS,
  type FieldSpec,
} from "../lib/data-lineage";

/**
 * Per-screen data-lineage control: how complete the on-screen data is, which
 * backend(s) it came from, and an export of exactly those rows WITH their
 * provenance columns — so anyone can reverse-engineer where a figure originates
 * and how much of it is actually populated. Drop it in any screen header.
 */
/** Compact "x ago" for the poll timestamp. */
function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function DataProvenance({
  rows,
  fields,
  mode,
  filename,
  exportColumns,
  sourceAccessor,
  fieldSources,
  polledAt,
  label = "Data",
}: {
  rows: ReadonlyArray<Record<string, unknown>>;
  fields: ReadonlyArray<FieldSpec>;
  mode?: string | undefined;
  filename: string;
  /** Columns for the CSV export; defaults to the measured fields + lineage. */
  exportColumns?: ReadonlyArray<FieldSpec>;
  sourceAccessor?: (r: Record<string, unknown>) => unknown;
  /** Per-field lineage from capabilities: canonical key → backend system + field. */
  fieldSources?: Record<string, { system?: string; field?: string }> | undefined;
  /** When the SPA last fetched this screen's data (React Query dataUpdatedAt, ms). */
  polledAt?: number;
  label?: string;
}) {
  const overall = overallCompleteness(rows, fields);
  const perField = fieldCompleteness(rows, fields).sort((a, b) => a.pct - b.pct);
  const sources = sourceBreakdown(rows, sourceAccessor);
  // "Who last touched it" — shown only when the backend actually exposes it.
  const hasEditors = rows.some((r) => isPresent(r["lastUpdatedBy"]));
  const editors = hasEditors ? sourceBreakdown(rows, (r) => r["lastUpdatedBy"]) : [];
  const lineageOf = (key: string): string | null => {
    const s = fieldSources?.[key];
    if (!s?.field) return null;
    return `${s.system ?? mode ?? "backend"}:${s.field}`;
  };
  const cols = exportColumns ?? [...fields, ...LINEAGE_COLUMNS];
  const tone = overall.pct >= 80 ? "text-green-500" : overall.pct >= 50 ? "text-amber-500" : "text-red-500";
  const barTone = overall.pct >= 80 ? "bg-green-500" : overall.pct >= 50 ? "bg-amber-500" : "bg-red-500";

  const exportCsv = () => downloadText(`${filename}.csv`, "text/csv", toCsv(rows, cols));
  const exportJson = () => downloadText(`${filename}.json`, "application/json", JSON.stringify(rows, null, 2));

  return (
    <Popover>
      <PopoverTrigger
        data-testid="data-provenance"
        className="flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-bold uppercase tracking-wider hover:border-primary hover:text-primary"
      >
        <Database className="w-4 h-4" />
        {label}
        <span className={`font-mono ${tone}`} data-testid="data-completeness">{overall.pct}%</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-none border-2 border-border bg-card p-0 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="font-black uppercase tracking-widest">Data source</span>
          <ProvenanceBadge mode={mode} />
        </div>

        {/* Completeness */}
        <div className="border-b border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-wider text-muted-foreground">Completeness</span>
            <span className={`font-black ${tone}`}>{overall.pct}%</span>
          </div>
          <div className="h-2 w-full bg-background border border-border">
            <div className={`h-full ${barTone}`} style={{ width: `${overall.pct}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {overall.present} of {overall.total} cells populated · {overall.rows} rows × {overall.fields} fields
          </p>
          {/* Per-field lineage: where each field comes from + how filled it is. */}
          <ul className="space-y-1.5 pt-1">
            {perField.map((f) => {
              const lineage = lineageOf(f.key);
              return (
                <li key={f.key} data-testid={`field-${f.key}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-28 truncate" title={f.label}>{f.label}</span>
                    <span className="flex-1 h-1.5 bg-background border border-border">
                      <span className={`block h-full ${f.pct >= 80 ? "bg-green-500" : f.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${f.pct}%` }} />
                    </span>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">{f.present}/{f.total}</span>
                  </div>
                  {lineage && (
                    <div className="pl-1 text-[10px] text-muted-foreground" data-testid={`lineage-${f.key}`}>
                      ← <span className="text-foreground/70">{lineage}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Source / lineage */}
        <div className="border-b border-border p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-wider text-muted-foreground">Sources</span>
            {polledAt != null && polledAt > 0 && (
              <span className="text-[10px] text-muted-foreground" data-testid="polled-at"
                title={`Read through to the backend at ${new Date(polledAt).toLocaleString()}`}>
                polled {ago(polledAt, Date.now())} · {new Date(polledAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {sources.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">No rows on screen.</p>
          ) : (
            <ul>
              {sources.map((s) => (
                <li key={s.source} className="flex items-center justify-between py-0.5" data-testid={`source-${s.source}`}>
                  <span className="uppercase">{s.source}</span>
                  <span className="tabular-nums text-muted-foreground">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Last touched by — present only when the backend exposes it. */}
        {hasEditors && (
          <div className="border-b border-border p-3 space-y-1" data-testid="last-touched">
            <span className="uppercase tracking-wider text-muted-foreground">Last touched by</span>
            <ul>
              {editors.map((e) => (
                <li key={e.source} className="flex items-center justify-between py-0.5" data-testid={`editor-${e.source}`}>
                  <span>{e.source}</span>
                  <span className="tabular-nums text-muted-foreground">{e.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Export */}
        <div className="flex items-center gap-2 p-3">
          <button type="button" onClick={exportCsv} data-testid="export-csv"
            className="flex flex-1 items-center justify-center gap-1.5 border border-border px-2 py-1.5 uppercase font-bold tracking-wider hover:border-primary hover:text-primary">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button type="button" onClick={exportJson} data-testid="export-json"
            className="flex flex-1 items-center justify-center gap-1.5 border border-border px-2 py-1.5 uppercase font-bold tracking-wider hover:border-primary hover:text-primary">
            <Download className="w-3.5 h-3.5" /> JSON
          </button>
        </div>
        <p className="px-3 pb-3 text-[10px] text-muted-foreground">Exports the rows on screen, with source &amp; lineage columns.</p>
      </PopoverContent>
    </Popover>
  );
}
