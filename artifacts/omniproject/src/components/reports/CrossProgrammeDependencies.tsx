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
import { PathChain } from "../charts/PathChain";
import { NetworkGraph } from "../charts/NetworkGraph";
import { usePortfolioItems } from "./use-portfolio-items";
import { ReportTable } from "./ReportTable";

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
            <NetworkGraph
              testId="cross-programme-graph"
              ariaLabel={`Cross-programme dependency graph: ${graphIds.length} items, ${map.edges.length} dependencies`}
              nodes={graphIds.map((id) => ({ id, x: pos[id]!.x, y: pos[id]!.y, label: titleOf[id] ?? id, emphasis: criticalSet.has(id) }))}
              edges={map.edges.map((e) => ({ from: e.from, to: e.to, emphasis: criticalSet.has(e.from) && criticalSet.has(e.to), dashed: !!e.crossProgramme }))}
            />
          )}

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Critical path across programmes</div>
            <PathChain nodes={map.criticalPath.map((id) => titleOf[id] ?? id)} testId="cross-programme-chain" />
          </div>

          {map.crossProgrammeEdges.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Cross-programme dependencies</div>
              <ReportTable
                rows={map.crossProgrammeEdges}
                rowKey={(e) => `${e.from}-${e.to}`}
                rowTestId={(e) => `cross-programme-edge-${e.from}-${e.to}`}
                columns={[
                  { header: "Predecessor", cellClassName: "font-mono truncate max-w-[12rem]", cell: (e) => titleOf[e.from] ?? e.from },
                  { header: "Programme", cellClassName: "text-muted-foreground", cell: (e) => (e.fromProgramme ? programmeLabelOf[e.fromProgramme] ?? e.fromProgramme : "Standalone") },
                  { header: "Dependent", cellClassName: "font-mono truncate max-w-[12rem]", cell: (e) => titleOf[e.to] ?? e.to },
                  { header: "Programme", cellClassName: "text-muted-foreground", cell: (e) => (e.toProgramme ? programmeLabelOf[e.toProgramme] ?? e.toProgramme : "Standalone") },
                ]}
              />
            </div>
          )}

          <ReportTable
            rows={rows}
            rowKey={(n) => n.id}
            rowTestId={(n) => `cross-programme-row-${n.id}`}
            rowClassName={(n) => (n.critical ? "bg-red-500/5" : "")}
            columns={[
              { header: "Item", cellClassName: "font-mono truncate max-w-[16rem]", cell: (n) => (
                <>
                  {n.critical && <span className="text-red-600 mr-1" title="On the critical path">●</span>}
                  {n.title}
                </>
              ) },
              { header: "Programme", cellClassName: "text-muted-foreground", cell: (n) => n.programmeName ?? (n.programmeId ?? "Standalone") },
              { header: "Dur", align: "right", cell: (n) => n.duration },
              { header: "ES", align: "right", cell: (n) => n.es },
              { header: "Float", align: "right", cellClassName: (n) => (n.critical ? "text-red-600 font-bold" : "text-muted-foreground"), cell: (n) => n.float },
            ]}
          />

          <p className="text-[11px] text-muted-foreground">
            Dependencies come from your <strong>depends-on</strong> links; durations from start→due spans. Dashed edges
            cross a programme boundary; red marks the critical path. Derived live across the portfolio — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
