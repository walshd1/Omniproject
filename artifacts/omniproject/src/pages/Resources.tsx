import { useMemo, useState } from "react";
import { useListResourcePool, useGetCapabilities, getListResourcePoolQueryKey } from "@workspace/api-client-react";
import { DataState } from "../components/DataState";
import { DataProvenance } from "../components/DataProvenance";
import { canSurfaceEntity } from "../lib/capabilities-fields";
import { capacityBand, capacitySummary } from "../lib/capacity";

/** Roster fields whose fill rate exposes capacity-planning gaps. */
const RESOURCE_FIELDS = [
  { key: "skills", label: "Skills" },
  { key: "availableHours", label: "Available (h)" },
  { key: "allocatedHours", label: "Allocated (h)" },
];

/** Utilisation = allocated / available, when both are known. */
function utilisation(available: number | null, allocated: number | null): number | null {
  if (typeof available !== "number" || available <= 0 || typeof allocated !== "number") return null;
  return Math.round((allocated / available) * 100);
}

const BAND_TEXT: Record<string, string> = { over: "text-red-500", at: "text-amber-500", under: "", unknown: "text-muted-foreground" };
const BAND_LABEL: Record<string, string> = { over: "OVER", at: "AT", under: "", unknown: "" };

export function Resources() {
  const { data: caps } = useGetCapabilities();
  const supported = canSurfaceEntity(caps, "member", false);
  const { data: pool, isLoading, isError, error, refetch } = useListResourcePool({
    query: { enabled: supported, queryKey: getListResourcePoolQueryKey() },
  });

  // The "given capacity level" the user wants to surface against (over-capacity
  // is always > 100%). Default 90% to catch people approaching their ceiling.
  const [threshold, setThreshold] = useState(90);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const rows = useMemo(
    () => (pool ?? []).map((r) => ({ r, util: utilisation(r.availableHours, r.allocatedHours) })),
    [pool],
  );
  const summary = useMemo(() => capacitySummary(rows.map((x) => x.util), threshold), [rows, threshold]);
  const visible = onlyFlagged
    ? rows.filter((x) => { const b = capacityBand(x.util, threshold); return b === "over" || b === "at"; })
    : rows;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">Resource Planning</h1>
          <div className="flex items-center gap-4">
            {pool && <span className="text-muted-foreground font-mono text-sm">{pool.length} PEOPLE</span>}
            {pool && pool.length > 0 && (
              <DataProvenance rows={pool as unknown as Record<string, unknown>[]} fields={RESOURCE_FIELDS} mode={caps?.mode}
                filename="resources" sourceAccessor={() => "resource-pool"} />
            )}
          </div>
        </div>

        {!supported ? (
          <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Resource data isn't available for this backend — requires a source that surfaces members,
            skills and capacity (wired through n8n).
          </div>
        ) : (
          <>
            {/* Capacity surfacing: over-capacity (>100%) + an adjustable level. */}
            <div data-testid="capacity-summary" className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className={`font-black ${summary.over > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                  {summary.over} over capacity
                </span>
                <span className={`font-black ${summary.at > 0 ? "text-amber-500" : "text-muted-foreground"}`}>
                  {summary.at} at/over {threshold}%
                </span>
                <span className="text-muted-foreground font-mono text-xs">{summary.tracked} tracked</span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Level
                  <input
                    type="number" min={50} max={150} step={5} value={threshold}
                    onChange={(e) => setThreshold(Math.min(150, Math.max(50, Number(e.target.value) || 0)))}
                    aria-label="Capacity level threshold"
                    className="w-16 bg-background border border-border px-2 py-1 text-sm font-mono outline-none"
                  />
                  %
                </label>
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)}
                    aria-label="Only show flagged" className="accent-primary" />
                  Only flagged
                </label>
              </div>
            </div>

            <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
              <div className="overflow-x-auto border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2">Person</th>
                      <th className="px-3 py-2">Skills</th>
                      <th className="px-3 py-2 text-right">Available (h)</th>
                      <th className="px-3 py-2 text-right">Allocated (h)</th>
                      <th className="px-3 py-2 text-right">Utilisation</th>
                      <th className="px-3 py-2 text-right">Projects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(({ r, util }) => {
                      const band = capacityBand(util, threshold);
                      return (
                        <tr key={r.id} className={`border-b border-border hover:bg-muted/20 ${band === "over" ? "bg-red-500/5" : band === "at" ? "bg-amber-500/5" : ""}`}>
                          <td className="px-3 py-2 font-semibold">{r.name ?? r.email ?? r.id}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.skills.length === 0 && <span className="text-muted-foreground">—</span>}
                              {r.skills.map((s) => (
                                <span key={s} className="text-[10px] font-bold uppercase tracking-wider border border-border px-1.5 py-0.5 bg-background">{s}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.availableHours ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.allocatedHours ?? "—"}</td>
                          <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${BAND_TEXT[band]}`}>
                            {util != null ? `${util}%` : "—"}
                            {BAND_LABEL[band] && (
                              <span className={`ml-2 align-middle text-[9px] font-black uppercase tracking-widest border px-1 py-0.5 ${band === "over" ? "border-red-500/40 text-red-500" : "border-amber-500/40 text-amber-500"}`}>
                                {BAND_LABEL[band]}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.projectIds.length}</td>
                        </tr>
                      );
                    })}
                    {pool && pool.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No people found across the portfolio.</td></tr>
                    )}
                    {pool && pool.length > 0 && visible.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">Nobody is at or over {threshold}%.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DataState>
          </>
        )}
      </div>
    </div>
  );
}
