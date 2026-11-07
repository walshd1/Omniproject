import { useSourceAvailability } from "../lib/source-availability";

/**
 * Global indicator that a backend stopped answering — the sibling of {@link DataQualityBadge}, which
 * flags data that arrived malformed. This flags data that did not arrive.
 *
 * Renders nothing while every source is answering, so it is invisible in the normal case and only
 * appears when something is genuinely missing. It clears itself on the next clean response (see
 * lib/source-availability.ts for why this is transient rather than sticky).
 */
export function SourceAvailabilityBadge() {
  const unavailable = useSourceAvailability((s) => s.unavailable);
  if (unavailable < 1) return null;
  const label = unavailable === 1 ? "1 source down" : `${unavailable} sources down`;
  return (
    <span
      data-testid="source-availability-badge"
      role="status"
      aria-live="polite"
      title={
        `${label}. OmniProject reads live from your systems and keeps no copy, so a backend that stops ` +
        `answering takes its projects with it. Figures that would have to be summed across the missing ` +
        `source are withheld rather than shown as a smaller total. This clears itself when the source returns.`
      }
      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-700 dark:text-rose-500 border border-rose-500/40 px-1.5 py-0.5 rounded-none"
    >
      <span aria-hidden="true">◍</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
