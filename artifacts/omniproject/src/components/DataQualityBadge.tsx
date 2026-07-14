import { useDataQuality } from "../lib/data-quality";

/**
 * A subtle, honest indicator that the connected backend has fed malformed data this session (which the
 * gateway auto-repaired fail-soft). Renders nothing while the source data is clean, so it's invisible
 * for well-behaved backends and only appears when there's something worth an operator's attention.
 */
export function DataQualityBadge() {
  const everRepaired = useDataQuality((s) => s.everRepaired);
  const lastRepaired = useDataQuality((s) => s.lastRepaired);
  if (!everRepaired) return null;
  return (
    <span
      data-testid="data-quality-badge"
      title={`The connected backend returned malformed field(s) that were auto-repaired (most recent response: ${lastRepaired}). Roll-up totals stay sound — but the source data has quality issues worth checking.`}
      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-600 border border-amber-500/40 px-1.5 py-0.5 rounded-none"
    >
      <span aria-hidden="true">⚠</span>
      <span className="hidden sm:inline">Data repaired</span>
    </span>
  );
}
