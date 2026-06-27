import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

/**
 * Graph panel — a network/dependency graph. config: { nodes: [{id,label?}],
 * edges: [{from,to,label?}] }. Edges typically derive from work-item
 * `dependsOn`/`blocks`/relationship fields.
 *
 * This ships the ACCESSIBLE summary (counts + a readable edge list) so the panel is
 * JSON-composable and usable today; the rich force-directed (D3) rendering is the
 * remaining work and slots in behind this same component + config.
 */
interface GraphNode { id: string; label?: string }
interface GraphEdge { from: string; to: string; label?: string }

export function GraphPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const nodes = Array.isArray(c["nodes"]) ? (c["nodes"] as GraphNode[]) : [];
  const edges = Array.isArray(c["edges"]) ? (c["edges"] as GraphEdge[]) : [];
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title ?? "Graph"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground" role="status">
          {nodes.length} node{nodes.length === 1 ? "" : "s"}, {edges.length} edge{edges.length === 1 ? "" : "s"}
        </div>
        {edges.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm" aria-label="Graph edges">
            {edges.map((e, i) => (
              <li key={i} className="tabular-nums">
                {labelOf(e.from)} <span aria-hidden="true">→</span><span className="sr-only">depends on</span> {labelOf(e.to)}
                {e.label && <span className="ml-1 text-muted-foreground">({e.label})</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Visual force-directed graph rendering is coming; this is the accessible data view.</p>
      </CardContent>
    </Card>
  );
}
