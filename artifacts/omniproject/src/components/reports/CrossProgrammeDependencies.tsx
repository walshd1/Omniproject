import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import type { Issue } from "@workspace/api-client-react";
import {
  crossProgrammeMap,
  type CrossProgrammeMap,
  type DepItem,
  type DepRef,
} from "../../lib/cross-programme-dependencies";
import { DataState } from "../DataState";
import { usePortfolioItems } from "./use-portfolio-items";

/**
 * Cross-programme Dependency & Critical-Path Map. STATELESS: from the live read model (work items across
 * every project, tagged with their programme, carrying `dependsOn` / `parentTask` references and dates) it
 * derives the dependency graph — including the edges that cross programme boundaries — and the critical
 * path across the whole thing, reusing the shared CPM solver. Nothing is stored: the same rows always
 * yield the same map. Renders a circular node-link diagram (the repo's graph primitive) plus tables.
 */

/** A reference custom-field may arrive as a string or an array of strings; pass it through as a DepRef. */
function asRef(v: unknown): DepRef {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return null;
}

/** Map a portfolio issue to the derivation's item shape, pulling the relationship refs from customFields. */
function toDepItem(issue: Issue, programmeId: string | null, programmeName: string | null): DepItem {
  const cf = issue.customFields ?? {};
  return {
    id: issue.id,
    title: issue.title,
    programmeId,
    programmeName,
    startDate: issue.startDate ?? null,
    dueDate: issue.dueDate ?? null,
    dependsOn: asRef(cf["dependsOn"]),
    parentTask: asRef(cf["parentTask"]),
  };
}

