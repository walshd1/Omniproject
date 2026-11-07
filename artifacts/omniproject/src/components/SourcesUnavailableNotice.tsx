import { describeAvailability, describeStaleness, humaniseUnavailable, rawUnavailable, type AvailabilityReport } from "../lib/source-availability";

/**
 * Per-report banner explaining WHY a roll-up is missing figures, and how old it is.
 *
 * The global badge says "something is down"; this says which source, and that the totals were withheld
 * on purpose. That distinction is the whole point: a blank budget with no explanation looks like a bug
 * or, worse, like £0. A blank budget labelled "SAP did not answer — totals withheld" is an honest
 * report, and the reader knows the rows they CAN see are real and live.
 *
 * Renders nothing when everything answered and the figures are live, so a healthy report is unchanged.
 */
export function SourcesUnavailableNotice({
  availability,
  staleMs,
}: {
  availability?: AvailabilityReport | undefined;
  staleMs?: number | undefined;
}) {
  const summary = describeAvailability(availability);
  const stale = describeStaleness(staleMs);
  if (!summary && !stale) return null;

  return (
    <div
      data-testid="sources-unavailable-notice"
      role="status"
      aria-live="polite"
      className="mb-3 border-l-2 border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      {summary && (
        <p className="font-bold">
          {summary}
          <span className="font-normal">
            {" "}— totals that would span the missing source are withheld, because a total over part of
            the portfolio is wrong rather than smaller. The rows below are live.
          </span>
        </p>
      )}
      {availability && availability.unavailable.length > 0 && (
        // Plain sentences on screen; the raw `source — reason` keys live in the tooltip (and in the
        // gateway's logs, which is where an operator diagnosing this should be looking anyway).
        // A reader cannot place `project:p-8842`, and twenty of them bury the one fact that matters.
        <ul className="mt-1 list-none space-y-0.5" title={rawUnavailable(availability.unavailable)}>
          {humaniseUnavailable(availability.unavailable).map((line) => (
            <li key={line} className="text-[11px] opacity-90">{line}</li>
          ))}
        </ul>
      )}
      {stale && (
        <p className={summary ? "mt-1 font-normal" : "font-normal"}>
          {/* Staleness is a separate axis from availability: these numbers are complete, just not live. */}
          Figures {stale} (read cache is on), so they are not live.
        </p>
      )}
    </div>
  );
}
