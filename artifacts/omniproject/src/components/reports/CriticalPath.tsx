import { useMemo } from "react";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { criticalPath, type CpmEdge, type CpmNode } from "../../lib/critical-path";
import { loadEdges, type DependencyEdge } from "../../lib/dependencies";
import { DataState } from "../DataState";

/**
 * Critical Path (CPM) report. STATELESS: activity durations are derived from the live
 * issues (estimate or start→due span) and the precedence edges come from the existing
 * dependency overlay (volatile/exportable, never server-stored). It runs the standard
 * forward/backward pass to surface the project's critical chain and each activity's float.
 * Nothing is persisted here — given the same issues + edges it always computes the same plan.
 */

const DAY_MS = 86_400_000;
const HOURS_PER_DAY = 8;

/** Activity duration in working days: a start→due span if both exist, else estimate/8, else 0 (a milestone). */
export function durationDays(issue: Pick<Issue, "startDate" | "dueDate" | "estimateHours">): number {
  const s = issue.startDate ? Date.parse(issue.startDate) : NaN;
  const d = issue.dueDate ? Date.parse(issue.dueDate) : NaN;
  if (!Number.isNaN(s) && !Number.isNaN(d) && d >= s) {
    return Math.max(1, Math.round((d - s) / DAY_MS) + 1);
  }
  const est = issue.estimateHours ?? 0;
  if (est > 0) return Math.max(1, Math.round(est / HOURS_PER_DAY));
  return 0;
}

/**
 * Map dependency edges to CPM precedence within one project. `blocks` means from→to;
 * `depends_on` is the reverse (to must finish before from); `relates_to` carries no order.
 * Only edges whose both endpoints are issues in this project's set are kept.
 */
export function toCpmEdges(edges: readonly DependencyEdge[], projectId: string, ids: ReadonlySet<string>): CpmEdge[] {
  const out: CpmEdge[] = [];
  for (const e of edges) {
    if (e.from.projectRef !== projectId || e.to.projectRef !== projectId) continue;
    if (!ids.has(e.from.itemRef) || !ids.has(e.to.itemRef)) continue;
    if (e.type === "blocks") out.push({ from: e.from.itemRef, to: e.to.itemRef });
    else if (e.type === "depends_on") out.push({ from: e.to.itemRef, to: e.from.itemRef });
    // relates_to → no precedence
  }
  return out;
}

export function CriticalPath({ projectId, edges }: { projectId: string; edges?: DependencyEdge[] }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });
  const allEdges = useMemo(() => edges ?? loadEdges(), [edges]);

  const { nodes, cpmEdges, titleOf } = useMemo(() => {
    const list = issues ?? [];
    const ids = new Set(list.map((i) => i.id));
    const ns: CpmNode[] = list.map((i) => ({ id: i.id, duration: durationDays(i) }));
    const titles: Record<string, string> = {};
    for (const i of list) titles[i.id] = i.title;
    return { nodes: ns, cpmEdges: toCpmEdges(allEdges, projectId, ids), titleOf: titles };
  }, [issues, allEdges, projectId]);

  const result = useMemo(() => criticalPath(nodes, cpmEdges), [nodes, cpmEdges]);

  const rows = useMemo(
    () => result.order.map((id) => result.nodes[id]!).sort((a, b) => a.es - b.es || b.duration - a.duration),
    [result],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {cpmEdges.length === 0 ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="cpm-empty">
          No precedence to analyse yet — link work items with <strong>blocks</strong> / <strong>depends&nbsp;on</strong>{" "}
          dependencies (Dependency Links report) and give them durations to compute the critical path.
        </div>
      ) : (
        <div className="space-y-4" data-testid="critical-path">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Project duration</div>
              <div className="text-2xl font-black font-mono tabular-nums" data-testid="cpm-duration">{result.projectDuration}<span className="text-sm"> d</span></div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Critical activities</div>
              <div className="text-2xl font-black font-mono tabular-nums">{result.criticalPath.length}</div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Scheduled</div>
              <div className="text-2xl font-black font-mono tabular-nums">{result.order.length}</div>
            </div>
          </div>

          {result.hasCycle && (
            <div role="alert" className="border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-600" data-testid="cpm-cycle">
              A dependency cycle was found — {result.unscheduled.length} item(s) could not be scheduled:{" "}
              {result.unscheduled.map((id) => titleOf[id] ?? id).join(", ")}. Break the loop to schedule them.
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Critical chain</div>
            <ol className="flex flex-wrap items-center gap-1 text-xs font-bold" data-testid="cpm-chain">
              {result.criticalPath.map((id, i) => (
                <li key={id} className="flex items-center gap-1">
                  <span className="border border-red-500/60 bg-red-500/10 text-red-600 px-2 py-1">{titleOf[id] ?? id}</span>
                  {i < result.criticalPath.length - 1 && <span className="text-muted-foreground">→</span>}
                </li>
              ))}
            </ol>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Activity</th>
                  <th className="py-1.5 px-2 font-bold text-right">Dur</th>
                  <th className="py-1.5 px-2 font-bold text-right">ES</th>
                  <th className="py-1.5 px-2 font-bold text-right">EF</th>
                  <th className="py-1.5 px-2 font-bold text-right">Float</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} className={`border-b border-border/50 ${n.critical ? "bg-red-500/5" : ""}`} data-testid={`cpm-row-${n.id}`}>
                    <td className="py-1.5 pr-3 font-mono truncate max-w-[16rem]">
                      {n.critical && <span className="text-red-600 mr-1" title="On the critical path">●</span>}
                      {titleOf[n.id] ?? n.id}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n.duration}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n.es}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n.ef}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${n.critical ? "text-red-600 font-bold" : "text-muted-foreground"}`}>{n.float}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Durations are derived (start→due span, else estimate ÷ {HOURS_PER_DAY}h/day); precedence comes from your
            {" "}<strong>blocks / depends-on</strong> links. Critical activities (zero float) set the finish date — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
