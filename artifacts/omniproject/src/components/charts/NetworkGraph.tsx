/**
 * A data-agnostic node-link graph primitive — draws pre-positioned nodes and the edges between them
 * on a shared 100×100 viewBox, as a vector `<svg>` that scales to its container. Positions are supplied
 * by the caller (any layout), so this primitive stays purely about rendering. `emphasis` marks a node or
 * edge as on the critical path (reserved red); `dashed` marks a crossing/secondary link (amber). The
 * shared substrate for the dependency-graph diagrams the report panels drew inline.
 */
export interface GraphNode {
  id: string;
  x: number;
  y: number;
  label: string;
  /** On the critical path — drawn larger and in the reserved red. */
  emphasis?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Both endpoints on the critical path — drawn thicker and red. */
  emphasis?: boolean;
  /** A crossing / secondary link — drawn dashed and amber (unless it is also emphasised). */
  dashed?: boolean;
}

export function NetworkGraph({ nodes, edges, ariaLabel, testId, className = "w-full max-h-80" }: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ariaLabel: string;
  testId?: string;
  className?: string;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${className} border border-border bg-background`}
      role="img"
      aria-label={ariaLabel}
      {...(testId ? { "data-testid": testId } : {})}
    >
      {edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={`e${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeWidth={e.emphasis ? 0.9 : 0.5}
            {...(e.dashed ? { strokeDasharray: "1.5 1" } : {})}
            className={e.emphasis ? "text-red-500" : e.dashed ? "text-amber-500" : "text-muted-foreground"}
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={n.emphasis ? 2.6 : 2.2} fill="currentColor" className={n.emphasis ? "text-red-500" : "text-primary"} />
          <text x={n.x} y={n.y - 3.5} textAnchor="middle" fontSize={3} fill="currentColor" className="text-foreground">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}
