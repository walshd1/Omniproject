import { useGetProjectCapacity, type ResourceCapacity } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { DataState } from "../DataState";
import { AllocationBar } from "../charts/bars";

function Row({ r }: { r: ResourceCapacity }) {
  const over = r.allocationPercentage > 100;
  return (
    <div className={`grid grid-cols-[1fr_auto] items-center gap-4 p-3 border-b border-border ${over ? "bg-red-500/5" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm truncate">{r.resourceName}</span>
          {over && (
            <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-red-500">
              <AlertTriangle className="w-3 h-3" /> Over
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground font-mono uppercase">{r.role}</div>
        {/* Allocation on a 0–150% track (150% fills it), over/optimal/under status colour, 100% marker. */}
        <AllocationBar value={r.allocationPercentage} className="mt-2" />
      </div>
      <div className="text-right font-mono">
        <div className={`text-lg font-black ${over ? "text-red-500" : "text-foreground"}`}>{r.allocationPercentage}%</div>
        <div className="text-[10px] text-muted-foreground">{r.assignedHours}h / {r.availableHours}h</div>
      </div>
    </div>
  );
}

export function ResourceHeatmap({ projectId }: { projectId: string }) {
  const { data, isLoading, isError, error, refetch } = useGetProjectCapacity(projectId);
  const overCount = data?.filter((r) => r.allocationPercentage > 100).length ?? 0;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Resource Allocation</h2>
        {overCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-red-500 border border-red-500/40 px-2 py-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {overCount} over-allocated
          </span>
        )}
      </div>
      <div className="bg-card border border-border">
        {isLoading ? (
          <div className="h-40 animate-pulse" />
        ) : (
          <DataState isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
            {data?.length ? (
              data.map((r) => <Row key={r.resourceId} r={r} />)
            ) : (
              <div className="p-6 text-sm text-muted-foreground text-center">
                No capacity data — requires a resource-management source (assignments, roles, availability) via the
                <span className="font-mono"> get_resource_capacity </span> broker workflow.
              </div>
            )}
          </DataState>
        )}
      </div>
    </section>
  );
}
