import { useListResourcePool, useGetCapabilities, getListResourcePoolQueryKey } from "@workspace/api-client-react";
import { DataState } from "../components/DataState";
import { canSurfaceEntity } from "../lib/capabilities-fields";

/** Utilisation = allocated / available, when both are known. */
function utilisation(available: number | null, allocated: number | null): number | null {
  if (typeof available !== "number" || available <= 0 || typeof allocated !== "number") return null;
  return Math.round((allocated / available) * 100);
}

export function Resources() {
  const { data: caps } = useGetCapabilities();
  const supported = canSurfaceEntity(caps, "member", false);
  const { data: pool, isLoading, isError, error, refetch } = useListResourcePool({
    query: { enabled: supported, queryKey: getListResourcePoolQueryKey() },
  });

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <h1 className="text-3xl font-black uppercase tracking-tighter">Resource Planning</h1>
          {pool && <span className="text-muted-foreground font-mono text-sm">{pool.length} PEOPLE</span>}
        </div>

        {!supported ? (
          <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Resource data isn't available for this backend — requires a source that surfaces members,
            skills and capacity (wired through n8n).
          </div>
        ) : (
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
                  {(pool ?? []).map((r) => {
                    const u = utilisation(r.availableHours, r.allocatedHours);
                    const over = u != null && u > 100;
                    return (
                      <tr key={r.id} className="border-b border-border hover:bg-muted/20">
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
                        <td className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${over ? "text-red-500" : u != null && u > 85 ? "text-amber-500" : ""}`}>
                          {u != null ? `${u}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{r.projectIds.length}</td>
                      </tr>
                    );
                  })}
                  {pool && pool.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No people found across the portfolio.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DataState>
        )}
      </div>
    </div>
  );
}
