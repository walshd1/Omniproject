import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, getGetProjectCapacityQueryOptions, type ResourceCapacity } from "@workspace/api-client-react";
import { rollupByProgramme, type ProjectCapacity, type CapacityRollup as Rollup } from "../../lib/capacity-rollup";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { AllocationBar } from "../charts/bars";

/**
 * Capacity roll-up — programme and portfolio resource utilisation, aggregated across every project's
 * capacity (the per-project ResourceHeatmap, summed). STATELESS: it fetches each project's capacity and
 * derives the totals on the fly. For programme managers (their programmes) and the PMO (the portfolio).
 */

function RollupRow({ r }: { r: Rollup }) {
  const util = r.utilisation;
  return (
    <tr className="border-b border-border/50" data-testid={`capacity-rollup-row-${r.key}`}>
      <td className="py-2 pr-3 font-bold">{r.label}</td>
      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.projects}</td>
      <td className="py-2 px-2 text-right tabular-nums">{r.allocations}</td>
      <td className="py-2 px-2 text-right tabular-nums">{r.assignedHours.toLocaleString()}h / {r.availableHours.toLocaleString()}h</td>
      <td className="py-2 px-2">
        <div className="flex items-center gap-2">
          <AllocationBar value={util} className="w-28" />
          <span className="text-xs font-black tabular-nums w-12 text-right">{util === null ? "—" : `${util}%`}</span>
        </div>
      </td>
      <td className="py-2 px-2 text-right tabular-nums">
        {r.overAllocated > 0 ? <span className="font-black text-red-500">{r.overAllocated}</span> : <span className="text-muted-foreground">0</span>}
      </td>
    </tr>
  );
}

export function CapacityRollup() {
  const { data: projects, isLoading: projLoading, isError: projError, error: projErr, refetch } = useListProjects();
  const ids = useMemo(() => (projects ?? []).map((p) => p.id), [projects]);

  // `combine` keeps this result referentially stable across renders that don't change the
  // underlying query data, so `rollup` doesn't re-run rollupByProgramme over the whole portfolio
  // on every unrelated re-render. See docs/PERF-PATTERNS-REVIEW.md, Theme C.
  const capacityByProject = useQueries({
    queries: ids.map((id) => getGetProjectCapacityQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as ResourceCapacity[] | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });

  const loading = projLoading || capacityByProject.isLoading;
  const rollup = useMemo(() => {
    const withCap: ProjectCapacity[] = (projects ?? []).map((p, i) => ({
      projectId: p.id,
      projectName: p.name,
      programmeId: p.programmeId ?? null,
      programmeName: p.programmeName ?? null,
      resources: capacityByProject.data[i] ?? [],
    }));
    return rollupByProgramme(withCap);
  }, [projects, capacityByProject]);

  const hasData = rollup.portfolio.allocations > 0;

  return (
    <DataState isLoading={loading} isError={projError} error={projErr} onRetry={() => refetch()} className="min-h-40">
      {!hasData ? (
        <ReportEmpty testId="capacity-rollup-empty">
          No capacity data — connect a resource-management source so projects report assigned vs available hours.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="capacity-rollup">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Portfolio utilisation" value={rollup.portfolio.utilisation === null ? "—" : `${rollup.portfolio.utilisation}%`} hint={`${rollup.portfolio.projects} project(s)`} />
            <StatCard label="Assigned" value={`${rollup.portfolio.assignedHours.toLocaleString()}h`} hint={`of ${rollup.portfolio.availableHours.toLocaleString()}h available`} />
            <StatCard label="Allocations" value={rollup.portfolio.allocations.toLocaleString()} hint="people × projects" />
            <StatCard label="Over-allocated" value={rollup.portfolio.overAllocated.toLocaleString()} hint={rollup.portfolio.overAllocated > 0 ? "needs rebalancing" : "all within capacity"} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projects</th>
                  <th className="py-1.5 px-2 font-bold text-right">Allocations</th>
                  <th className="py-1.5 px-2 font-bold text-right">Hours</th>
                  <th className="py-1.5 px-2 font-bold">Utilisation</th>
                  <th className="py-1.5 px-2 font-bold text-right">Over</th>
                </tr>
              </thead>
              <tbody>
                {rollup.programmes.map((r) => <RollupRow key={r.key} r={r} />)}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Utilisation = assigned ÷ available hours, rolled up across each programme's projects. Over-allocated
            counts allocations above 100% — the contention to rebalance. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
