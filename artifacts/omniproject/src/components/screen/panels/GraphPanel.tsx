import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";
import { NetworkGraph } from "../../charts/NetworkGraph";

/**
 * Graph panel — a network/dependency graph. config: { nodes: [{id,label?}],
 * edges: [{from,to,label?}] }. Edges typically derive from work-item
 * `dependsOn`/`blocks`/relationship fields.
 *
 * Renders a real node-link diagram with a dependency-free circular layout (no D3,
 * no external calls — fits the no-egress ethos), plus an accessible edge list for
 * screen readers. A force-directed layout could slot in behind the same config.
 */
interface GraphNode { id: string; label?: string }
interface GraphEdge { from: string; to: string; label?: string }

// Circular layout in a 0..100 viewBox (start at the top, go clockwise).
function layout(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const cx = 50, cy = 50, r = nodes.length > 1 ? 38 : 0;
  nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, nodes.length) - Math.PI / 2;
    pos[n.id] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return pos;
}

export function GraphPanel({ panel }: { panel: Panel }) {
  const c = panel.config ?? {};
  const nodes = Array.isArray(c["nodes"]) ? (c["nodes"] as GraphNode[]) : [];
  const edges = Array.isArray(c["edges"]) ? (c["edges"] as GraphEdge[]) : [];
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const pos = layout(nodes);
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">{panel.title ?? "Graph"}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-muted-foreground" role="status">
          {nodes.length} node{nodes.length === 1 ? "" : "s"}, {edges.length} edge{edges.length === 1 ? "" : "s"}
        </div>
        {nodes.length > 0 && (
          <NetworkGraph
            testId="graph-svg"
            className="mt-2 w-full max-h-64"
            ariaLabel={`Dependency graph: ${nodes.length} nodes, ${edges.length} edges`}
            nodes={nodes.map((n) => ({ id: n.id, x: pos[n.id]!.x, y: pos[n.id]!.y, label: labelOf(n.id) }))}
            edges={edges.map((e) => ({ from: e.from, to: e.to }))}
          />
        )}
        {edges.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm sr-only" aria-label="Graph edges">
            {edges.map((e, i) => (
              <li key={i}>{labelOf(e.from)} depends on {labelOf(e.to)}{e.label ? ` (${e.label})` : ""}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
