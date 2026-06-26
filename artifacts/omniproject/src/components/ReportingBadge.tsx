/**
 * Inline data-honesty badge: "12/15 reporting". Sits ON a rolled-up figure so a
 * reader sees coverage without opening the data-source overlay — the difference
 * between "I can verify trust" and "the number tells me when not to trust it".
 *
 * Complete (present === total) → green and reassuring; partial → amber warning;
 * the caller decides whether to render at all when present === 0 (truly absent).
 */
export function ReportingBadge({
  present,
  total,
  noun = "reporting",
  className = "",
}: {
  present: number;
  total: number;
  /** What's being counted, for the tooltip ("report earned value"). */
  noun?: string;
  className?: string;
}) {
  if (total <= 0) return null;
  const complete = present >= total;
  const cls = complete
    ? "border-green-500/40 text-green-600 dark:text-green-400 bg-green-500/10"
    : "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10";
  const title = complete
    ? `All ${total} costed projects report this — a complete figure.`
    : `Only ${present} of ${total} costed projects ${noun} — this is NOT a complete figure.`;
  return (
    <span
      data-testid="reporting-badge"
      title={title}
      className={`inline-flex items-center px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest border ${cls} ${className}`}
    >
      {present}/{total} reporting
    </span>
  );
}
