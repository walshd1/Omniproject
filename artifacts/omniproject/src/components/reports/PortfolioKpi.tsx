import { useGetPortfolioHealth, type PortfolioHealthSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import { DataState } from "../DataState";

const RAG: Record<string, { dot: string; text: string; border: string }> = {
  GREEN: { dot: "bg-green-500", text: "text-green-500", border: "border-green-500/40" },
  AMBER: { dot: "bg-amber-500", text: "text-amber-500", border: "border-amber-500/40" },
  RED: { dot: "bg-red-500", text: "text-red-500", border: "border-red-500/40" },
};

function KpiCard({ p }: { p: PortfolioHealthSummary }) {
  const rag = RAG[p.ragStatus] ?? RAG.AMBER;
  return (
    <Link
      href={`/projects/${p.projectId}`}
      className={`block bg-card border-2 ${rag.border} p-4 hover:border-primary transition-colors`}
      data-testid={`kpi-${p.projectId}`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm truncate pr-2">{p.projectName}</h3>
        <span className={`shrink-0 flex items-center gap-1.5 text-xs font-black uppercase tracking-widest ${rag.text}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${rag.dot}`} /> {p.ragStatus}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs font-mono">
        <div>
          <div className="text-muted-foreground mb-0.5">SCHED Δ</div>
          <div className={`font-bold ${p.scheduleVarianceDays < 0 ? "text-red-500" : "text-foreground"}`}>
            {p.scheduleVarianceDays > 0 ? "+" : ""}{p.scheduleVarianceDays}d
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">BUDGET Δ</div>
          <div className={`font-bold ${p.budgetVariancePercentage > 0 ? "text-red-500" : "text-green-500"}`}>
            {p.budgetVariancePercentage > 0 ? "+" : ""}{p.budgetVariancePercentage}%
          </div>
        </div>
        <div>
          <div className="text-muted-foreground mb-0.5">BLOCKERS</div>
          <div className={`font-bold ${p.activeBlockersCount > 0 ? "text-amber-500" : "text-foreground"}`}>
            {p.activeBlockersCount}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function PortfolioKpi() {
  const { data, isLoading, isError, error, refetch } = useGetPortfolioHealth();

  return (
    <section>
      <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-4">Portfolio Health</h2>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <DataState isError={isError} error={error} onRetry={() => refetch()} className="min-h-28">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {data?.map((p) => <KpiCard key={p.projectId} p={p} />)}
            {!data?.length && <div className="text-muted-foreground text-sm">No portfolio data.</div>}
          </div>
        </DataState>
      )}
    </section>
  );
}