// Circular layout in a 0..100 viewBox (start at the top, go clockwise) — mirrors GraphPanel's primitive.
function layout(ids: string[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const cx = 50, cy = 50, r = ids.length > 1 ? 40 : 0;
  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, ids.length) - Math.PI / 2;
    pos[id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return pos;
}

export function CrossProgrammeDependencies() {
  const { projects, loading, isError, error, refetch } = usePortfolioItems();

  const map: CrossProgrammeMap = useMemo(() => {
    const items: DepItem[] = [];
    for (const p of projects) {
      for (const it of p.items as Issue[]) items.push(toDepItem(it, p.programmeId, p.programmeName));
    }
    return crossProgrammeMap(items);
  }, [projects]);

  const criticalSet = useMemo(() => new Set(map.criticalPath), [map]);
  const titleOf = useMemo(() => {
    const t: Record<string, string> = {};
    for (const n of map.nodes) t[n.id] = n.title;
    return t;
  }, [map]);
  const programmeLabelOf = useMemo(() => {
    const t: Record<string, string> = {};
    for (const n of map.nodes) if (n.programmeId) t[n.programmeId] = n.programmeName ?? n.programmeId;
    return t;
  }, [map]);

  // Draw only the connected items (endpoints of at least one edge) so the diagram stays legible.
  const graphIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of map.edges) { s.add(e.from); s.add(e.to); }
    return [...s];
  }, [map]);
  const pos = useMemo(() => layout(graphIds), [graphIds]);

  const rows = useMemo(
    () => [...map.nodes].filter((n) => criticalSet.has(n.id) || map.edges.some((e) => e.from === n.id || e.to === n.id))
      .sort((a, b) => a.es - b.es || b.duration - a.duration),
    [map, criticalSet],
  );

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {map.edges.length === 0 ? (
        <ReportEmpty testId="cross-programme-empty">
          No cross-programme dependencies to map yet — link work items with <strong>depends&nbsp;on</strong> references
          (and give them start/due dates) to derive the dependency graph and its critical path across programmes.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="cross-programme-map">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Schedule length</div>
              <div className="text-2xl font-black font-mono tabular-nums" data-testid="cross-programme-duration">{map.projectDuration}<span className="text-sm"> d</span></div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Dependencies</div>
              <div className="text-2xl font-black font-mono tabular-nums">{map.edges.length}</div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cross-programme</div>
              <div className="text-2xl font-black font-mono tabular-nums" data-testid="cross-programme-count">{map.crossProgrammeEdges.length}</div>
            </div>
            <div className="border border-border bg-background p-3 text-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">On critical path</div>
              <div className="text-2xl font-black font-mono tabular-nums">{map.criticalPath.length}</div>
            </div>
          </div>

          {map.hasCycle && (
            <div role="alert" className="border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-600" data-testid="cross-programme-cycle">
              A dependency cycle was found — {map.unscheduled.length} item(s) could not be scheduled:{" "}
              {map.unscheduled.map((id) => titleOf[id] ?? id).join(", ")}. Break the loop to schedule them.
            </div>
          )}

          {graphIds.length > 0 && (
            <svg viewBox="0 0 100 100" className="w-full max-h-80 border border-border bg-background" role="img"
              aria-label={`Cross-programme dependency graph: ${graphIds.length} items, ${map.edges.length} dependencies`} data-testid="cross-programme-graph">
              {map.edges.map((e, i) => {
                const a = pos[e.from], b = pos[e.to];
                if (!a || !b) return null;
                const onCritical = criticalSet.has(e.from) && criticalSet.has(e.to);
                return (
                  <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="currentColor" strokeWidth={onCritical ? 0.9 : 0.5}
                    strokeDasharray={e.crossProgramme ? "1.5 1" : undefined}
                    className={onCritical ? "text-red-500" : e.crossProgramme ? "text-amber-500" : "text-muted-foreground"} />
                );
              })}
              {graphIds.map((id) => {
                const p = pos[id]!;
                const crit = criticalSet.has(id);
                return (
                  <g key={id}>
                    <circle cx={p.x} cy={p.y} r={crit ? 2.6 : 2.2} fill="currentColor" className={crit ? "text-red-500" : "text-primary"} />
                    <text x={p.x} y={p.y - 3.5} textAnchor="middle" fontSize={3} fill="currentColor" className="text-foreground">{titleOf[id] ?? id}</text>
                  </g>
                );
              })}
            </svg>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Critical path across programmes</div>
            <ol className="flex flex-wrap items-center gap-1 text-xs font-bold" data-testid="cross-programme-chain">
              {map.criticalPath.map((id, i) => (
                <li key={id} className="flex items-center gap-1">
                  <span className="border border-red-500/60 bg-red-500/10 text-red-600 px-2 py-1">{titleOf[id] ?? id}</span>
                  {i < map.criticalPath.length - 1 && <span className="text-muted-foreground">→</span>}
                </li>
              ))}
            </ol>
          </div>

          {map.crossProgrammeEdges.length > 0 && (
            <div className="overflow-x-auto">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Cross-programme dependencies</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-3 font-bold">Predecessor</th>
                    <th className="py-1.5 px-2 font-bold">Programme</th>
                    <th className="py-1.5 px-2 font-bold">Dependent</th>
                    <th className="py-1.5 px-2 font-bold">Programme</th>
                  </tr>
                </thead>
                <tbody>
                  {map.crossProgrammeEdges.map((e, i) => (
                    <tr key={i} className="border-b border-border/50" data-testid={`cross-programme-edge-${e.from}-${e.to}`}>
                      <td className="py-1.5 pr-3 font-mono truncate max-w-[12rem]">{titleOf[e.from] ?? e.from}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{e.fromProgramme ? programmeLabelOf[e.fromProgramme] ?? e.fromProgramme : "Standalone"}</td>
                      <td className="py-1.5 px-2 font-mono truncate max-w-[12rem]">{titleOf[e.to] ?? e.to}</td>
                      <td className="py-1.5 px-2 text-muted-foreground">{e.toProgramme ? programmeLabelOf[e.toProgramme] ?? e.toProgramme : "Standalone"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Item</th>
                  <th className="py-1.5 px-2 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Dur</th>
                  <th className="py-1.5 px-2 font-bold text-right">ES</th>
                  <th className="py-1.5 px-2 font-bold text-right">Float</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} className={`border-b border-border/50 ${n.critical ? "bg-red-500/5" : ""}`} data-testid={`cross-programme-row-${n.id}`}>
                    <td className="py-1.5 pr-3 font-mono truncate max-w-[16rem]">
                      {n.critical && <span className="text-red-600 mr-1" title="On the critical path">●</span>}
                      {n.title}
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">{n.programmeName ?? (n.programmeId ?? "Standalone")}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n.duration}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{n.es}</td>
                    <td className={`py-1.5 px-2 text-right tabular-nums ${n.critical ? "text-red-600 font-bold" : "text-muted-foreground"}`}>{n.float}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Dependencies come from your <strong>depends-on</strong> links; durations from start→due spans. Dashed edges
            cross a programme boundary; red marks the critical path. Derived live across the portfolio — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
