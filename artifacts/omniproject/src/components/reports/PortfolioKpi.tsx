import type { KeyboardEvent, MouseEvent } from "react";
import { useGetPortfolioHealth, type PortfolioHealthSummary } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { getComponent } from "@workspace/backend-catalogue";
import { resolveDrillTo } from "../../lib/drill-to";
import { DataState } from "../DataState";

const RAG: Record<string, { dot: string; text: string; border: string }> = {
  GREEN: { dot: "bg-green-500", text: "text-green-500", border: "border-green-500/40" },
  AMBER: { dot: "bg-amber-500", text: "text-amber-500", border: "border-amber-500/40" },
  RED: { dot: "bg-red-500", text: "text-red-500", border: "border-red-500/40" },
};

// The portfolioHealth widget's own JSON definition (lib/backend-catalogue/assets/widgets/portfolioHealth.json)
// declares a `drillTo` for its BLOCKERS figure — the same declarative descriptor the generic SPA
// drill-down resolver (lib/drill-to.ts) consumes for ANY report/widget. Reading it off the catalogue
// (rather than hardcoding the predicate here) is what makes it declarative: editing the JSON changes
// what clicking BLOCKERS filters to, with no code change here (backlog #122).
const BLOCKERS_DRILL_TO = getComponent("widget:portfolioHealth")?.drillTo;

function KpiCard({ p }: { p: PortfolioHealthSummary }) {
  const [, navigate] = useLocation();
  const rag = RAG[p.ragStatus] ?? RAG.AMBER!; // AMBER is a literal key of RAG, always present
  const drill = BLOCKERS_DRILL_TO ? resolveDrillTo(BLOCKERS_DRILL_TO, p as unknown as Record<string, unknown>) : null;
  // "0 blocked" has nothing to drill into — only a positive count becomes a live link.
  const canDrill = !!drill && p.activeBlockersCount > 0;
  // A real nested <a> inside the card's own <a> is invalid HTML (React warns / would hydration-mismatch
  // under SSR), so the drill-through target is a `role="link"` span with its own click/keyboard
  // handling instead of a second wouter <Link> — independently navigable, stopping propagation so it
  // doesn't ALSO fire the card's own "go to project" nav.
  const openDrill = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    if (drill) navigate(drill.href);
  };
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
          {canDrill ? (
            <span
              role="link"
              tabIndex={0}
              onClick={openDrill}
              onKeyDown={(e) => { if (e.key === "Enter") openDrill(e); }}
              className="font-bold text-amber-500 underline decoration-dotted underline-offset-2 hover:text-amber-400 cursor-pointer"
              aria-label={`${drill!.label} for ${p.projectName}`}
              data-testid={`kpi-blockers-drill-${p.projectId}`}
              data-href={drill!.href}
            >
              {p.activeBlockersCount}
            </span>
          ) : (
            <div className={`font-bold ${p.activeBlockersCount > 0 ? "text-amber-500" : "text-foreground"}`}>
              {p.activeBlockersCount}
            </div>
          )}
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
