import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Panel } from "../../../lib/screen";

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
          <svg viewBox="0 0 100 100" className="mt-2 w-full max-h-64" role="img" aria-label={`Dependency graph: ${nodes.length} nodes, ${edges.length} edges`} data-testid="graph-svg">
            {edges.map((e, i) => {
              const a = pos[e.from], b = pos[e.to];
              if (!a || !b) return null;
              return <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={0.5} className="text-muted-foreground" />;
            })}
            {nodes.map((n) => {
              const p = pos[n.id]!;
              return (
                <g key={n.id}>
                  <circle cx={p.x} cy={p.y} r={2.4} fill="currentColor" className="text-primary" />
                  <text x={p.x} y={p.y - 3.5} textAnchor="middle" fontSize={3.2} fill="currentColor" className="text-foreground">{labelOf(n.id)}</text>
                </g>
              );
            })}
          </svg>
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
