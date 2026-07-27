import { useMemo } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { rollUpHierarchy, type HierarchyItem, type HierarchyNode } from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Epic progress tree — the epic -> story -> task roll-up, via the shared `rollUpHierarchy` catalogue engine.
 * A parent's completion is the weighted (by story points) progress of its children, recursively, so an epic
 * reads its real percentage rather than a hand-typed one. Parent links come from each issue's `epic` field.
 * Derive-only over the live issue list; nothing stored.
 */
export function HierarchyProgress({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);

  const { nodes, roots, summary } = useMemo(() => {
    const items: HierarchyItem[] = ((issues ?? []) as Issue[]).map((i) => ({
      id: i.id,
      parentId: i.epic ?? null,
      status: i.status,
      weight: i.storyPoints ?? null,
    }));
    return rollUpHierarchy(items);
  }, [issues]);

  // Depth-first display order: roots (id-sorted by the engine) then their children, recursively.
  const ordered = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string, HierarchyNode[]>();
    for (const n of nodes) {
      if (n.parentId) (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)!).push(n);
    }
    const out: HierarchyNode[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = byId.get(id);
      if (!node) return;
      out.push(node);
      for (const c of childrenOf.get(id) ?? []) walk(c.id);
    };
    for (const r of roots) walk(r);
    return out;
  }, [nodes, roots]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {nodes.length === 0 ? (
        <ReportEmpty testId="hierarchy-empty">
          No work items yet — the epic progress tree builds from issues and their `epic` parent links.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="hierarchy-progress">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Overall" value={summary.overallProgress == null ? "—" : `${Math.round(summary.overallProgress * 100)}%`} />
            <StatCard label="Epics (roots)" value={String(summary.roots)} />
            <StatCard label="Items" value={String(summary.total)} />
            <StatCard label="Max depth" value={String(summary.maxDepth)} />
          </div>
          <div className="space-y-1">
            {ordered.map((n) => (
              <div key={n.id} className="flex items-center gap-3 text-sm" data-testid={`hierarchy-node-${n.id}`} style={{ paddingLeft: `${n.depth * 1.25}rem` }}>
                <span className="font-mono text-xs w-40 truncate" title={n.id}>{n.id}</span>
                <span className="h-2.5 flex-1 bg-border/40 overflow-hidden rounded-sm">
                  <span className="block h-full bg-primary" style={{ width: `${Math.round(n.rolledProgress * 100)}%` }} />
                </span>
                <span className="tabular-nums text-xs text-muted-foreground w-24 text-right">
                  {Math.round(n.rolledProgress * 100)}%{n.isLeaf ? "" : ` · ${n.doneDescendants}/${n.descendantCount}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </DataState>
  );
}
