/**
 * A data-agnostic ordered-path primitive — a sequence of labelled nodes joined by arrows, wrapping
 * across lines. It renders any `string[]` as a "A → B → C" chain; the shared substrate for the
 * critical-path / critical-chain strips that several report panels drew by hand. `tone` colours the
 * node boxes for genuine state (critical vs plain), never a categorical accent.
 */
export type PathChainTone = "critical" | "neutral";

const NODE_CLASS: Record<PathChainTone, string> = {
  critical: "border-red-500/60 bg-red-500/10 text-red-600",
  neutral: "border-border bg-muted text-foreground",
};

export function PathChain({ nodes, tone = "critical", testId }: { nodes: string[]; tone?: PathChainTone; testId?: string }) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs font-bold" {...(testId ? { "data-testid": testId } : {})}>
      {nodes.map((label, i) => (
        <li key={`${label}-${i}`} className="flex items-center gap-1">
          <span className={`border px-2 py-1 ${NODE_CLASS[tone]}`}>{label}</span>
          {i < nodes.length - 1 && <span className="text-muted-foreground" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  );
}
